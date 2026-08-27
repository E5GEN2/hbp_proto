/**
 * Cross-surface transition library.
 *
 * Every admin mutation that affects the client portal goes through one of these
 * functions. Each one runs in a Prisma transaction, writes an audit Log entry,
 * and (when relevant) creates a Notification the client sees in their bell.
 *
 * Keep the rules here — the API routes / server actions are just thin wrappers.
 */

import { prisma } from './prisma';
import { nextInvoiceId, nextOrderId, nextPaymentId, nextUserId, nextProxyIdBatch, nextAssignmentId } from './id';
import { renewalBase, renewalPricing, consumeRenewalDiscountCycle, orderRenewalDiscountActive } from './renewal';
import { fmtDate } from './date';
import { money } from './money';
import { sendTelegram, sendAdminTelegram, adminNewOrderAlert, flushTelegram, type TelegramOutbox } from './telegram';
import { sendEmail, incidentEmail, proxiesReadyEmail, escapeHtml } from './email';
import { appUrl } from './app-url';
import { creditBalance, debitBalance, roundCents, InsufficientBalance } from './balance';
import { isInstantMethod, assertNewOrderBounds, resolveCustomExpiry, newOrderMoney, applyCustomExpiry } from './new-order-policy';
import { passwordPolicyError, generateTempPassword } from './password-policy';
import { loadTierGraceHours, effectiveGraceHours, renewalClosed } from './grace';
import { targetBucket } from './order-signals';
import bcrypt from 'bcryptjs';
import type { Prisma, LogObjectType, NotificationKind, OrderException, OrderStatus, PaymentStatus, ProxyStatus, ProxyHealth } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name?: string };

// Batched assignment ids — sequence-backed (see lib/id.ts), atomic under
// concurrency; the old table-scan max+1 raced (audit B-5).
async function newAssignmentIds(tx: Tx, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(await nextAssignmentId(tx));
  return ids;
}

async function notify(tx: Tx, userId: string, title: string, kind: NotificationKind = 'INFO', link?: string) {
  await tx.notification.create({
    data: {
      id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId, title, kind, link,
    },
  });
}

async function log(tx: Tx, actorId: string | null, action: string, objectType: LogObjectType, objectId: string | null, detail: string) {
  await tx.log.create({
    data: { actorId, action, objectType, objectId, detail },
  });
}

/* ════════════════════════════════════════════════════════════════════════
   PAYMENTS
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Admin marks an awaiting/pending/failed payment as confirmed.
 * Propagates to: order activation, proxy assignment, credentials, invoice.
 */
export async function markPaymentPaid({
  paymentId, actor, source, externalRef,
}: { paymentId: string; actor: Actor; source?: string; externalRef?: string }) {
  // Built inside the tx, sent after commit (no HTTP inside $transaction).
  let adminAlert: string | null = null;
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const telegramOutbox: TelegramOutbox = [];
  const result = await prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { plan: true } }, client: true },
    });
    if (!pay) throw new Error('Payment not found');
    if (!['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'].includes(pay.status)) {
      throw new Error(`Cannot mark paid from status ${pay.status}`);
    }

    const now = new Date();

    // Status-guarded flip: MANUAL_REVIEW (and FAILED) are also auto-settle
    // targets now (settleAwaitingPayment resurrect), so a finished IPN /
    // reconcile can settle this row between the read above and here. Keying the
    // flip on the settleable statuses makes a lost race match 0 rows → abort
    // before crediting/assigning, so money moves exactly once (audit C5).
    const flip = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'] } },
      data: { status: 'CONFIRMED', confirmedAt: now, source, externalRef },
    });
    if (flip.count === 0) throw new Error('This payment was just settled — reload to see its current state.');

    if (pay.order) {
      const ord = pay.order;
      const plan = ord.plan;
      // A cancelled order must not be silently revived by confirming a payment:
      // its proxies were released and its cancellation was communicated to the
      // client. Auto-settle parks this case for a human (settle-payment.ts);
      // here the human IS present, so say what the choice is rather than
      // half-reactivating behind their back (re-review C13).
      if (ord.status === 'CANCELLED') {
        throw new Error(`Order ${ord.id} is cancelled — refund this payment, or reinstate the order first.`);
      }
      // Discriminate initial purchase vs renewal charge by order.status, exactly
      // like settleAwaitingPayment (audit 2B). A NON-NEW order is already
      // settled and this payment RENEWS it: MarkPaid used to run the new-order
      // path below unconditionally — re-assigning a SECOND set of proxies and
      // stamping expiresAt = now + duration, which SWALLOWED the client's
      // remaining paid term. Extend instead (re-provision only an EXPIRED order,
      // whose proxies were released at expiry).
      if (ord.status !== 'NEW') {
        const invoiceId = await nextInvoiceId();
        const existing = await tx.invoice.findUnique({ where: { paymentId } });
        if (!existing) {
          await tx.invoice.create({ data: { id: invoiceId, paymentId, orderId: ord.id, clientId: ord.clientId, amount: pay.gross } });
        }
        // Fresh in-tx re-read: extend from the CURRENT expiry (a concurrent
        // renewal may have moved it since the read at the top of the tx), and
        // re-check CANCELLED — the line-level mirror of settle-payment's
        // renewal branch (review: a cancel committing between the two reads
        // would otherwise stamp "renewed" onto a dead order). The throw rolls
        // back the CONFIRMED flip and invoice.
        const freshOrd = await tx.order.findUnique({ where: { id: ord.id }, select: { status: true, expiresAt: true, exception: true, activatedAt: true } });
        if (!freshOrd) throw new Error(`Order ${ord.id} vanished during mark-paid`);
        if (freshOrd.status === 'CANCELLED') {
          throw new Error(`Order ${ord.id} is cancelled — refund this payment, or reinstate the order first.`);
        }
        const reproOrd = { id: ord.id, qty: ord.qty, region: ord.region, activatedAt: freshOrd.activatedAt, autoProvision: ord.autoProvision, plan: { carrier: plan.carrier, pool: plan.pool, durationDays: plan.durationDays } };
        const repro = freshOrd.status === 'EXPIRED' ? await reprovisionRenewedOrder(tx, reproOrd, actor.id, now) : null;
        if (repro) {
          await tx.order.update({ where: { id: ord.id }, data: repro.data });
          await log(tx, actor.id, 'ORDER.EXTEND', 'ORDER', ord.id,
            `Renewal confirmed via MarkPaid · re-provisioned ${repro.assignedCount}/${ord.qty}${repro.fullyAssigned ? '' : ' · PAID_NOT_PROVISIONED'}`);
          await notify(tx, ord.clientId,
            repro.fullyAssigned
              ? `Order ${ord.id} renewed — ${ord.qty} fresh ${ord.qty === 1 ? 'proxy' : 'proxies'} assigned`
              : `Order ${ord.id} renewed — proxies are being provisioned`,
            'SUCCESS', `/orders/${ord.id}`);
        } else {
          // Anchor on the ORIGINAL expiry, not now (renewal-policy PR): a
          // renewal extends from when the order was due to end. In grace the
          // proxies are still bound → reprovision returned null → this
          // plain-extend runs, and expiresAt is in the (recent) past; anchoring
          // there keeps the term contiguous instead of gifting the grace days.
          // renewalBase floors to `now` if a full term would land wholly in the
          // past, so an admin MarkPaid on a long-dead order can't stamp a
          // past-dated expiry (no block on admin paths — this is the safety net).
          const base = renewalBase(freshOrd.expiresAt, plan.durationDays, now);
          const newExpiry = new Date(base.getTime() + plan.durationDays * 86_400_000);
          await tx.order.update({
            where: { id: ord.id },
            data: {
              expiresAt: newExpiry,
              status: freshOrd.status === 'EXPIRED' ? 'ACTIVE' : freshOrd.status,
              renewalBucket: 'RENEWED',
              lastReminderAt: null,
              exception: freshOrd.exception === 'RENEWAL_NOT_EXTENDED' ? null : freshOrd.exception,
            },
          });
          await notify(tx, ord.clientId, `Order ${ord.id} renewed — new expiry ${fmtDate(newExpiry)}`, 'SUCCESS', `/orders/${ord.id}`);
        }
        // Consume one discount cycle ONLY when the CHARGE was priced with the
        // per-order discount — the payment row's charge-time snapshot, never
        // the order's current fields (a grant made while this charge was in
        // flight must not be eaten by its settle; review R1).
        if (pay.renewalDiscountApplied) await consumeRenewalDiscountCycle(tx, ord.id);
        // No adminNewOrderAlert for a renewal (mirrors settle-payment — the
        // "new paid order" alert is for first purchases only).
      } else {
      // ── NEW order: initial-purchase activation ─────────────────────────────
      // Snapshot semantics (report №3): the order carries autoProvision as
      // captured at purchase time — flipping the PLAN's flag between order
      // and payment must not change how this order settles.
      const willActivate = ord.autoProvision;

      // Try to assign proxies if auto-provision
      let assignedCount = 0;
      if (willActivate) {
        const candidates = await tx.proxy.findMany({
          where: { carrier: plan.carrier, region: ord.region, pool: plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
          take: ord.qty,
        });
        if (candidates.length < ord.qty) {
          const more = await tx.proxy.findMany({
            where: { carrier: plan.carrier, region: ord.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
            take: ord.qty - candidates.length,
          });
          candidates.push(...more);
        }
        const toAssign = candidates.slice(0, ord.qty);
        const ids = await newAssignmentIds(tx, toAssign.length);
        for (let i = 0; i < toAssign.length; i++) {
          const p = toAssign[i];
          await tx.assignment.create({
            data: { id: ids[i], orderId: ord.id, proxyId: p.id, actorId: actor.id, assignedAt: now },
          });
          await tx.proxy.update({ where: { id: p.id }, data: { status: 'ASSIGNED', currentOrderId: ord.id } });
          assignedCount++;
        }
      }

      const fullyAssigned = assignedCount >= ord.qty;
      // Start the clock only on full activation — a PAID_NOT_PROVISIONED order
      // waiting on a manual Assign must not burn its term while it waits. This
      // matches checkout/place and settle-payment (both null-until-ACTIVE);
      // Assign then stamps now+durationDays when the last proxy lands (P1 #2).
      // A persisted admin custom expiry is consumed here (stale → full term,
      // logged below — money just landed, never park or kill a paid order).
      const activating = willActivate && fullyAssigned;
      const custom = applyCustomExpiry(ord.customExpiresAt, plan.durationDays, now);
      const expiresAt = activating ? custom.expiresAt : null;
      await tx.order.update({
        where: { id: ord.id },
        data: {
          paymentStatus: 'PAID',
          status: activating ? 'ACTIVE' : 'PROVISIONING',
          activatedAt: activating ? now : null,
          expiresAt,
          ...(activating ? { customExpiresAt: null } : {}),
          credentialsSentAt: activating ? now : null,
          credentialsChannel: null,
          exception: willActivate && !fullyAssigned ? 'PAID_NOT_PROVISIONED' : null,
          excInfo: willActivate && !fullyAssigned ? `Pool capacity hit — only ${assignedCount}/${ord.qty} provisioned` : null,
        },
      });
      if (activating && custom.stale) {
        await log(tx, actor.id, 'ORDER.UPDATE', 'ORDER', ord.id,
          `Custom expiry ${fmtDate(ord.customExpiresAt!)} passed before activation — full plan term applied`);
      }

      // Mint invoice
      const invoiceId = await nextInvoiceId();
      const existing = await tx.invoice.findUnique({ where: { paymentId } });
      if (!existing) {
        await tx.invoice.create({
          data: { id: invoiceId, paymentId, orderId: ord.id, clientId: ord.clientId, amount: pay.gross },
        });
      }

      await notify(tx, ord.clientId,
        willActivate && fullyAssigned
          ? `Order ${ord.id} activated — ${ord.qty} ${ord.qty === 1 ? 'proxy' : 'proxies'} ready`
          : `Payment confirmed for ${ord.id} — fulfilment in progress`,
        willActivate && fullyAssigned ? 'SUCCESS' : 'INFO',
        `/orders/${ord.id}`,
      );

      // Same delivery notice as the manual Assign path: this branch just
      // provisioned the order to full and flipped it ACTIVE, so the client's
      // proxies are live. Admin MarkPaid sent NO client email at all before —
      // unlike the automatic crypto settle, which does (orderPaidEmail) — so
      // whether the client heard about their own order depended on which route
      // confirmed the payment. Not gated: it is the delivery receipt for a paid
      // order. The partial/PROVISIONING case deliberately stays bell-only —
      // the ready mail belongs to the moment the proxies actually go live.
      if (willActivate && fullyAssigned) {
        emailOutbox.push({ to: pay.client.email, ...proxiesReadyEmail(ord.id, ord.qty, false) });
        telegramOutbox.push({
          chatId: pay.client.telegramAll ? pay.client.telegramChatId : null,
          text: `✅ Order ${ord.id} activated — ${ord.qty} ${ord.qty === 1 ? 'proxy' : 'proxies'} ready`,
        });
      }

      // "New order" alert only when the order first becomes paid — a repeat
      // payment on an already-paid order (renewal confirm on a PAID, FREE
      // comp, or legacy CONFIRMED order) is not a new order, no re-alert.
      if (!['PAID', 'FREE', 'CONFIRMED'].includes(ord.paymentStatus)) {
        adminAlert = adminNewOrderAlert({
          orderId: ord.id,
          clientName: pay.client.name ?? pay.client.id,
          clientId: pay.client.id,
          planName: plan.name,
          qty: ord.qty,
          amount: money(Number(pay.gross)),
          method: pay.method,
          status: willActivate && fullyAssigned ? 'ACTIVE' : 'PROVISIONING',
          assigned: assignedCount,
          adminUrl: appUrl(`/admin/orders/${ord.id}`),
          via: `confirmed by ${actor.name ?? actor.id}`,
        });
      }
      }
    } else {
      // Balance top-up (no order) — mirror settleAwaitingPayment's deposit
      // branch. Without this, an admin "Mark paid" on a crypto deposit (e.g.
      // confirming an underpaid/late top-up surfaced by the crypto-attention
      // alert) flips the payment to CONFIRMED but credits NOTHING, and the
      // idempotency guard then makes it permanent (2026-08-07 review). All
      // ops are DB-only, so this stays inside the transaction.
      const amount = Number(pay.gross);
      const newBal = await creditBalance(tx, pay.clientId, amount);
      await tx.balanceLedgerEntry.create({
        data: { userId: pay.clientId, op: 'TOPUP', amount, balanceAfter: newBal, refPaymentId: paymentId, note: `Deposit confirmed by ${actor.name ?? actor.id}` },
      });
      const existingInv = await tx.invoice.findUnique({ where: { paymentId } });
      if (!existingInv) {
        const invoiceId = await nextInvoiceId();
        await tx.invoice.create({ data: { id: invoiceId, paymentId, orderId: null, clientId: pay.clientId, amount } });
      }
      await notify(tx, pay.clientId,
        `Deposit of ${money(amount)} added to your balance · new bal ${money(newBal)}`,
        'SUCCESS', '/billing');
    }

    await log(tx, actor.id, 'PAYMENT.CONFIRM', 'PAYMENT', paymentId,
      `Payment confirmed by ${actor.name ?? actor.id}${source ? ` · source=${source}` : ''}${externalRef ? ` · ref=${externalRef}` : ''}`);

    return { ok: true };
  });
  if (adminAlert) await sendAdminTelegram(adminAlert);
  for (const e of emailOutbox) await sendEmail(e);
  await flushTelegram(telegramOutbox);
  return result;
}

/**
 * Admin refunds a confirmed payment.
 * Credits client balance, tags order with refund-pending exception.
 */
// ── Manual refund flow (owner decision 2026-08-12) ──────────────────────────
// Refunds are TWO-STEP and the money moves OUTSIDE the portal: the admin
// initiates (reason recorded, client notified «being processed»), returns the
// funds manually (crypto back to the client's wallet), then completes with a
// PROOF (tx hash / reference) — only then does the payment become REFUNDED.
// The portal does NOT credit the internal balance: the old auto-credit both
// double-refunded (external return + store credit) and MINTED money on
// deposit refunds (the TOPUP's own credit stayed). Deposits are therefore
// not refundable at all — adjust the client's balance instead (variant B).

export async function initiateRefund({
  paymentId, actor, amount, reason,
}: { paymentId: string; actor: Actor; amount?: number; reason: string }) {
  return prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!pay) throw new Error('Payment not found');
    if (!pay.orderId) {
      // A deposit's own TOPUP credit already sits on the balance — "refunding"
      // it here would leave that credit in place while money also goes back
      // externally. Balance corrections go through Adjust balance, which
      // debits with a ledger entry.
      throw new Error('Deposits are not refundable — use Adjust balance on the client instead.');
    }
    if (!reason?.trim()) throw new Error('Reason required');
    // CONFIRMED/PAID = admin-initiated; REFUND_REQUESTED = executing a client's
    // request; MANUAL_REVIEW = funds on a dead charge (e.g. a cancelled order)
    // — refunding is that queue's exit (re-review C1/C3/C4).
    if (!['CONFIRMED', 'PAID', 'REFUND_REQUESTED', 'MANUAL_REVIEW'].includes(pay.status)) {
      throw new Error(`Cannot refund from status ${pay.status}`);
    }

    const refundAmount = roundCents(amount ?? Number(pay.gross));

    // Status-guarded flip (optimistic concurrency): two admins double-clicking,
    // or a refund racing a settle — count 0 → somebody moved the row first.
    const flipped = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ['CONFIRMED', 'PAID', 'REFUND_REQUESTED', 'MANUAL_REVIEW'] } },
      data: { status: 'REFUND_IN_PROGRESS', refundedAmount: refundAmount, refundReason: reason.trim() },
    });
    if (flipped.count === 0) throw new Error('This payment was just updated — reload to see its current state.');

    await notify(tx, pay.clientId,
      `Refund of ${money(refundAmount)} for ${pay.orderId} is being processed — we'll notify you when it's sent`,
      'INFO', `/orders/${pay.orderId}`);
    await log(tx, actor.id, 'PAYMENT.REFUND_INITIATE', 'PAYMENT', paymentId,
      `Refund initiated ${money(refundAmount)} · ${reason.trim()} · actor=${actor.name ?? actor.id}`);
    return { ok: true, refundAmount };
  });
}

export async function completeRefund({
  paymentId, actor, proof,
}: { paymentId: string; actor: Actor; proof: string }) {
  return prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!pay) throw new Error('Payment not found');
    if (pay.status !== 'REFUND_IN_PROGRESS') {
      throw new Error(`Cannot complete a refund from status ${pay.status} — initiate it first.`);
    }
    // The proof is what makes the refund auditable: without a tx hash /
    // reference there is no record the money actually left (owner rule).
    if (!proof?.trim()) throw new Error('Proof of the completed refund is required (tx hash / reference).');

    const now = new Date();
    const refundAmount = roundCents(Number(pay.refundedAmount ?? pay.gross));

    const flipped = await tx.payment.updateMany({
      where: { id: paymentId, status: 'REFUND_IN_PROGRESS' },
      data: { status: 'REFUNDED', refundedAt: now, refundProof: proof.trim() },
    });
    if (flipped.count === 0) throw new Error('This payment was just updated — reload to see its current state.');

    // Completing the refund RESOLVES the refund-pending signal (Phase B
    // finding B-4). Clear only when NO other reviewable payment remains on
    // the order (renewals stack several payments).
    if (pay.order && pay.order.exception === 'REFUND_PENDING') {
      const reviewable = await tx.payment.count({
        where: {
          orderId: pay.order.id,
          id: { not: paymentId },
          status: { in: ['CONFIRMED', 'PAID', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'AWAITING', 'PENDING', 'MANUAL_REVIEW'] },
        },
      });
      if (reviewable === 0) {
        await tx.order.update({
          where: { id: pay.order.id },
          data: { exception: null, excInfo: null },
        });
      }
    }

    await notify(tx, pay.clientId,
      `Refund of ${money(refundAmount)} for ${pay.orderId} has been sent`,
      'SUCCESS', pay.orderId ? `/orders/${pay.orderId}` : '/billing');
    await log(tx, actor.id, 'PAYMENT.REFUND', 'PAYMENT', paymentId,
      `Refund completed ${money(refundAmount)} · proof=${proof.trim().slice(0, 120)} · actor=${actor.name ?? actor.id}`);
    return { ok: true, refundAmount };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   ORDERS
   ════════════════════════════════════════════════════════════════════════ */

export async function cancelOrder({
  orderId, actor, reason,
}: { orderId: string; actor: Actor; reason: string }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { releasedAt: null } } },
    });
    if (!ord) throw new Error('Order not found');
    if (ord.status === 'CANCELLED') throw new Error('Already cancelled');

    const now = new Date();
    const wasPaid = ['PAID', 'CONFIRMED'].includes(ord.paymentStatus);

    // Release every active assignment
    for (const a of ord.assignments) {
      await tx.assignment.update({
        where: { id: a.id },
        data: { releasedAt: now, reason: 'CANCEL', reasonDetail: reason },
      });
      // Reset health too — a cancelled order may hold a FAULTY+OFFLINE proxy
      // (heal-in-place); without this it lands AVAILABLE+OFFLINE, invisible to
      // auto-fill and mis-bucketed by the health widget (the coherence invariant).
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { status: 'AVAILABLE', health: 'HEALTHY', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledReason: reason,
        autoRenew: false,
        renewalBucket: null,
        customExpiresAt: null, // a pending custom expiry dies with the order
        // If paid, raise refund-pending so finance can close the loop.
        // If not, the charge dies with the order — snapshot/feed must not
        // keep showing "Awaiting" on a cancelled order.
        exception: wasPaid ? 'REFUND_PENDING' : ord.exception,
        ...(wasPaid ? {} : { paymentStatus: 'CANCELLED' as const }),
      },
    });
    if (!wasPaid) {
      await tx.payment.updateMany({
        where: { orderId, status: { in: ['AWAITING', 'PENDING'] } },
        data: { status: 'CANCELLED' },
      });
    }

    await notify(tx, ord.clientId,
      `Order ${ord.id} was cancelled · ${reason}`,
      'WARNING',
      `/orders/${ord.id}`,
    );

    await log(tx, actor.id, 'ORDER.CANCEL', 'ORDER', orderId,
      `Cancelled by ${actor.name ?? actor.id} · ${reason} · ${ord.assignments.length} ${ord.assignments.length === 1 ? 'proxy' : 'proxies'} released`);

    return { ok: true };
  });
}

export async function suspendOrder({ orderId, actor, reason }: { orderId: string; actor: Actor; reason: string }) {
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { client: { select: { email: true, emailIncidents: true } } },
    });
    if (!ord) throw new Error('Order not found');
    if (ord.status !== 'ACTIVE' && ord.status !== 'PROVISIONING') throw new Error(`Cannot suspend from status ${ord.status}`);

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'SUSPENDED',
        autoRenewBeforeSuspend: ord.autoRenew,
        autoRenew: false,
        credentialsBeforeSuspend: ord.credentialsChannel,
        // Bucket hygiene (status revision phase 3, symmetric with cancelOrder):
        // a suspended order's clock is frozen — the sweep classifier skips it
        // (ACTIVE/EXPIRED only), so a kept bucket would park it in the
        // Renewals queues / dashboard counters forever as "expiring".
        renewalBucket: null,
      },
    });
    // Proxies stay reserved (per the prototype contract)
    await tx.assignment.updateMany({
      where: { orderId, releasedAt: null },
      data: { suspendedAt: new Date() },
    });

    await notify(tx, ord.clientId, `Order ${orderId} suspended by operator · ${reason}`, 'WARNING', `/orders/${orderId}`);
    if (ord.client.emailIncidents) {
      emailOutbox.push({ to: ord.client.email, ...incidentEmail(
        `Order ${orderId} suspended`,
        [`Your order <strong>${orderId}</strong> was suspended by the operator: ${escapeHtml(reason)}.`,
         'Proxy access is withdrawn while the order is suspended — contact support if this is unexpected.'],
        `/orders/${orderId}`, 'View order') });
    }
    // Client creds are hidden on suspend, but the proxy stays bound and the
    // client may have copied them — record the standing manual-rotation duty
    // (no upstream auto-rotation). Surfaced on the admin order page + modal.
    await log(tx, actor.id, 'ORDER.SUSPEND', 'ORDER', orderId, `Suspended · ${reason} · creds hidden from client — ROTATE proxy password + IP-rotation link on the upstream manually`);
    return { ok: true };
  });
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

export async function resumeOrder({ orderId, actor }: { orderId: string; actor: Actor }) {
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const tierGrace = await loadTierGraceHours();
  const result = await prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        assignments: { where: { releasedAt: null } },
        client: { select: { email: true, emailIncidents: true, tier: true, graceHoursOverride: true } },
      },
    });
    if (!ord) throw new Error('Order not found');
    if (ord.status !== 'SUSPENDED') throw new Error('Order is not suspended');

    // If proxies are still reserved and were paid, resume to ACTIVE; else PROVISIONING
    const intact = ord.assignments.length >= ord.qty && (ord.paymentStatus === 'PAID' || ord.paymentStatus === 'CONFIRMED');
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: intact ? 'ACTIVE' : 'PROVISIONING',
        autoRenew: ord.autoRenewBeforeSuspend ?? false,
        // The clock restarts with the order (phase 3): re-classify the bucket
        // immediately instead of leaving the queues blind until the next
        // sweep tick. suspendOrder cleared it, so the RENEWED sticky is gone
        // by design (a suspension is a manual intervention); a resume to
        // PROVISIONING keeps it null — no running clock there.
        renewalBucket: intact
          ? targetBucket({ expiresAt: ord.expiresAt, renewalBucket: ord.renewalBucket, graceHours: effectiveGraceHours(ord.client, tierGrace) }, Date.now())
          : null,
      },
    });
    await tx.assignment.updateMany({
      where: { orderId, releasedAt: null },
      data: { suspendedAt: null },
    });

    await notify(tx, ord.clientId, `Order ${orderId} resumed`, 'SUCCESS', `/orders/${orderId}`);
    if (ord.client.emailIncidents) {
      // Mirror the log's intact branch (review find): a resume to PROVISIONING
      // has NO proxies to restore — claiming restored access would be the
      // exact dishonesty this wave removes.
      emailOutbox.push({ to: ord.client.email, ...incidentEmail(
        `Order ${orderId} resumed`,
        intact
          ? [`Your order <strong>${orderId}</strong> was resumed — proxy access is restored.`]
          : [`Your order <strong>${orderId}</strong> was resumed — its proxies are being re-provisioned, we’ll notify you when they’re ready.`],
        `/orders/${orderId}`, 'View order') });
    }
    await log(tx, actor.id, 'ORDER.RESUME', 'ORDER', orderId, intact ? 'Resumed to ACTIVE' : 'Resumed to PROVISIONING (manual recovery needed)');
    return { ok: true };
  });
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

export async function extendOrder({
  orderId, actor, additionalDays, paymentMethod,
}: { orderId: string; actor: Actor; additionalDays?: number; paymentMethod?: 'comp' | 'balance' | 'invoice' }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({ where: { id: orderId }, include: { plan: true } });
    if (!ord) throw new Error('Order not found');
    // Server-side mirror of the UI gate (the button renders for ACTIVE/EXPIRED
    // only): a NEW/PROVISIONING/SUSPENDED order has not started (or has paused)
    // its term — stamping expiresAt on it would violate the null-until-active
    // invariant: the sweep only expires ACTIVE orders, so the date would be a
    // zombie term, and a later activation would carry a possibly-past date
    // into ACTIVE (same hazard class as the New Order custom-expiry guard).
    if (ord.status !== 'ACTIVE' && ord.status !== 'EXPIRED') {
      throw new Error(
        ord.status === 'CANCELLED' ? 'Cannot extend a cancelled order'
        : ord.status === 'SUSPENDED' ? 'Cannot extend a suspended order — resume it first'
        : `Cannot extend a ${ord.status.toLowerCase()} order — its term starts at activation`);
    }

    const now = new Date();
    const days = additionalDays ?? ord.plan.durationDays;
    // Sanity bound only (guards Invalid-Date overflow from a direct call) —
    // generous because `days` defaults to plan.durationDays, which createPlan
    // caps only at > 0, so a tight cap here could break the default Extend
    // click on a long plan (review find).
    if (!Number.isInteger(days) || days < 1 || days > 36_500) throw new Error('Days must be an integer 1..36500');

    // An EXPIRED order has had its proxies auto-released to the pool — a bare
    // term shift would reactivate it with nothing assigned. Re-provision
    // instead (fresh proxies pool-first; short pool → PAID_NOT_PROVISIONED
    // with the clock held for manual Assign).
    if (ord.status === 'EXPIRED') {
      const repro = await reprovisionRenewedOrder(tx, ord, actor.id, now);
      if (repro) {
        await tx.order.update({ where: { id: orderId }, data: repro.data });
        await notify(tx, ord.clientId,
          repro.fullyAssigned
            ? `Order ${orderId} renewed — ${ord.qty} fresh ${ord.qty === 1 ? 'proxy' : 'proxies'} assigned`
            : `Order ${orderId} renewed — proxies are being provisioned`,
          'SUCCESS', `/orders/${orderId}`);
        await log(tx, actor.id, 'ORDER.EXTEND', 'ORDER', orderId,
          `Extended after expiry · re-provisioned ${repro.assignedCount}/${ord.qty} · method=${paymentMethod ?? 'comp'}${repro.fullyAssigned ? '' : ' · PAID_NOT_PROVISIONED'}`);
        return { ok: true, newExpiry: repro.fullyAssigned ? new Date(now.getTime() + ord.plan.durationDays * 86_400_000) : null };
      }
    }

    // Anchor on the ORIGINAL expiry so an admin Extend during grace stays
    // contiguous (renewal-policy PR). No past-grace block here — admin Extend
    // is a deliberate manual override (comp/grant), unlike the client paths.
    // renewalBase floors to `now` when the granted days would otherwise land
    // wholly in the past, so the grant can't evaporate on the next sweep.
    const base = renewalBase(ord.expiresAt, days, now);
    const newExpiry = new Date(base.getTime() + days * 86_400_000);

    await tx.order.update({
      where: { id: orderId },
      data: {
        expiresAt: newExpiry,
        status: ord.status === 'EXPIRED' ? 'ACTIVE' : ord.status,
        renewalBucket: 'RENEWED',
        lastReminderAt: null,
        exception: ord.exception === 'RENEWAL_NOT_EXTENDED' ? null : ord.exception,
      },
    });

    await notify(tx, ord.clientId,
      `Order ${orderId} extended by ${days} days. New expiry: ${fmtDate(newExpiry)}`,
      'SUCCESS', `/orders/${orderId}`,
    );
    await log(tx, actor.id, 'ORDER.EXTEND', 'ORDER', orderId, `Extended ${days} days · method=${paymentMethod ?? 'comp'}`);
    return { ok: true, newExpiry };
  });
}

/**
 * Renewal-of-EXPIRED re-provisioning (product decision 2026-07-07: proxies
 * return to the pool the moment an order expires). Extending the term is then
 * not enough — the client paid and holds nothing. Re-run the activation
 * contract instead, exactly like a new order:
 *   · order.autoProvision (purchase-time snapshot) → pool-first pick;
 *     full → ACTIVE with a FRESH term from now; short → PROVISIONING +
 *     PAID_NOT_PROVISIONED with the clock held (expiresAt null) until manual
 *     Assign stamps the full term (see assignProxyManually).
 *   · autoProvision OFF → PROVISIONING, manual fulfilment, clock held.
 *
 * Returns null when the order still holds live assignments — the caller then
 * applies its normal "shift expiresAt" extension. Used by every path that can
 * reactivate an EXPIRED order: settleAwaitingPayment (crypto renewal),
 * checkout/place (balance renewal), extendOrder (admin Extend).
 */
export async function reprovisionRenewedOrder(
  tx: Tx,
  ord: { id: string; qty: number; region: string; activatedAt: Date | null; autoProvision: boolean; plan: { carrier: string; pool: string; durationDays: number } },
  actorId: string,
  now: Date,
): Promise<null | { fullyAssigned: boolean; assignedCount: number; data: Prisma.OrderUpdateInput }> {
  // Serialize concurrent re-provisions of the SAME order (review 2026-08-12):
  // the live-count below is a plain read — under READ COMMITTED two renewal
  // transactions (double-click one-click renewal; MarkPaid racing a crypto
  // settle) could both see live=0 and each assign qty proxies → 2×qty live
  // assignments and a double-charged term. Same row-lock recipe as
  // assignProxyManually; one lock here covers all five renewal entry points.
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${ord.id} FOR UPDATE`;
  const live = await tx.assignment.count({ where: { orderId: ord.id, releasedAt: null } });
  if (live > 0) return null; // proxies still bound — plain term extension applies

  let assignedCount = 0;
  if (ord.autoProvision) {
    const candidates = await tx.proxy.findMany({
      where: { carrier: ord.plan.carrier, region: ord.region, pool: ord.plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
      take: ord.qty,
    });
    if (candidates.length < ord.qty) {
      const more = await tx.proxy.findMany({
        where: { carrier: ord.plan.carrier, region: ord.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
        take: ord.qty - candidates.length,
      });
      candidates.push(...more);
    }
    const ids = await newAssignmentIds(tx, candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      await tx.assignment.create({
        data: { id: ids[i], orderId: ord.id, proxyId: candidates[i].id, actorId, assignedAt: now },
      });
      await tx.proxy.update({ where: { id: candidates[i].id }, data: { status: 'ASSIGNED', currentOrderId: ord.id } });
      assignedCount++;
    }
  }

  const fullyAssigned = ord.autoProvision && assignedCount >= ord.qty;
  return {
    fullyAssigned, assignedCount,
    data: {
      status: fullyAssigned ? 'ACTIVE' : 'PROVISIONING',
      activatedAt: ord.activatedAt ?? (fullyAssigned ? now : null),
      expiresAt: fullyAssigned ? new Date(now.getTime() + ord.plan.durationDays * 86_400_000) : null,
      credentialsSentAt: fullyAssigned ? now : null,
      credentialsChannel: null,
      renewalBucket: 'RENEWED',
      lastReminderAt: null,
      exception: ord.autoProvision && !fullyAssigned ? 'PAID_NOT_PROVISIONED' : null,
      excInfo: ord.autoProvision && !fullyAssigned ? `Renewal re-provisioning — pool had ${assignedCount}/${ord.qty}` : null,
    },
  };
}

// proxyIds === null ⇒ AUTO mode: pick up to the order's deficit from the pool
// inside the same transaction, using the standard two-pass matcher every
// automated path uses (carrier+region+plan.pool, then carrier+region). Manual
// mode takes explicit ids — ANY available proxy is admin-assignable (pool and
// even region are soft preferences, not invariants; the UI flags mismatches).
export async function assignProxyManually({
  orderId, proxyIds, actor,
}: { orderId: string; proxyIds: string[] | null; actor: Actor }) {
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const telegramOutbox: TelegramOutbox = [];
  const result = await prisma.$transaction(async tx => {
    // Serialize concurrent assigns to the SAME order: the deficit is computed
    // from the open-assignment count, and two READ-COMMITTED transactions each
    // reading it before the other commits could jointly over-fill past qty with
    // different proxies (the partial unique index only blocks the same proxy
    // twice). A row lock makes the second assign wait and re-read the true count.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        plan: true,
        assignments: { where: { releasedAt: null } },
        client: { select: { email: true, emailIncidents: true, telegramChatId: true, telegramAll: true } },
      },
    });
    if (!ord) throw new Error('Order not found');
    // Server-side mirror of the UI showAssign gate (report №8) — the action
    // used to trust the UI: an unpaid or dead order would be resurrected to
    // ACTIVE by the fullyAssigned branch below.
    if (['CANCELLED', 'EXPIRED', 'SUSPENDED'].includes(ord.status)) {
      throw new Error(`Cannot assign proxies to a ${ord.status.toLowerCase()} order`);
    }
    if (!['PAID', 'FREE', 'CONFIRMED'].includes(ord.paymentStatus)) {
      throw new Error(`Order is not paid (payment status ${ord.paymentStatus}) — confirm the payment first`);
    }

    const now = new Date();
    const deficit = ord.qty - ord.assignments.length;
    if (deficit <= 0) throw new Error('Order already has its full proxy count');

    let picked: string[];
    let autoMode = false;
    if (proxyIds === null) {
      // Auto: in-tx pool-first pick, capped at the deficit — never over-fills,
      // never races a stale prefetched list.
      autoMode = true;
      const found = await tx.proxy.findMany({
        where: { carrier: ord.plan.carrier, region: ord.region, pool: ord.plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: deficit, select: { id: true },
      });
      if (found.length < deficit) {
        const more = await tx.proxy.findMany({
          where: { carrier: ord.plan.carrier, region: ord.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: found.map(c => c.id) } },
          take: deficit - found.length, select: { id: true },
        });
        found.push(...more);
      }
      if (found.length === 0) {
        throw new Error(`No available healthy proxies match ${ord.plan.carrier} · ${ord.region} — pick one manually or register more`);
      }
      picked = found.map(c => c.id);
    } else {
      picked = [...new Set(proxyIds)];
      if (picked.length === 0) throw new Error('Pick at least one proxy');
      if (picked.length > deficit) {
        throw new Error(`Order only needs ${deficit} more ${deficit === 1 ? 'proxy' : 'proxies'}`);
      }
    }

    const ids = await newAssignmentIds(tx, picked.length);
    for (let i = 0; i < picked.length; i++) {
      const pid = picked[i];
      const p = await tx.proxy.findUnique({ where: { id: pid } });
      if (!p) throw new Error(`Proxy ${pid} not found`);
      if (p.status !== 'AVAILABLE') throw new Error(`Proxy ${pid} is ${p.status}`);
      // AVAILABLE⟹HEALTHY is an invariant (PR #104), but assignment makes the
      // proxy client-visible — check explicitly rather than lean on it.
      if (p.health !== 'HEALTHY') throw new Error(`Proxy ${pid} is ${p.health} — heal it before assigning`);
      await tx.assignment.create({
        data: { id: ids[i], orderId, proxyId: pid, actorId: actor.id, assignedAt: now },
      });
      await tx.proxy.update({ where: { id: pid }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
    }

    const currentlyAssigned = ord.assignments.length + picked.length;
    const fullyAssigned = currentlyAssigned >= ord.qty;
    if (fullyAssigned) {
      // First activation consumes a persisted admin custom expiry. If the date
      // passed while the order waited, REFUSE rather than silently grant a full
      // term or activate born-expired — the admin is right here and can cancel
      // and recreate with a fresh date (the recreation flow this feature
      // serves). Top-ups of an already-active term (ord.expiresAt set) skip
      // this entirely. The throw rolls back the whole tx — no proxies stick.
      if (ord.expiresAt === null && ord.customExpiresAt && ord.customExpiresAt.getTime() <= now.getTime()) {
        throw new Error(`Custom expiry ${fmtDate(ord.customExpiresAt)} has already passed — cancel this order and recreate it with a new date, or extend after activating without one`);
      }
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'ACTIVE',
          activatedAt: ord.activatedAt ?? now,
          // Honour the plan's real term — was hardcoded +30d, so a 7- or
          // 90-day plan provisioned via manual Assign got 30 days (P1 #1).
          // A pending custom expiry (recreation flow) wins over the full term.
          expiresAt: ord.expiresAt ?? ord.customExpiresAt ?? new Date(now.getTime() + ord.plan.durationDays * 86_400_000),
          customExpiresAt: null,
          credentialsSentAt: ord.credentialsSentAt ?? now,
          credentialsChannel: ord.credentialsChannel ?? null,
          // A New-Order "hold for manual assignment" (autoProvision snapshotted
          // false on an auto-provision plan) is a one-time creation choice, not
          // a lifetime fulfilment mode — once the admin has hand-picked the
          // proxies, lift the hold so mid-term faulty-proxy backfill and
          // renewal re-provisioning self-heal again (review find). Upgrade
          // only: an unconditional `= plan.autoProvision` would DOWNGRADE a
          // born-auto order to manual when the plan was edited auto→manual
          // after purchase, violating the purchase-time-snapshot semantics
          // (transitions.ts:162) on a plain pool-short top-up (round-3 find).
          ...(ord.plan.autoProvision && !ord.autoProvision ? { autoProvision: true } : {}),
        },
      });
      // Delivery notice on every channel we have — this is the moment
      // orderPaidEmail / resumeOrder promised to tell the client about, and it
      // used to produce nothing but a bell they had to be in the portal to see.
      // Two wordings, same split the sweep's backfill already makes: a first
      // fill ACTIVATES the order, a later one RESTORES a reopened deficit.
      const restored = ord.status === 'ACTIVE';
      const readyMsg = restored
        ? `Order ${orderId} is back to its full ${ord.qty} ${ord.qty === 1 ? 'proxy' : 'proxies'}`
        : `Your proxies for ${orderId} are ready`;
      await notify(tx, ord.clientId, readyMsg, 'SUCCESS', `/orders/${orderId}`);
      // The activation notice is transactional — it is the delivery receipt for
      // something the client paid for, so it is NOT gated, exactly like
      // orderPaidEmail. The restore variant closes an incident thread, so it
      // honours emailIncidents like every other incident mail (and like the
      // sweep's own backfill mail, which is the same event via the pool).
      if (!restored || ord.client.emailIncidents) {
        emailOutbox.push({ to: ord.client.email, ...proxiesReadyEmail(orderId, ord.qty, restored) });
      }
      telegramOutbox.push({ chatId: ord.client.telegramAll ? ord.client.telegramChatId : null, text: `✅ ${readyMsg}` });
    }
    // One reconciler for the exception + excInfo, full or partial: it recounts
    // SERVING assignments vs qty, so a partial top-up refreshes the stale
    // "0/N provisioned" fraction, a full one clears PAID_NOT_PROVISIONED *and*
    // REPLACEMENT_PENDING (the old inline clear handled only PNP and never
    // updated excInfo on partial assigns), and a full-but-one-slot-FAULTY
    // order stays flagged — consistent with the deficit widget's math.
    await refreshProvisionException(tx, orderId);

    await log(tx, actor.id, 'PROXY.ASSIGN', 'ORDER', orderId,
      `${autoMode ? 'Auto-assigned' : 'Manually assigned'} ${picked.length} ${picked.length === 1 ? 'proxy' : 'proxies'} · [${picked.join(', ')}]${autoMode ? ' · pool-first' : ''}`);
    return { ok: true, fullyAssigned, assigned: picked };
  });
  for (const e of emailOutbox) await sendEmail(e);
  await flushTelegram(telegramOutbox);
  return result;
}

// P1-3 (truth-in-UI, owner decision 2026-07-20): the old "Send credentials"
// never dispatched anything — it stamped credentialsSentAt while the toast
// claimed an email went out. Renamed to the honest semantics: the admin hands
// credentials over out-of-band (messenger / email themselves) and RECORDS the
// fact. Real dispatch stays deferred (Stage-1.5 decision 7 / P2 backlog).
// No client bell here: the "your proxies are ready" signal already fires at
// full assignment (assignProxyManually / activation paths) — a second row for
// admin bookkeeping would duplicate the signal (coherent-signals rule).
export async function markCredentialsDelivered({ orderId, actor }: { orderId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { releasedAt: null }, select: { id: true } } },
    });
    if (!ord) throw new Error('Order not found');
    // Server-side gate (the old action trusted the UI — the bulk bar allowed
    // any PROVISIONING order, even unpaid or with zero proxies): recording a
    // delivery that cannot have happened is exactly the dishonesty this
    // rename removes.
    if (['CANCELLED', 'EXPIRED', 'SUSPENDED'].includes(ord.status)) {
      throw new Error(`Cannot mark credentials delivered on a ${ord.status.toLowerCase()} order`);
    }
    if (!['PAID', 'FREE', 'CONFIRMED'].includes(ord.paymentStatus) && !ord.manualProvisioning) {
      throw new Error(`Order is not paid (payment status ${ord.paymentStatus}) — confirm the payment first`);
    }
    if (ord.assignments.length === 0) throw new Error('No proxies assigned — nothing to deliver yet');
    if (ord.credentialsSentAt) throw new Error('Credentials are already marked delivered');
    await tx.order.update({
      where: { id: orderId },
      data: { credentialsSentAt: new Date(), credentialsChannel: 'MANUAL' },
    });
    await log(tx, actor.id, 'ORDER.CREDENTIALS_DELIVERED', 'ORDER', orderId,
      'Marked delivered by admin — recorded only, nothing auto-sent');
    return { ok: true };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   PROXIES
   ════════════════════════════════════════════════════════════════════════ */

// Set / refresh / clear an order's under-provision exception from its LIVE
// deficit. Only touches the under-provision buckets (REPLACEMENT_PENDING and
// the never-provisioned PAID_NOT_PROVISIONED) — an unrelated exception
// (e.g. RENEWAL_NOT_EXTENDED) is left as-is; the derived under-provisioned
// count remains the authoritative signal regardless. Returns the live count.
// "Effectively serving" excludes a proxy that is FAULTY/OFFLINE: its assignment
// is deliberately kept open (so markProxyHealthy can heal it in place), but it
// is not actually carrying traffic, so it must count toward the deficit.
const SERVING_PROXY = { status: { not: 'FAULTY' as const }, health: { not: 'OFFLINE' as const } };

// A REPLACEMENT_PENDING raised by the CLIENT (clientRequestReplacement) carries
// a specific reason in excInfo and is NOT a deficit signal — the requested
// proxy is still attached. The deficit reconciler must leave it entirely alone
// (topping up an unrelated empty slot, a sweep backfill, or a heal must not
// silently erase the client's request); it is resolved only by the admin's
// Replace (which clears it explicitly).
const CLIENT_REQUEST_PREFIX = 'Client requested replacement';

export async function refreshProvisionException(tx: Tx, orderId: string): Promise<{ qty: number; live: number; deficit: number } | null> {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { qty: true, status: true, exception: true, excInfo: true } });
  if (!o) return null;
  const live = await tx.assignment.count({ where: { orderId, releasedAt: null, proxy: SERVING_PROXY } });
  const deficit = o.qty - live;
  const isClientRequest = o.exception === 'REPLACEMENT_PENDING' && (o.excInfo ?? '').startsWith(CLIENT_REQUEST_PREFIX);
  if (isClientRequest) return { qty: o.qty, live, deficit }; // owned by the Replace flow, not the deficit reconciler
  const isUnderExc = o.exception === null || o.exception === 'REPLACEMENT_PENDING' || o.exception === 'PAID_NOT_PROVISIONED';
  const active = o.status === 'ACTIVE' || o.status === 'PROVISIONING';
  if (deficit > 0 && active) {
    if (isUnderExc) {
      // Preserve the never-provisioned type; otherwise flag replacement pending.
      const exc: OrderException = o.exception === 'PAID_NOT_PROVISIONED' ? 'PAID_NOT_PROVISIONED' : 'REPLACEMENT_PENDING';
      // Honest suffix per type — a partially-assigned PNP order renders under
      // the "Paid but not provisioned" banner, where "replacement pending"
      // read wrong.
      const suffix = exc === 'PAID_NOT_PROVISIONED' ? 'provisioning incomplete' : 'replacement pending';
      await tx.order.update({ where: { id: orderId }, data: { exception: exc, excInfo: `${live}/${o.qty} proxies attached — ${suffix}` } });
    }
  } else if (deficit <= 0 && (o.exception === 'REPLACEMENT_PENDING' || o.exception === 'PAID_NOT_PROVISIONED')) {
    await tx.order.update({ where: { id: orderId }, data: { exception: null, excInfo: null } });
  }
  return { qty: o.qty, live, deficit };
}

// Top up an order's live assignments toward its qty from the AVAILABLE pool
// (pool-first: exact carrier+region+pool, then carrier+region). Used by the
// sweep auto-backfill step. Never over-fills; returns what it added.
export async function backfillOrderProxies(
  tx: Tx,
  order: { id: string; qty: number; region: string; plan: { carrier: string; pool: string } },
  actorId: string,
  now: Date,
): Promise<{ added: number; fully: boolean; live: number }> {
  const live = await tx.assignment.count({ where: { orderId: order.id, releasedAt: null } });
  const deficit = order.qty - live;
  if (deficit <= 0) return { added: 0, fully: true, live };

  const candidates = await tx.proxy.findMany({
    where: { carrier: order.plan.carrier, region: order.region, pool: order.plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
    take: deficit,
  });
  if (candidates.length < deficit) {
    const more = await tx.proxy.findMany({
      where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
      take: deficit - candidates.length,
    });
    candidates.push(...more);
  }
  if (candidates.length > 0) {
    const ids = await newAssignmentIds(tx, candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      await tx.assignment.create({
        data: { id: ids[i], orderId: order.id, proxyId: candidates[i].id, actorId, assignedAt: now, reason: 'REPLACEMENT', reasonDetail: 'Auto-filled from pool' },
      });
      await tx.proxy.update({ where: { id: candidates[i].id }, data: { status: 'ASSIGNED', currentOrderId: order.id } });
    }
  }
  const newLive = live + candidates.length;
  return { added: candidates.length, fully: newLive >= order.qty, live: newLive };
}

export async function markProxyFaulty({
  proxyId, actor, reason, autoReplace,
}: { proxyId: string; actor: Actor; reason: string; autoReplace: boolean }) {
  const outbox: { chatId: string | null; text: string }[] = [];
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: { include: { client: { select: { id: true, telegramChatId: true, telegramAll: true, email: true, emailIncidents: true } } } } } } },
    });
    if (!proxy) throw new Error('Proxy not found');

    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: 'FAULTY', health: 'OFFLINE' },
    });

    // Optionally auto-replace: close the old assignment, bind a fresh proxy.
    let replacement: string | null = null;
    let replacedOrderId: string | null = null;
    if (autoReplace && proxy.assignments.length > 0) {
      const a = proxy.assignments[0];
      const candidate = await tx.proxy.findFirst({
        where: { carrier: proxy.carrier, region: proxy.region, pool: proxy.pool, status: 'AVAILABLE', health: 'HEALTHY' },
      });
      if (candidate) {
        await tx.assignment.update({
          where: { id: a.id },
          data: { releasedAt: new Date(), reason: 'REPLACEMENT', reasonDetail: `Replaced by ${candidate.id}` },
        });
        await tx.proxy.update({ where: { id: proxyId }, data: { currentOrderId: null, status: 'RELEASED' } });
        const [aid] = await newAssignmentIds(tx, 1);
        await tx.assignment.create({
          data: { id: aid, orderId: a.orderId, proxyId: candidate.id, actorId: actor.id, reason: 'REPLACEMENT', reasonDetail: `Replaces ${proxyId}` },
        });
        await tx.proxy.update({ where: { id: candidate.id }, data: { status: 'ASSIGNED', currentOrderId: a.orderId } });
        replacement = candidate.id;
        replacedOrderId = a.orderId;
      }
    }

    // Reconcile exception + notify the client for every affected order.
    // (Previously silent when the order already carried any exception — a
    // second fault on the same order left the client uninformed.)
    for (const a of proxy.assignments) {
      if (replacedOrderId === a.orderId) {
        // Replacement filled the gap — refresh (may clear if now full).
        await refreshProvisionException(tx, a.orderId);
        await notify(tx, a.order.clientId, `Faulty proxy ${proxyId} replaced with ${replacement}`, 'SUCCESS', `/proxies/${replacement}`);
        outbox.push({ chatId: a.order.client.telegramAll ? a.order.client.telegramChatId : null, text: `⚠️ A proxy on order ${a.orderId} failed and was automatically replaced with ${replacement}. No action needed.` });
        if (a.order.client.emailIncidents) {
          emailOutbox.push({ to: a.order.client.email, ...incidentEmail(
            `Proxy replaced on order ${a.orderId}`,
            [`A proxy on order <strong>${a.orderId}</strong> failed and was automatically replaced with <strong>${replacement}</strong>.`,
             'No action is needed — fresh credentials are in your portal.'],
            `/orders/${a.orderId}`, 'View order') });
        }
      } else {
        const st = await refreshProvisionException(tx, a.orderId);
        const frac = st ? `${st.live}/${st.qty} proxies attached` : 'replacement pending';
        await notify(tx, a.order.clientId,
          `Proxy ${proxyId} on order ${a.orderId} flagged faulty — a replacement is being arranged (${frac})`,
          'WARNING', `/orders/${a.orderId}`);
        outbox.push({ chatId: a.order.client.telegramAll ? a.order.client.telegramChatId : null, text: `⚠️ A proxy on your order ${a.orderId} was flagged faulty. ${frac} — a replacement is being arranged.` });
        if (a.order.client.emailIncidents) {
          emailOutbox.push({ to: a.order.client.email, ...incidentEmail(
            `Proxy issue on order ${a.orderId}`,
            [`Proxy <strong>${proxyId}</strong> on order <strong>${a.orderId}</strong> was flagged faulty (${frac}).`,
             'A replacement is being arranged — we’ll notify you when it’s ready.'],
            `/orders/${a.orderId}`, 'View order') });
        }
      }
    }

    await log(tx, actor.id, 'PROXY.MARK_FAULTY', 'PROXY', proxyId,
      `Faulty · ${reason}${autoReplace ? ` · auto-replace=${replacement ?? 'no candidate'}` : ''}`);
    return { ok: true, replacement };
  });
  for (const m of outbox) await sendTelegram(m.chatId, m.text);
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

// Swap ONE serving proxy on an order for a fresh healthy one from the same
// pool. Standalone action (the prototype's "Replace" flow): the old proxy is
// released back to the pool and a new AVAILABLE+HEALTHY proxy takes its slot,
// so the order's live count is unchanged and the client gets new credentials.
// Pool-first: exact carrier+region+pool, then carrier+region.
// newProxyId picks a SPECIFIC replacement (admin override — any AVAILABLE
// healthy proxy, pool/region are soft preferences); omitted ⇒ auto pool-first
// pick as before. reason is the admin's replacement reason — it lands in the
// released assignment's reasonDetail and the audit log (NOT in client-facing
// notifications: the client sees the swap, not the internal cause).
export async function replaceProxy({ orderId, proxyId, actor, newProxyId, reason }: {
  orderId: string; proxyId: string; actor: Actor; newProxyId?: string; reason?: string;
}) {
  // Required reason (owner rule) — enforced at the server, not only in the
  // modal, so no direct action call can skip it. Trimmed + capped to match the
  // clientRequestReplacement precedent.
  const cleanReason = (reason ?? '').trim().slice(0, 100);
  if (!cleanReason) throw new Error('A replacement reason is required');
  const outbox: { chatId: string | null; text: string }[] = [];
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const assignment = await tx.assignment.findFirst({
      where: { orderId, proxyId, releasedAt: null },
      include: {
        proxy: true,
        order: { include: { plan: { select: { carrier: true, pool: true } }, client: { select: { id: true, telegramChatId: true, telegramAll: true, email: true, emailIncidents: true } } } },
      },
    });
    if (!assignment) throw new Error('That proxy is not currently assigned to this order');
    const old = assignment.proxy;
    const ord = assignment.order;
    // Capture whether this order carried a client-raised replacement request:
    // the deficit reconciler now leaves those alone, so the admin's Replace
    // (the resolution) must clear it explicitly below.
    const wasClientRequest = ord.exception === 'REPLACEMENT_PENDING' && (ord.excInfo ?? '').startsWith(CLIENT_REQUEST_PREFIX);
    // Server-side status gate (was UI-only): the bulk bar could reach a
    // suspended/expired order's stray open assignment.
    if (!['ACTIVE', 'PROVISIONING'].includes(ord.status)) {
      throw new Error(`Cannot replace a proxy on a ${ord.status.toLowerCase()} order`);
    }

    let candidate;
    if (newProxyId) {
      if (newProxyId === proxyId) throw new Error('Replacement must be a different proxy');
      const p = await tx.proxy.findUnique({ where: { id: newProxyId } });
      if (!p) throw new Error(`Proxy ${newProxyId} not found`);
      if (p.status !== 'AVAILABLE') throw new Error(`Proxy ${newProxyId} is ${p.status}`);
      if (p.health !== 'HEALTHY') throw new Error(`Proxy ${newProxyId} is ${p.health} — a replacement must be healthy`);
      candidate = p;
    } else {
      const pick = async (where: any) => tx.proxy.findFirst({
        where: { ...where, status: 'AVAILABLE', health: 'HEALTHY', id: { not: proxyId } },
      });
      candidate =
        (await pick({ carrier: ord.plan.carrier, region: ord.region, pool: ord.plan.pool })) ??
        (await pick({ carrier: ord.plan.carrier, region: ord.region }));
      if (!candidate) throw new Error(`No healthy proxy available in ${ord.plan.carrier} · ${ord.region} to replace ${proxyId} — pick one manually from another pool`);
    }

    const now = new Date();
    // Release the old proxy back to the pool with security-reset markers. The
    // machine-generated "Replaced by X" prefix stays — the history table's
    // old→new linkage reads it; the human reason is appended after it.
    await tx.assignment.update({
      where: { id: assignment.id },
      data: { releasedAt: now, reason: 'REPLACEMENT', reasonDetail: `Replaced by ${candidate.id} — ${cleanReason}` },
    });
    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: 'RELEASED', health: 'HEALTHY', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
    });
    // Assign the fresh proxy into the freed slot.
    const [aid] = await newAssignmentIds(tx, 1);
    await tx.assignment.create({
      data: { id: aid, orderId, proxyId: candidate.id, actorId: actor.id, assignedAt: now, reason: 'REPLACEMENT', reasonDetail: `Replaces ${proxyId}` },
    });
    await tx.proxy.update({ where: { id: candidate.id }, data: { status: 'ASSIGNED', currentOrderId: orderId } });

    await refreshProvisionException(tx, orderId);
    // A client-raised replacement request is resolved by this Replace — the
    // reconciler leaves it alone, so clear it here (unless a real deficit still
    // flags the order through the reconciler above).
    if (wasClientRequest) {
      const still = await tx.order.findUnique({ where: { id: orderId }, select: { exception: true, excInfo: true } });
      if (still?.exception === 'REPLACEMENT_PENDING' && (still.excInfo ?? '').startsWith(CLIENT_REQUEST_PREFIX)) {
        await tx.order.update({ where: { id: orderId }, data: { exception: null, excInfo: null } });
      }
    }
    await notify(tx, ord.clientId,
      `A proxy on order ${orderId} was replaced — ${candidate.id} is ready with fresh credentials`,
      'SUCCESS', `/orders/${orderId}`);
    outbox.push({ chatId: ord.client.telegramAll ? ord.client.telegramChatId : null,
      text: `✅ A proxy on your order ${orderId} was replaced with a fresh one (${candidate.id}). New credentials are in your portal.` });
    if (ord.client.emailIncidents) {
      emailOutbox.push({ to: ord.client.email, ...incidentEmail(
        `Proxy replaced on order ${orderId}`,
        [`A proxy on order <strong>${orderId}</strong> was replaced — <strong>${candidate.id}</strong> is ready with fresh credentials in your portal.`],
        `/orders/${orderId}`, 'View order') });
    }
    await log(tx, actor.id, 'PROXY.REPLACE', 'PROXY', proxyId,
      `Replaced with ${candidate.id} on order ${orderId} · old proxy released to pool · reason: ${cleanReason}${newProxyId ? ' · picked manually' : ''}`);
    return { ok: true as const, replacement: candidate.id, released: proxyId };
  });
  for (const m of outbox) await sendTelegram(m.chatId, m.text);
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

export async function releaseProxy({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  const outbox: { chatId: string | null; text: string }[] = [];
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: { include: { client: { select: { id: true, telegramChatId: true, telegramAll: true, email: true, emailIncidents: true } } } } } } },
    });
    if (!proxy) throw new Error('Proxy not found');
    await tx.assignment.updateMany({
      where: { proxyId, releasedAt: null },
      data: { releasedAt: new Date(), reason: 'CANCEL', reasonDetail: 'Admin released' },
    });
    await tx.proxy.update({ where: { id: proxyId }, data: { status: 'RELEASED', currentOrderId: null } });
    // The client's proxy just vanished from their portal. Flag the deficit on
    // active orders (was silently left "healthy") and tell the client.
    for (const a of proxy.assignments) {
      const st = await refreshProvisionException(tx, a.orderId);
      const stillActive = a.order.status === 'ACTIVE' || a.order.status === 'PROVISIONING';
      const frac = st ? `${st.live}/${st.qty} proxies attached` : '';
      await notify(tx, a.order.clientId,
        stillActive
          ? `Proxy ${proxyId} on order ${a.orderId} was released — a replacement is being arranged (${frac})`
          : `Proxy ${proxyId} on order ${a.orderId} was released by support — contact us if this is unexpected`,
        'WARNING', `/orders/${a.orderId}`);
      outbox.push({ chatId: a.order.client.telegramAll ? a.order.client.telegramChatId : null,
        text: stillActive
          ? `⚠️ A proxy on your order ${a.orderId} was released. ${frac} — a replacement is being arranged.`
          : `A proxy on your order ${a.orderId} was released by support. Contact us if this is unexpected.` });
      // Faulty→release is the canonical two-step flow: mark-faulty already
      // emailed "a replacement is being arranged" with the same fraction —
      // a second identical email adds nothing (review find). Bell/log stay.
      if (a.order.client.emailIncidents && proxy.status !== 'FAULTY') {
        emailOutbox.push({ to: a.order.client.email, ...incidentEmail(
          `Proxy released on order ${a.orderId}`,
          stillActive
            ? [`Proxy <strong>${proxyId}</strong> on order <strong>${a.orderId}</strong> was released (${frac}).`,
               'A replacement is being arranged — we’ll notify you when it’s ready.']
            : [`Proxy <strong>${proxyId}</strong> on order <strong>${a.orderId}</strong> was released by support.`,
               'Contact us if this is unexpected.'],
          `/orders/${a.orderId}`, 'View order') });
      }
    }
    await log(tx, actor.id, 'PROXY.RELEASE', 'PROXY', proxyId, 'Manually released');
    return { ok: true };
  });
  for (const m of outbox) await sendTelegram(m.chatId, m.text);
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

// RELEASED → AVAILABLE. Same security-reset markers cancelOrder stamps when it
// returns proxies to pool: the next client must never inherit live credentials.
export async function returnProxyToPool({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');
    if (proxy.status !== 'RELEASED') throw new Error(`Only RELEASED proxies can return to pool (this one is ${proxy.status})`);
    const now = new Date();
    // Returning to the pool asserts the proxy is serviceable again — reset
    // health too, or an OFFLINE marker left over from a prior faulty flag would
    // leave it AVAILABLE+OFFLINE (invisible to auto-fill, mislabelled faulty).
    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: 'AVAILABLE', health: 'HEALTHY', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
    });
    await log(tx, actor.id, 'PROXY.RETURN_TO_POOL', 'PROXY', proxyId, 'Returned to pool · health reset · credentials/IP rotation markers stamped');
    return { ok: true };
  });
}

// FAULTY → healthy. If an order is still attached the proxy goes back to
// serving it (ASSIGNED) and the replacement-pending exception clears;
// otherwise it returns to the pool as AVAILABLE.
export async function markProxyHealthy({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: { include: { client: { select: { email: true, emailIncidents: true } } } } } } },
    });
    if (!proxy) throw new Error('Proxy not found');
    if (proxy.status !== 'FAULTY') throw new Error(`Only FAULTY proxies can be marked healthy (this one is ${proxy.status})`);

    const active = proxy.assignments[0];
    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: active ? 'ASSIGNED' : 'AVAILABLE', health: 'HEALTHY', currentOrderId: active ? active.orderId : null },
    });
    if (active && active.order.exception === 'REPLACEMENT_PENDING') {
      await tx.order.update({ where: { id: active.orderId }, data: { exception: null, excInfo: null } });
      await notify(tx, active.order.clientId,
        `Proxy ${proxyId} on order ${active.orderId} is healthy again — no replacement needed`,
        'SUCCESS', `/orders/${active.orderId}`);
      if (active.order.client.emailIncidents) {
        emailOutbox.push({ to: active.order.client.email, ...incidentEmail(
          `Proxy ${proxyId} is healthy again`,
          [`Proxy <strong>${proxyId}</strong> on order <strong>${active.orderId}</strong> is healthy again — no replacement is needed.`],
          `/orders/${active.orderId}`, 'View order') });
      }
    }
    await log(tx, actor.id, 'PROXY.MARK_HEALTHY', 'PROXY', proxyId,
      `Healthy again · ${active ? `back to serving ${active.orderId}` : 'returned to pool'}`);
    return { ok: true, backTo: active ? active.orderId : null };
  });
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

// AVAILABLE/ASSIGNED ↔ MAINTENANCE. Entering maintenance PRESERVES any open
// assignment (the client keeps the proxy on paper; it just stops being
// eligible for new work); leaving restores ASSIGNED/AVAILABLE accordingly.
export async function setProxyMaintenance({ proxyId, on, actor }: { proxyId: string; on: boolean; actor: Actor }) {
  const outbox: { chatId: string | null; text: string }[] = [];
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  const result = await prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, take: 1, include: { order: { include: { client: { select: { id: true, telegramChatId: true, telegramAll: true, email: true, emailIncidents: true } } } } } } },
    });
    if (!proxy) throw new Error('Proxy not found');
    if (on) {
      if (proxy.status !== 'AVAILABLE' && proxy.status !== 'ASSIGNED') {
        throw new Error(`Only AVAILABLE or ASSIGNED proxies can enter maintenance (this one is ${proxy.status})`);
      }
      await tx.proxy.update({ where: { id: proxyId }, data: { status: 'MAINTENANCE' } });
    } else {
      if (proxy.status !== 'MAINTENANCE') throw new Error('Proxy is not in maintenance');
      const active = proxy.assignments[0];
      // health:'HEALTHY' keeps the AVAILABLE/ASSIGNED ⟹ HEALTHY invariant.
      await tx.proxy.update({
        where: { id: proxyId },
        data: { status: active ? 'ASSIGNED' : 'AVAILABLE', health: 'HEALTHY', currentOrderId: active ? active.orderId : null },
      });
    }
    // A proxy in maintenance is still on the client's order — tell them, or the
    // portal would keep showing it "Healthy" while service is interrupted. A
    // SUSPENDED order has its access withdrawn (the proxy is hidden from the
    // portal), so notifying about it would only confuse — skip those.
    const active = proxy.assignments[0];
    if (active && active.order.status !== 'SUSPENDED') {
      await notify(tx, active.order.clientId,
        on
          ? `Proxy ${proxyId} on order ${active.orderId} is under maintenance — service may be briefly interrupted`
          : `Proxy ${proxyId} on order ${active.orderId} is back in service after maintenance`,
        on ? 'WARNING' : 'SUCCESS', `/proxies/${proxyId}`);
      outbox.push({ chatId: active.order.client.telegramAll ? active.order.client.telegramChatId : null,
        text: on
          ? `🛠 Proxy ${proxyId} on your order ${active.orderId} is under maintenance — service may be briefly interrupted. We'll notify you when it's back.`
          : `✅ Proxy ${proxyId} on your order ${active.orderId} is back in service after maintenance.` });
      if (active.order.client.emailIncidents) {
        emailOutbox.push({ to: active.order.client.email, ...incidentEmail(
          on ? `Maintenance on proxy ${proxyId}` : `Proxy ${proxyId} back in service`,
          on
            ? [`Proxy <strong>${proxyId}</strong> on order <strong>${active.orderId}</strong> is under maintenance — service may be briefly interrupted.`,
               'We’ll notify you when it’s back.']
            : [`Proxy <strong>${proxyId}</strong> on order <strong>${active.orderId}</strong> is back in service after maintenance.`],
          `/proxies/${proxyId}`, 'View proxy') });
      }
    }
    await log(tx, actor.id, 'PROXY.MAINTENANCE', 'PROXY', proxyId, on ? 'Entered maintenance' : 'Left maintenance');
    return { ok: true };
  });
  for (const m of outbox) await sendTelegram(m.chatId, m.text);
  for (const e of emailOutbox) await sendEmail(e);
  return result;
}

/* ════════════════════════════════════════════════════════════════════════
   PLANS
   ════════════════════════════════════════════════════════════════════════ */

// At most this many plans may be active AND public (i.e. shown as cards) at once.
// Admins can keep unlimited internal/disabled plans; only the publicly-sellable
// set is capped — it maps 1:1 to the (≤3) plan cards on marketing + the portal.
export const MAX_ACTIVE_PUBLIC_PLANS = 3;

// The client sees ONE card per duration (location variants collapse —
// see plan-tiers.collapseLiveByDuration), so the cap counts DISTINCT
// DURATIONS, not plan rows: a same-duration sibling in another location
// joins the existing card and does not consume a slot. `excludePlanId`
// omits the plan being changed so re-saving never trips the cap.
async function assertActivePublicCapAvailable(tx: Tx, excludePlanId: string | null, durationDays: number) {
  const rows = await tx.plan.findMany({
    where: {
      active: true, visibility: 'PUBLIC', deletedAt: null,
      ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
    },
    select: { durationDays: true },
  });
  const durations = new Set(rows.map(r => r.durationDays));
  if (!durations.has(durationDays) && durations.size >= MAX_ACTIVE_PUBLIC_PLANS) {
    throw new Error(`Limit reached: only ${MAX_ACTIVE_PUBLIC_PLANS} durations can be active and public at once (one client card per duration). Disable another duration first.`);
  }
}

// One active+public plan per (duration, location): a duplicate would be
// unreachable in checkout — its Location select resolves the plan as
// plans.find(p => p.region === location), first match wins.
async function assertDurationRegionUnique(tx: Tx, durationDays: number, region: string, excludePlanId: string | null) {
  const dup = await tx.plan.findFirst({
    where: {
      active: true, visibility: 'PUBLIC', deletedAt: null, durationDays, region,
      ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (dup) {
    throw new Error(`${dup.id} ("${dup.name}") already sells the ${durationDays}-day plan in ${region} — one active plan per duration + location. Edit that plan, pick another location, or disable it first.`);
  }
}

export async function togglePlanActive({
  planId, actor, active, reason,
}: { planId: string; actor: Actor; active: boolean; reason?: string }) {
  return prisma.$transaction(async tx => {
    const plan = await tx.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error('Plan not found');
    if (plan.active === active) return { ok: true, noop: true };
    // Enabling a public plan: a NEW duration consumes one of the 3 card
    // slots; a same-duration sibling must not collide on location.
    if (active && plan.visibility === 'PUBLIC') {
      await assertActivePublicCapAvailable(tx, planId, plan.durationDays);
      await assertDurationRegionUnique(tx, plan.durationDays, plan.region, planId);
    }
    await tx.plan.update({ where: { id: planId }, data: { active } });
    await log(tx, actor.id, 'PLAN.UPDATE', 'PLAN', planId, `${active ? 'Enabled' : 'Disabled'}${reason ? ' · ' + reason : ''} — ${active ? 'visible in client catalog' : 'hidden from client catalog'}`);
    return { ok: true };
  });
}

export type PlanInput = {
  name: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'INTERNAL';
  carrier: string;
  region: string;
  pool: string;
  durationDays: number;
  price: number;
  currency: string;
  availableQuota: number;
  protocols?: string | null;
  rotation?: string | null;
  traffic?: string | null;
  active: boolean;
  autoProvision: boolean;
  autoRenewDefault: boolean;
  renewalAllowed: boolean;
  preRenewalReminderHours: number | null; // null = inherit the global Settings default
  renewalDiscountPct: number;
  lowCapacityThresholdPct?: number | null;
};

async function nextPlanId(tx: Tx, carrier: string, durationDays: number) {
  // Try human-readable form first: PLAN-VRZN-30D
  const carrierAbbr = carrier.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  const base = `PLAN-${carrierAbbr}-${durationDays}D`;
  const exists = await tx.plan.findUnique({ where: { id: base } });
  if (!exists) return base;
  // Fallback to numeric suffix
  let n = 2;
  while (await tx.plan.findUnique({ where: { id: `${base}-${n}` } })) n++;
  return `${base}-${n}`;
}

export async function createPlan({ input, actor }: { input: PlanInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    if (!input.name?.trim()) throw new Error('Plan name is required');
    if (input.price < 0 || input.price > 99999) throw new Error('Price must be between 0 and 99999');
    if (input.availableQuota < 0 || input.availableQuota > 9999) throw new Error('Quota must be between 0 and 9999');
    if (input.durationDays <= 0) throw new Error('Duration must be > 0');
    if (input.preRenewalReminderHours != null && (!Number.isInteger(input.preRenewalReminderHours) || input.preRenewalReminderHours < 0 || input.preRenewalReminderHours > 720)) {
      throw new Error('Pre-renewal reminder must be an integer 0..720 hours, or blank to inherit the global default');
    }
    if (input.active && input.visibility === 'PUBLIC') {
      await assertActivePublicCapAvailable(tx, null, input.durationDays);
      await assertDurationRegionUnique(tx, input.durationDays, input.region, null);
    }

    const id = await nextPlanId(tx, input.carrier, input.durationDays);
    const sku = id.replace('PLAN-', 'SKU-');

    const plan = await tx.plan.create({
      data: {
        id,
        name: input.name.trim(),
        internalSku: sku,
        description: input.description?.trim() || null,
        visibility: input.visibility,
        carrier: input.carrier,
        region: input.region,
        pool: input.pool,
        durationDays: input.durationDays,
        price: input.price,
        currency: input.currency || 'USD',
        protocols: input.protocols?.trim() || null,
        rotation: input.rotation?.trim() || null,
        traffic: input.traffic?.trim() || null,
        availableQuota: input.availableQuota,
        active: input.active,
        autoProvision: input.autoProvision,
        autoRenewDefault: input.autoRenewDefault,
        renewalAllowed: input.renewalAllowed,
        preRenewalReminderHours: input.preRenewalReminderHours,
        renewalDiscountPct: input.renewalDiscountPct,
        lowCapacityThresholdPct: input.lowCapacityThresholdPct ?? null,
      },
    });

    await log(tx, actor.id, 'PLAN.CREATE', 'PLAN', plan.id,
      `Created ${plan.name} · ${plan.carrier} · ${plan.region} · ${plan.durationDays}d · ${money(Number(plan.price))} · quota=${plan.availableQuota}${plan.active ? ' · published to client portal' : ' · disabled'}`);

    return { ok: true, planId: plan.id };
  });
}

export async function updatePlan({ planId, input, actor }: { planId: string; input: Partial<PlanInput>; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const before = await tx.plan.findUnique({ where: { id: planId } });
    if (!before) throw new Error('Plan not found');

    const data: any = {};
    const diffs: string[] = [];
    for (const k of Object.keys(input) as (keyof PlanInput)[]) {
      const v = (input as any)[k];
      if (v === undefined) continue;
      const old = (before as any)[k];
      const oldNum = old != null && typeof old === 'object' && 'toNumber' in old ? old.toNumber() : old;
      if (oldNum !== v) {
        data[k] = v;
        if (k === 'description' || k === 'protocols' || k === 'rotation' || k === 'traffic') continue; // skip long text in diff line
        diffs.push(`${k}: ${oldNum} → ${v}`);
      }
    }
    if (Object.keys(data).length === 0) return { ok: true, noop: true };

    // Guard the card invariants whenever the RESULTING plan is active+public
    // and this edit changes its membership, duration or location: cap =
    // 3 distinct durations; (duration, location) unique within the set.
    const willActive = data.active ?? before.active;
    const willVisibility = data.visibility ?? before.visibility;
    const willDuration = data.durationDays ?? before.durationDays;
    const willRegion = data.region ?? before.region;
    const wasActivePublic = before.active && before.visibility === 'PUBLIC';
    if (willActive && willVisibility === 'PUBLIC'
        && (!wasActivePublic || data.durationDays !== undefined || data.region !== undefined)) {
      await assertActivePublicCapAvailable(tx, planId, willDuration);
      await assertDurationRegionUnique(tx, willDuration, willRegion, planId);
    }

    await tx.plan.update({ where: { id: planId }, data });
    await log(tx, actor.id, 'PLAN.UPDATE', 'PLAN', planId, diffs.join(' · ') || 'updated');
    return { ok: true };
  });
}

export async function deletePlan({ planId, actor }: { planId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const plan = await tx.plan.findUnique({ where: { id: planId }, include: { orders: { where: { status: { in: ['ACTIVE', 'PROVISIONING', 'NEW', 'PENDING_RENEWAL'] } }, take: 1 } } });
    if (!plan) throw new Error('Plan not found');
    if (plan.orders.length > 0) throw new Error('Cannot delete a plan with active orders — disable it instead');
    await tx.plan.update({ where: { id: planId }, data: { deletedAt: new Date(), active: false } });
    await log(tx, actor.id, 'PLAN.DELETE', 'PLAN', planId, `Deleted ${plan.name} — removed from client catalog`);
    return { ok: true };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   CLIENTS / BALANCE
   ════════════════════════════════════════════════════════════════════════ */

export async function adjustBalance({
  userId, actor, delta, reason, note,
}: { userId: string; actor: Actor; delta: number; reason: string; note?: string }) {
  // Normalize the admin-typed amount ONCE — helper and ledger row must see
  // the identical 2dp value or SUM(ledger) drifts from balance (review find).
  delta = delta >= 0 ? roundCents(delta) : -roundCents(-delta);
  return prisma.$transaction(async tx => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new Error('User not found');
    // Atomic (P1-1): the negative-result guard rides the debit UPDATE itself.
    let newBalance: number;
    if (delta >= 0) {
      newBalance = await creditBalance(tx, userId, delta);
    } else {
      try { newBalance = await debitBalance(tx, userId, -delta); }
      catch (e) {
        if (e instanceof InsufficientBalance) throw new Error('Adjustment would create negative balance');
        throw e;
      }
    }
    await tx.balanceLedgerEntry.create({
      data: {
        userId, op: 'MANUAL_ADJUST', amount: delta, balanceAfter: newBalance,
        note: note ? `${reason} — ${note}` : reason,
      },
    });

    await notify(tx, userId,
      delta >= 0
        ? `Balance credit: +${money(delta)} · ${reason}`
        : `Balance debit: -${money(Math.abs(delta))} · ${reason}`,
      delta >= 0 ? 'SUCCESS' : 'WARNING', '/billing',
    );
    await log(tx, actor.id, 'CLIENT.BALANCE_ADJUST', 'CLIENT', userId,
      `${delta >= 0 ? '+' : '-'}${money(Math.abs(delta))} · ${reason}${note ? ' · ' + note : ''} → balance=${money(newBalance)}`);
    return { ok: true, newBalance };
  });
}

export async function blockClient({
  userId, actor, reason, suspendActiveOrders,
}: { userId: string; actor: Actor; reason: string; suspendActiveOrders: boolean }) {
  return prisma.$transaction(async tx => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('User not found');
    await tx.user.update({
      where: { id: userId },
      data: { status: 'BLOCKED', blockedAt: new Date(), blockedReason: reason },
    });

    let suspended = 0;
    if (suspendActiveOrders) {
      const active = await tx.order.findMany({ where: { clientId: userId, status: 'ACTIVE' } });
      for (const o of active) {
        await tx.order.update({
          where: { id: o.id },
          // renewalBucket: null — same bucket hygiene as suspendOrder/
          // cancelOrder (review find: this third SUSPENDED writer kept
          // minting stale-bucket rows, and a later resume would re-classify
          // from the stale sticky instead of a clean slate).
          data: { status: 'SUSPENDED', autoRenewBeforeSuspend: o.autoRenew, autoRenew: false, renewalBucket: null },
        });
        suspended++;
      }
    }
    await log(tx, actor.id, 'CLIENT.BLOCK', 'CLIENT', userId,
      `Blocked · ${reason}${suspended ? ` · ${suspended} active orders suspended` : ''}`);
    return { ok: true, suspended };
  });
}

export async function unblockClient({ userId, actor }: { userId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE', blockedAt: null, blockedReason: null } });
    await log(tx, actor.id, 'CLIENT.UPDATE', 'CLIENT', userId, 'Unblocked');
    return { ok: true };
  });
}

export type NewClientInput = {
  name: string;
  email: string;
  password?: string;
  telegram?: string | null;
  country?: string | null;
  tier?: 'STANDARD' | 'PRO' | 'VIP';
  risk?: 'NONE' | 'REVIEW' | 'FLAG';
  riskNote?: string | null;
  acquisition?: string | null;
};

const nextUserIdInTx = (tx: Tx) => nextUserId(tx);

export async function createClient({ input, actor }: { input: NewClientInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    if (!input.name?.trim()) throw new Error('Name required');
    if (!input.email?.trim()) throw new Error('Email required');
    const email = input.email.trim().toLowerCase();
    const dup = await tx.user.findUnique({ where: { email } });
    if (dup) throw new Error('Email already in use');
    const id = await nextUserIdInTx(tx);
    // Generated temp passwords satisfy the account policy (8+/upper/digit) by
    // construction with crypto entropy; admin-typed ones go through the same
    // shared rule. The assert holds for BOTH branches.
    const password = input.password?.trim() || generateTempPassword();
    const policyErr = passwordPolicyError(password);
    if (policyErr) throw new Error(policyErr);
    const passwordHash = await bcrypt.hash(password, 10);
    await tx.user.create({
      data: {
        id,
        name: input.name.trim(),
        email,
        passwordHash,
        // Admin-created accounts skip email verification: the admin vouches,
        // and credentials are handed over out-of-band anyway.
        emailVerifiedAt: new Date(),
        role: 'CLIENT',
        tier: input.tier ?? 'STANDARD',
        risk: input.risk ?? 'NONE',
        riskNote: input.riskNote?.trim() || null,
        telegram: input.telegram?.trim() || null,
        country: input.country?.trim() || null,
        acquisition: input.acquisition?.trim() || null,
      },
    });
    // Seed locked balance method
    await tx.paymentMethod.create({
      data: { id: `pm_balance_${id.toLowerCase()}`, userId: id, kind: 'BALANCE', brand: 'Account balance', locked: true },
    });
    await log(tx, actor.id, 'CLIENT.CREATE', 'CLIENT', id,
      `Created ${input.name.trim()} · ${email}${input.tier && input.tier !== 'STANDARD' ? ' · ' + input.tier : ''}${input.risk && input.risk !== 'NONE' ? ' · risk=' + input.risk : ''}`);
    return { ok: true, clientId: id, generatedPassword: input.password ? undefined : password };
  });
}

export type UpdateClientInput = {
  name?: string;
  telegram?: string | null;
  country?: string | null;
  tier?: 'STANDARD' | 'PRO' | 'VIP';
  risk?: 'NONE' | 'REVIEW' | 'FLAG';
  riskNote?: string | null;
  preferredCarrier?: string | null;
  preferredRegion?: string | null;
  emailRenewal?: boolean;
  emailIncidents?: boolean;
  emailMarketing?: boolean;
  telegramAll?: boolean;
  preRenewalReminderHours?: number | null; // null = inherit plan → global (reminder cascade)
  graceHoursOverride?: number | null; // null = tier default (lib/grace.ts)
};

export async function updateClient({
  userId, input, actor,
}: { userId: string; input: UpdateClientInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before || before.role !== 'CLIENT') throw new Error('Client not found');
    const data: any = {};
    const diffs: string[] = [];
    for (const k of Object.keys(input) as (keyof UpdateClientInput)[]) {
      const v = (input as any)[k];
      if (v === undefined) continue;
      const old = (before as any)[k];
      if (old !== v) {
        data[k] = v;
        if (k === 'riskNote') continue; // long text — skip diff
        diffs.push(`${k}: ${old ?? '∅'} → ${v ?? '∅'}`);
      }
    }
    if (Object.keys(data).length === 0) return { ok: true, noop: true };
    await tx.user.update({ where: { id: userId }, data });
    const action = input.risk !== undefined && input.risk !== before.risk ? 'CLIENT.RISK_UPDATE' : 'CLIENT.UPDATE';
    await log(tx, actor.id, action, 'CLIENT', userId, diffs.join(' · ') || 'updated');
    return { ok: true };
  });
}

export type NewOrderInput = {
  clientId: string;
  planId: string;
  qty: number;
  discountPct?: number;
  // Flat $ off the total — the alternative to discountPct (at most one set).
  discountUsd?: number;
  paymentMethod: 'stripe' | 'invoice' | 'crypto' | 'comp';
  autoAssign?: boolean;
  autoRenew?: boolean;
  // Optional custom expiry (ISO datetime), any method. Born-ACTIVE orders
  // consume it immediately; otherwise it persists in customExpiresAt and is
  // applied at first activation. Bounds: strictly after now, strictly before
  // now + plan.durationDays.
  expiresAt?: string | null;
};

// ORD-/PAY- are random by product rule (2026-07-06) — uniqueness-checked
// against the base table, PK is the hard guard. INV- stays sequential via
// its sequence.
const nextOrderIdInTx = (_tx: Tx) => nextOrderId();
const nextPaymentIdInTx = (_tx: Tx) => nextPaymentId();
const nextInvoiceIdInTx = (tx: Tx) => nextInvoiceId(tx);

export async function createOrderByAdmin({ input, actor }: { input: NewOrderInput; actor: Actor }) {
  // Built inside the tx, sent after commit (no HTTP inside $transaction).
  let adminAlert: string | null = null;
  const result = await prisma.$transaction(async tx => {
    const client = await tx.user.findUnique({ where: { id: input.clientId } });
    if (!client || client.role !== 'CLIENT') throw new Error('Client not found');
    if (client.status === 'BLOCKED') throw new Error('Client is blocked');

    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.active || plan.deletedAt) throw new Error('Plan unavailable');

    // Input bounds, custom-expiry rule, and money math live in
    // new-order-policy.ts (pure, standalone-tested).
    const discount = input.discountPct ?? 0;
    const discountUsd = input.discountUsd ?? 0;
    assertNewOrderBounds(input.qty, discount, discountUsd, Number(plan.price));

    const isInstant = isInstantMethod(input.paymentMethod);
    const now = new Date();

    // Owner decision 2026-08-22: admin-created orders are Crypto (off-site
    // transfer confirmed via Mark paid) or Comp only — Stripe (mock) and bank
    // transfer removed from the product. The action is callable directly, so
    // refuse here too, not just in the modal.
    if (input.paymentMethod === 'stripe' || input.paymentMethod === 'invoice') {
      throw new Error('Admin-created orders can only be Crypto (confirm via Mark paid) or Comp');
    }

    const customExpires = resolveCustomExpiry(input.expiresAt, input.paymentMethod, plan.durationDays, now);

    // Serialize concurrent creates on this plan — the quota check below is
    // read-then-write, so without a lock two simultaneous orders both read the
    // same allocation and oversell (same recipe as reprovisionRenewedOrder /
    // assignProxyManually, which lock the order row for the same reason).
    await tx.$queryRaw`SELECT id FROM plans WHERE id = ${plan.id} FOR UPDATE`;

    // Capacity check
    const alloc = await tx.order.aggregate({
      _sum: { qty: true },
      where: { planId: plan.id, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    if (plan.availableQuota - (alloc._sum.qty ?? 0) < input.qty) throw new Error('Plan capacity insufficient');

    const isComp = input.paymentMethod === 'comp';
    const { unitPrice, total, fees, net } = newOrderMoney(Number(plan.price), discount, discountUsd, input.qty, input.paymentMethod);
    // Only Comp may be $0. A 100% discount on a paid method would otherwise mint
    // a $0 "paid" order (Stripe invoice / eternal $0 AWAITING) that bypasses the
    // Comp semantics and the Provider=Comp filter — the modal blocks it, mirror
    // that on the server (the action is callable directly past the UI).
    if (!isComp && total <= 0) {
      throw new Error('Total must be greater than $0 — use the Comp method for a free order');
    }
    const willActivate = isInstant && plan.autoProvision;
    // Snapshot the admin's auto-assign choice onto the order. autoAssign OFF on
    // an auto-provision plan means "hold for manual assignment" — persist that
    // as autoProvision:false so the sweep's backfill (which keys on
    // order.autoProvision) doesn't grab arbitrary proxies on the next tick and
    // override the choice. autoAssign ON (default) leaves the plan snapshot.
    // Instant methods only: the modal greys the toggle out for invoice/crypto,
    // so an OFF arriving with them is stale UI state — honoring it would
    // silently hold provisioning at payment confirmation (review find).
    const orderAutoProvision = plan.autoProvision && (isInstant ? (input.autoAssign ?? true) : true);
    // (Term is computed as `finalExpires` below — the order create uses that;
    // no pay-time expiry here.)

    const orderId = await nextOrderIdInTx(tx);
    const payId = await nextPaymentIdInTx(tx);

    // Pre-assign attempt — try to grab proxies before we commit the order's final status
    const candidatesToAssign: { id: string }[] = [];
    if (willActivate && (input.autoAssign ?? true)) {
      const c1 = await tx.proxy.findMany({
        where: { carrier: plan.carrier, region: plan.region, pool: plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: input.qty,
      });
      candidatesToAssign.push(...c1);
      if (c1.length < input.qty) {
        const c2 = await tx.proxy.findMany({
          where: { carrier: plan.carrier, region: plan.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: c1.map(c => c.id) } },
          take: input.qty - c1.length,
        });
        candidatesToAssign.push(...c2);
      }
    }
    const fullyAssigned = candidatesToAssign.length >= input.qty;
    // (comp is isInstant, and candidates are only picked under willActivate,
    // so the old separate comp clauses were redundant — same matrix.)
    const finalStatus =
      willActivate && fullyAssigned ? 'ACTIVE' as const
      : isInstant ? 'PROVISIONING' as const
      : 'NEW' as const;
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    // Custom expiry (owner decision 2026-08-21, replaces the born-ACTIVE-only
    // rule): an order born ACTIVE consumes the date immediately; otherwise the
    // date is persisted in customExpiresAt — a SEPARATE column, so expiresAt
    // stays null until activation (invariant: the sweep only expires ACTIVE
    // orders; a ticking expiresAt on a PROVISIONING row would be a zombie
    // term). Each activation path applies-and-clears it via applyCustomExpiry.
    const finalExpires =
      finalStatus === 'ACTIVE' ? (customExpires ?? new Date(now.getTime() + plan.durationDays * 86_400_000))
      : null;
    const pendingCustomExpires = finalStatus === 'ACTIVE' ? null : customExpires;
    // Exception only when auto-assign was actually attempted and came up short
    // — a comp order on a manual-provisioning plan never queries the pool, so
    // stamping it "Pool exhausted" was a false alarm (audit find).
    const finalException =
      willActivate && (input.autoAssign ?? true) && !fullyAssigned
        ? 'PAID_NOT_PROVISIONED' as const : null;
    const finalExcInfo = finalException ? `Pool exhausted — only ${candidatesToAssign.length}/${input.qty} provisioned` : null;

    await tx.order.create({
      data: {
        id: orderId,
        clientId: input.clientId,
        planId: plan.id,
        qty: input.qty,
        unitPrice,
        amount: total,
        // Recorded for every method incl. Comp (owner 2026-08-22): a recreated
        // paid order keeps its real terms on record; comp money stays $0.
        discountPct: discount,
        discountAmount: discountUsd > 0 ? discountUsd : null,
        region: plan.region,
        customExpiresAt: pendingCustomExpires,
        paymentStatus: input.paymentMethod === 'comp' ? 'FREE' : (isInstant ? 'PAID' : (input.paymentMethod === 'crypto' ? 'AWAITING' : 'PENDING')),
        status: finalStatus,
        autoRenew: input.autoRenew ?? plan.autoRenewDefault,
        autoProvision: orderAutoProvision,
        source: 'admin',
        activatedAt: finalActivated,
        expiresAt: finalExpires,
        credentialsSentAt: finalActivated,
        credentialsChannel: null,
        exception: finalException,
        excInfo: finalExcInfo,
      },
    });

    await tx.payment.create({
      data: {
        id: payId,
        orderId,
        clientId: input.clientId,
        // Admin crypto = off-site transfer confirmed by Mark paid: no processor
        // intent (no externalRef/address), so neither the legacy CoinPayments
        // label nor NOWPayments is true — and np-reconcile must not see it.
        provider: input.paymentMethod === 'crypto' ? 'Crypto' : 'Comp',
        method: input.paymentMethod === 'crypto' ? 'Manual transfer' : 'Comp',
        gross: total,
        fees,
        net,
        status: input.paymentMethod === 'comp' ? 'FREE' : (isInstant ? 'CONFIRMED' : 'AWAITING'),
        confirmedAt: isInstant ? now : null,
      },
    });

    if (isInstant || input.paymentMethod === 'comp') {
      const invId = await nextInvoiceIdInTx(tx);
      await tx.invoice.create({
        data: { id: invId, paymentId: payId, orderId, clientId: input.clientId, amount: total },
      });
    }

    // Persist the actual assignments
    if (candidatesToAssign.length > 0) {
      const ids = await newAssignmentIds(tx, candidatesToAssign.length);
      for (let i = 0; i < candidatesToAssign.length; i++) {
        await tx.assignment.create({
          data: { id: ids[i], orderId, proxyId: candidatesToAssign[i].id, actorId: actor.id, assignedAt: now },
        });
        await tx.proxy.update({ where: { id: candidatesToAssign[i].id }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
      }
    }

    await notify(tx, input.clientId,
      finalStatus === 'ACTIVE'
        ? `Order ${orderId} activated — ${input.qty} ${input.qty === 1 ? 'proxy' : 'proxies'} ready`
        : isInstant
          ? `Order ${orderId} confirmed — your proxies are being prepared`
          : `Order ${orderId} created — awaiting payment`,
      finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
      `/orders/${orderId}`,
    );
    await log(tx, actor.id, 'ORDER.CREATE', 'ORDER', orderId,
      `Admin-created · ${client.name} (${client.id}) · ${plan.name} · qty ${input.qty} · ${input.paymentMethod} · ${money(total)} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`);

    // Alert only when the order is born paid (comp/stripe). Crypto/invoice
    // orders alert later, when the payment actually confirms.
    if (isInstant) {
      adminAlert = adminNewOrderAlert({
        orderId,
        clientName: client.name ?? client.id,
        clientId: client.id,
        planName: plan.name,
        qty: input.qty,
        amount: money(total),
        method: input.paymentMethod === 'comp' ? 'Comp' : 'Card',
        status: finalStatus,
        assigned: candidatesToAssign.length,
        adminUrl: appUrl(`/admin/orders/${orderId}`),
        via: `admin · ${actor.name ?? actor.id}`,
      });
    }

    return { ok: true, orderId };
  });
  if (adminAlert) await sendAdminTelegram(adminAlert);
  return result;
}

export type RegisterProxyInput = {
  modem: string;
  imei?: string | null;
  carrier: string;
  region: string;
  pool: string;
  city?: string | null;
  ip: string;
  port: number;
  username: string;
  password: string;
  rotationUrl?: string | null;
};

// Batch registration (register-proxy page: manual rows or file import).
// All-or-nothing: any invalid item aborts the whole batch with the item
// number in the message, so a half-imported file can't happen.
export async function registerProxies({ inputs, actor }: { inputs: RegisterProxyInput[]; actor: Actor }) {
  if (inputs.length === 0) throw new Error('No proxies to register');
  if (inputs.length > 200) throw new Error('Too many proxies in one batch (max 200)');
  return prisma.$transaction(async tx => {
    // Carrier/region/pool are denormalized strings — resolve each against the
    // catalog case-insensitively so imported files can't mint values the
    // pool-first assignment matcher would never find.
    const catalogItems = await tx.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION', 'POOL'] } } });
    const lookup = (kind: string) => new Map(catalogItems.filter(c => c.kind === kind).map(c => [c.value.toLowerCase(), c.value]));
    const carriers = lookup('CARRIER'), regions = lookup('REGION'), pools = lookup('POOL');

    // Allocate the whole batch's ids up front (owner rule): first random, rest
    // sequential from it — so a registration reads PXY-48213, PXY-48214, ….
    const batchIds = await nextProxyIdBatch(tx, inputs.length);

    const seenEndpoints = new Set<string>();
    const proxyIds: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const at = `Proxy #${i + 1}`;
      if (!input.modem.trim() || !input.ip.trim() || !input.username.trim() || !input.password.trim()) {
        throw new Error(`${at}: all proxy fields required`);
      }
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error(`${at}: port out of range`);
      // Credentials render and re-import as host:port:login:password — colons
      // inside the tokens would make that string unparseable.
      if (input.username.includes(':') || input.password.includes(':')) throw new Error(`${at}: username and password must not contain ':'`);
      const rotationUrl = input.rotationUrl?.trim() || null;
      if (rotationUrl && !/^https?:\/\//i.test(rotationUrl)) throw new Error(`${at}: rotation URL must start with http:// or https://`);
      if (rotationUrl && rotationUrl.length > 512) throw new Error(`${at}: rotation URL too long (max 512 characters)`);
      const carrier = carriers.get(input.carrier.trim().toLowerCase());
      if (!carrier) throw new Error(`${at}: unknown carrier «${input.carrier.trim()}»`);
      const region = regions.get(input.region.trim().toLowerCase());
      if (!region) throw new Error(`${at}: unknown region «${input.region.trim()}»`);
      const pool = pools.get(input.pool.trim().toLowerCase());
      if (!pool) throw new Error(`${at}: unknown pool «${input.pool.trim()}»`);

      // Dedup key is ip:port:login — the same host:port legitimately serves
      // several proxies distinguished by credentials (gateway setups).
      const endpoint = `${input.ip.trim()}:${input.port}:${input.username.trim()}`;
      if (seenEndpoints.has(endpoint)) throw new Error(`${at}: duplicate ${endpoint} in this batch`);
      seenEndpoints.add(endpoint);
      const existing = await tx.proxy.findFirst({
        where: { ip: input.ip.trim(), port: input.port, username: input.username.trim() },
        select: { id: true },
      });
      if (existing) throw new Error(`${at}: ${endpoint} is already registered as ${existing.id}`);

      const id = batchIds[i];
      await tx.proxy.create({
        data: {
          id,
          modem: input.modem.trim(),
          imei: input.imei?.trim() || null,
          carrier,
          region,
          pool,
          city: input.city?.trim() || null,
          ip: input.ip.trim(),
          port: input.port,
          username: input.username.trim(),
          password: input.password.trim(),
          rotateToken: Math.random().toString(36).slice(2, 18),
          rotationUrl,
          status: 'AVAILABLE',
          health: 'HEALTHY',
        },
      });
      await log(tx, actor.id, 'PROXY.REGISTER', 'PROXY', id,
        `Registered ${id} · ${carrier} · ${region} · ${pool} · ${input.modem.trim()}`);
      proxyIds.push(id);
    }
    return { ok: true, proxyIds };
  }, { timeout: 30000 });
}

/**
 * Admin edits a registered proxy's password and/or rotation URL — the portal
 * mirror of a credential change made upstream on the modem farm. The client
 * keeps the same host:port:login; only the edited fields change, so an
 * actively-served client is bell-notified to re-copy from the portal.
 */
export async function updateProxyCredentials({ proxyId, password, rotationUrl, actor }: {
  proxyId: string; password: string; rotationUrl: string | null; actor: Actor;
}) {
  const pw = password.trim();
  const url = rotationUrl?.trim() || null;
  if (!pw) throw new Error('Password is required');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('Rotation URL must start with http:// or https://');
  if (url && url.length > 512) throw new Error('Rotation URL too long (max 512 characters)');

  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, take: 1, include: { order: { select: { clientId: true } } } } },
    });
    if (!proxy) throw new Error('Proxy not found');

    const pwChanged = proxy.password !== pw;
    const urlChanged = (proxy.rotationUrl ?? null) !== url;
    if (!pwChanged && !urlChanged) return { ok: true, changed: false };
    // Password format invariants apply only to a NEW value — an unchanged
    // legacy password must never block a rotation-URL-only edit. Same rules
    // as registerProxies: credentials render/re-import as
    // host:port:login:password, so a colon inside the token breaks the format.
    if (pwChanged) {
      if (pw.includes(':')) throw new Error("Password must not contain ':'");
      if (pw.length > 128) throw new Error('Password too long (max 128 characters)');
    }

    await tx.proxy.update({
      where: { id: proxyId },
      data: {
        password: pw,
        rotationUrl: url,
        ...(pwChanged ? { passwordRotatedAt: new Date() } : {}),
      },
    });

    const open = proxy.assignments[0];
    if (open) {
      await notify(tx, open.order.clientId,
        pwChanged
          ? `Proxy ${proxyId} credentials updated — re-copy them from the portal`
          : `Proxy ${proxyId} rotation URL updated`,
        'INFO', `/proxies/${proxyId}`);
    }

    // Values deliberately kept out of the audit trail (password), and the
    // rotation URL may embed a secret token — record only WHAT changed.
    const what = [
      pwChanged ? 'password' : null,
      urlChanged ? (url ? 'rotation URL' : 'rotation URL cleared') : null,
    ].filter(Boolean).join(' · ');
    await log(tx, actor.id, 'PROXY.EDIT', 'PROXY', proxyId,
      `Edited by ${actor.name ?? actor.id} · ${what}${open ? ` · client notified (${open.order.clientId})` : ''}`);

    return { ok: true, changed: true };
  });
}

/**
 * Hard-delete a registered proxy (owner decision 2026-08-06: block while it
 * serves an order; otherwise remove it completely). assignments.proxyId is
 * FK RESTRICT, so the proxy's RELEASED assignment history must be removed in
 * the same tx — order pages lose those history rows (accepted trade-off of a
 * hard delete; Proxy has no deletedAt column). Whitelist rows cascade.
 * Audit Log rows are kept — the PROXY.DELETE entry records what existed.
 */
export async function deleteProxy({ proxyId, reason, actor }: {
  proxyId: string; reason: string; actor: Actor;
}) {
  const why = reason.trim();
  if (!why) throw new Error('A reason is required');
  return prisma.$transaction(async tx => {
    // Row-lock the proxy first (mirrors the order lock in assignProxyManually):
    // a concurrent assignment INSERT takes FOR KEY SHARE on this row for its FK
    // check, so FOR UPDATE serializes delete-vs-assign — the loser sees the
    // committed truth instead of interleaving into silent data loss.
    await tx.$queryRaw`SELECT id FROM proxies WHERE id = ${proxyId} FOR UPDATE`;

    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, take: 1, select: { orderId: true } } },
    });
    if (!proxy) throw new Error('Proxy not found');
    const open = proxy.assignments[0];
    if (open || proxy.status === 'ASSIGNED' || proxy.status === 'PROVISIONING') {
      throw new Error(`${proxyId} is serving ${open ? `order ${open.orderId}` : 'an order'} — Release or Replace it first, then delete.`);
    }

    // Purge RELEASED history only — an open assignment that slipped past the
    // gate must survive so proxy.delete trips the FK RESTRICT and rolls the
    // whole tx back instead of silently destroying a live assignment.
    const history = await tx.assignment.deleteMany({ where: { proxyId, releasedAt: { not: null } } });
    await tx.entityNote.deleteMany({ where: { objectType: 'PROXY', objectId: proxyId } });
    try {
      await tx.proxy.delete({ where: { id: proxyId } });
    } catch (e: any) {
      if (e?.code === 'P2003') throw new Error(`${proxyId} is serving an order — Release or Replace it first, then delete.`);
      throw e;
    }

    await log(tx, actor.id, 'PROXY.DELETE', 'PROXY', proxyId,
      `Deleted by ${actor.name ?? actor.id} · ${why} · ${proxy.carrier} · ${proxy.region} · ${proxy.pool} · ${proxy.modem} · ${proxy.ip}:${proxy.port}`
      + (history.count > 0 ? ` · ${history.count} historical assignment${history.count === 1 ? '' : 's'} removed` : ''));

    return { ok: true, removedHistory: history.count };
  });
}

export async function addEntityNote({
  objectType, objectId, body, actor,
}: { objectType: 'ORDER' | 'PAYMENT' | 'PROXY' | 'CLIENT' | 'PLAN'; objectId: string; body: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    if (!body.trim()) throw new Error('Note body required');
    await tx.entityNote.create({
      data: { objectType, objectId, body: body.trim(), authorId: actor.id },
    });
    await log(tx, actor.id, `${objectType}.NOTE_ADD`, objectType, objectId, body.trim().slice(0, 200));
    return { ok: true };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   CLIENT-INITIATED ACTIONS (request flows)
   Per LIFECYCLE_CONTRACT.md:
     - Renewal      : client-initiated, direct execution
     - Replacement  : client-initiated REQUEST → admin executes
     - Refund       : client-initiated REQUEST → admin approves
     - Cancel       : admin-only EXCEPT for `new`+pending orders
   ════════════════════════════════════════════════════════════════════════ */

export async function clientCancelNewOrder({ orderId, clientId }: { orderId: string; clientId: string }) {
  return prisma.$transaction(async tx => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw new Error('Order not found');
    if (o.clientId !== clientId) throw new Error('Forbidden');
    if (o.status !== 'NEW') throw new Error('Only pending orders can be cancelled by the client. Active orders run until expiry.');
    // Money already detected on one of this order's charges — cancelling now
    // would tell the client "nothing was charged" over funds that are on-chain
    // and mid-verification. The Cancel button lives inside the pay panel, so
    // this is a real click (re-review C5). Support resolves it: settle if the
    // transfer completes, otherwise refund to balance.
    const parked = await tx.payment.findFirst({ where: { orderId, status: 'MANUAL_REVIEW' }, select: { id: true } });
    if (parked) throw new Error('We’ve detected your payment for this order and it’s being verified — contact support instead of cancelling.');
    await tx.order.update({
      where: { id: orderId },
      // paymentStatus flips too — the order snapshot and dashboard feed read
      // it, and a cancelled order must not keep looking "Awaiting".
      data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date(), cancelledReason: 'Cancelled by client before payment', customExpiresAt: null },
    });
    await tx.payment.updateMany({
      where: { orderId, status: { in: ['AWAITING', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    await log(tx, clientId, 'ORDER.CANCEL', 'ORDER', orderId, 'Cancelled by client (pending payment)');
    return { ok: true };
  });
}

export async function clientToggleAutoRenew({ orderId, clientId, on }: { orderId: string; clientId: string; on: boolean }) {
  return prisma.$transaction(async tx => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw new Error('Order not found');
    if (o.clientId !== clientId) throw new Error('Forbidden');
    if (o.status === 'CANCELLED' || o.status === 'EXPIRED') throw new Error('Cannot change auto-renew on a closed order');
    await tx.order.update({ where: { id: orderId }, data: { autoRenew: on } });
    await log(tx, clientId, 'ORDER.UPDATE', 'ORDER', orderId, `Auto-renew ${on ? 'enabled' : 'disabled'} by client`);
    return { ok: true };
  });
}

/** Client requests a refund. This DOESN'T issue the refund — it raises a flag for admin review. */
export async function clientRequestRefund({
  paymentId, clientId, reason,
}: { paymentId: string; clientId: string; reason: string }) {
  return prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!pay) throw new Error('Payment not found');
    if (pay.clientId !== clientId) throw new Error('Forbidden');
    if (pay.status !== 'CONFIRMED' && pay.status !== 'PAID') throw new Error('Only confirmed payments can be refund-requested');
    if (!reason?.trim()) throw new Error('Reason required');

    // Status-guarded flip: an admin's initiateRefund could commit
    // REFUND_IN_PROGRESS between the read above and here; an unguarded update
    // would regress it to REFUND_REQUESTED, wiping the admin's in-flight
    // refund (review 2026-08-12). Count 0 → the payment moved; bail.
    const flipped = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ['CONFIRMED', 'PAID'] } },
      data: { status: 'REFUND_REQUESTED' },
    });
    if (flipped.count === 0) throw new Error('This payment was just updated — reload to see its current state.');
    if (pay.order) {
      await tx.order.update({
        where: { id: pay.order.id },
        data: { exception: 'REFUND_PENDING', excInfo: `Client requested refund: ${reason.trim().slice(0, 100)}` },
      });
    }
    await log(tx, clientId, 'PAYMENT.REFUND_REQUEST', 'PAYMENT', paymentId,
      `Client refund request · ${reason.trim()}`);
    return { ok: true };
  });
}

/** Client requests replacement for a proxy. Doesn't swap — raises an admin queue item. */
export async function clientRequestReplacement({
  proxyId, clientId, reason,
}: { proxyId: string; clientId: string; reason: string }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: true } } },
    });
    if (!proxy) throw new Error('Proxy not found');
    const a = proxy.assignments[0];
    if (!a || a.order.clientId !== clientId) throw new Error('Forbidden');

    await tx.order.update({
      where: { id: a.orderId },
      data: { exception: 'REPLACEMENT_PENDING', excInfo: `Client requested replacement: ${reason.trim().slice(0, 100)}` },
    });
    await log(tx, clientId, 'PROXY.REPLACE_REQUEST', 'PROXY', proxyId,
      `Client replacement request for ${proxyId} on ${a.orderId} · ${reason.trim()}`);
    return { ok: true, orderId: a.orderId };
  });
}

/** Client-initiated renewal. Direct execution when balance suffices, else returns a checkout redirect target. */
export async function clientRenewOrder({ orderId, clientId }: { orderId: string; clientId: string }) {
  // Snapshot — branch decision happens outside the tx so we can return redirect data
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, client: true },
  });
  if (!o) throw new Error('Order not found');
  if (o.clientId !== clientId) throw new Error('Forbidden');
  if (o.status === 'CANCELLED' || o.status === 'PENDING_RENEWAL') throw new Error('Cannot renew this order');
  if (!o.plan.renewalAllowed) throw new Error('Renewals are not available for this plan');
  // Once an order is past grace AND its proxies have been released, a renewal
  // can no longer be contiguous — the client buys a fresh order (renewal-policy
  // PR). renewalClosed decides by the CLOCK + live-assignment count, never by
  // o.status (EXPIRED spans grace too); the &&-with-liveCount lets custom
  // contracts that keep proxies past grace (autoReleaseAfterGrace off) still
  // renew. The UI shows "Buy again" for these; this is the server backstop.
  const tierGrace = await loadTierGraceHours();
  const liveCount = await prisma.assignment.count({ where: { orderId, releasedAt: null } });
  if (renewalClosed(o.expiresAt, liveCount, o.client, tierGrace, Date.now())) {
    throw new Error('This order has fully expired — start a new order to get fresh proxies.');
  }
  // A charge on this order already carries funds under verification — taking
  // balance now would charge twice for one term. The checkout and repay paths
  // enforce the same rule (re-review C2).
  // AWAITING mirrors handleRenewal / auto-renew (review R1): a crypto renewal
  // in flight was priced (possibly with a one-cycle discount) — a one-click
  // renewal on top would double-charge AND consume the cycle a second time.
  // Scoped to STAMPED charges (renewalDiscountApplied non-null = renewal-
  // originated): an AWAITING PURCHASE charge (manual-fulfillment override)
  // is not a renewal in flight (R2). MANUAL_REVIEW stays broad — any funds
  // under verification block a second charge.
  const parkedPay = await prisma.payment.findFirst({
    where: {
      OR: [
        { orderId, status: 'MANUAL_REVIEW' },
        { orderId, status: 'AWAITING', renewalDiscountApplied: { not: null } },
        // A split-payment top-up in flight (TOPUP, orderId null, linked via
        // autoPayOrderId) will extend this order from balance when it settles —
        // block a second renewal so it isn't extended twice (split payment).
        { autoPayOrderId: orderId, status: 'AWAITING' },
      ],
    },
    select: { id: true, status: true },
  });
  if (parkedPay) {
    throw new Error(parkedPay.status === 'AWAITING'
      ? 'A renewal payment is already awaiting confirmation — complete or cancel it first.'
      : 'A payment for this order is being verified — no need to pay again.');
  }
  // No term — nothing to extend. Keyed on BOTH markers (R3): activatedAt null
  // = never delivered; expiresAt null with activatedAt set = the clock-held
  // state reprovisionRenewedOrder leaves after a short-pool renewal
  // (PROVISIONING + PAID_NOT_PROVISIONED). A renewal in either state would
  // stamp expiresAt on a PROVISIONING row (invariant break) and burn paid
  // days before delivery. EXPIRED/grace orders always carry expiresAt.
  if (!o.activatedAt || !o.expiresAt) throw new Error('This order has no active term to extend — renewal opens once its proxies are delivered.');

  // Renewals honour the discounts (audit B-6) — renewalPricing is the ONE
  // pricing source for every renewal charge and display: a per-order admin
  // grant replaces the plan and client discounts while active; otherwise the
  // larger of the client-level and plan discounts applies.
  const pricing = renewalPricing(o.plan, o, o.client);
  const price = pricing.total;
  const balance = Number(o.client.balance);

  if (balance < price) {
    // Insufficient — redirect to checkout
    return {
      ok: true,
      redirect: `/checkout?duration=${o.plan.durationDays}&qty=${o.qty}&location=${encodeURIComponent(o.region)}&renewOf=${orderId}`,
    };
  }

  // Balance covers — direct extend + new payment + invoice
  return prisma.$transaction(async tx => {
    const now = new Date();
    // Serialize ALL renewal writers on the order row (R3): the in-tx re-check
    // below is not a serialization point on its own under READ COMMITTED — an
    // uncommitted concurrent charge is invisible to it. With every renewal
    // writer taking this lock first, the second one waits and then SEES the
    // first one's committed charge.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    // Re-check in-tx (R2): a concurrent checkout-crypto renewal could have
    // inserted its AWAITING charge after the pre-tx guard above — committing
    // this balance renewal on top would double-charge and double-consume.
    const parkedNow = await tx.payment.findFirst({
      where: { OR: [{ orderId, status: 'MANUAL_REVIEW' }, { orderId, status: 'AWAITING', renewalDiscountApplied: { not: null } }, { autoPayOrderId: orderId, status: 'AWAITING' }] },
      select: { id: true },
    });
    if (parkedNow) throw new Error('A renewal payment is already awaiting confirmation — complete or cancel it first.');
    const payId = await nextPaymentIdInTx(tx);
    // $0 renewal (100% per-order grant or 100% client discount): nothing to
    // debit — debitBalance treats <= 0 as invalid and would crash the renewal
    // (adversarial review R2). The $0 CONFIRMED payment still books it.
    if (price > 0) {
      // Guarded in-tx debit (P1-1): the snapshot read above ran OUTSIDE this tx —
      // a concurrent spend could have drained the balance since.
      let newBalance: number;
      try { newBalance = await debitBalance(tx, clientId, price); }
      catch (e) {
        if (e instanceof InsufficientBalance) throw new Error('Insufficient balance — the balance changed, please retry');
        throw e;
      }
      await tx.balanceLedgerEntry.create({
        data: { userId: clientId, op: 'ORDER_DEBIT', amount: -price, balanceAfter: newBalance, refOrderId: orderId, refPaymentId: payId, note: `Renewal of ${orderId}` },
      });
    }
    await tx.payment.create({
      data: {
        id: payId, orderId, clientId,
        provider: 'Balance', method: 'Balance',
        gross: price, fees: 0, net: price,
        status: 'CONFIRMED', confirmedAt: now,
        renewalDiscountApplied: pricing.source === 'order',
      },
    });
    const invId = await nextInvoiceIdInTx(tx);
    await tx.invoice.create({ data: { id: invId, paymentId: payId, orderId, clientId, amount: price } });

    // Fresh in-tx re-read (review find): the snapshot `o` predates this tx —
    // a concurrent renewal would have moved expiresAt (stale base = swallowed
    // paid period), and a concurrent cancel must abort the charge entirely.
    const freshOrd = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, expiresAt: true, activatedAt: true, exception: true } });
    if (!freshOrd) throw new Error('Order not found');
    if (freshOrd.status === 'CANCELLED') throw new Error('Order was cancelled — renewal aborted');

    // EXPIRED order → its proxies were released to the pool at expiry, so a
    // plain term shift left the client charged, ACTIVE and holding ZERO
    // proxies, outside every fulfilment queue (audit 2C). Re-run the
    // activation contract via reprovisionRenewedOrder — this was the only
    // renewal entry point missing it (peers: settleAwaitingPayment,
    // checkout/place handleRenewal, admin extendOrder).
    const reproOrd = { id: orderId, qty: o.qty, region: o.region, activatedAt: freshOrd.activatedAt, autoProvision: o.autoProvision, plan: { carrier: o.plan.carrier, pool: o.plan.pool, durationDays: o.plan.durationDays } };
    const repro = freshOrd.status === 'EXPIRED' ? await reprovisionRenewedOrder(tx, reproOrd, clientId, now) : null;
    if (repro) {
      await tx.order.update({ where: { id: orderId }, data: repro.data });
      // Consume one discount cycle ONLY when the discount priced this charge
      // (atomic guarded decrement — see consumeRenewalDiscountCycle).
      if (pricing.source === 'order') await consumeRenewalDiscountCycle(tx, orderId);
      const newExpiry = repro.fullyAssigned ? new Date(now.getTime() + o.plan.durationDays * 86_400_000) : null;
      await log(tx, clientId, 'ORDER.EXTEND', 'ORDER', orderId,
        `Client renewal · ${money(price)} from balance · re-provisioned ${repro.assignedCount}/${o.qty}${repro.fullyAssigned ? '' : ' · PAID_NOT_PROVISIONED'}`);
      await notify(tx, clientId,
        repro.fullyAssigned
          ? `Order ${orderId} renewed — ${o.qty} fresh ${o.qty === 1 ? 'proxy' : 'proxies'} assigned`
          : `Order ${orderId} renewed — proxies are being provisioned`,
        'SUCCESS', `/orders/${orderId}`);
      return { ok: true, redirect: null, newExpiry: newExpiry ? newExpiry.toISOString() : null };
    }

    // Anchor on the ORIGINAL expiry (renewal-policy PR): renewing in grace
    // extends contiguously from the due date, never `now`. The renewal-closed
    // case is refused before this tx (see the renewalClosed guard above);
    // renewalBase additionally floors to `now` if a full term from expiry would
    // land wholly in the past (grace > duration on a still-bound order), so the
    // client is never charged for a dead-on-arrival term.
    const base = renewalBase(freshOrd.expiresAt, o.plan.durationDays, now);
    const newExpiry = new Date(base.getTime() + o.plan.durationDays * 86_400_000);
    await tx.order.update({
      where: { id: orderId },
      data: {
        expiresAt: newExpiry,
        status: freshOrd.status === 'EXPIRED' ? 'ACTIVE' : freshOrd.status,
        activatedAt: freshOrd.activatedAt ?? now,
        renewalBucket: 'RENEWED',
        lastReminderAt: null,
        exception: freshOrd.exception === 'RENEWAL_NOT_EXTENDED' ? null : freshOrd.exception,
      },
    });
    if (pricing.source === 'order') await consumeRenewalDiscountCycle(tx, orderId);
    await log(tx, clientId, 'ORDER.EXTEND', 'ORDER', orderId,
      `Client renewal · ${money(price)} from balance · new expiry ${fmtDate(newExpiry)}`);
    await notify(tx, clientId, `Order ${orderId} renewed — new expiry ${fmtDate(newExpiry)}`, 'SUCCESS', `/orders/${orderId}`);
    return { ok: true, redirect: null, newExpiry: newExpiry.toISOString() };
  });
}

// Split payment (owner decision 2026-08-27, approach B): the crypto top-up that
// covered an order's shortfall has just settled and credited the balance — now
// pay the still-NEW purchase from that balance. Mirrors the crypto-settle
// new-order branch (provision pool-first, guarded activation, custom expiry)
// but with a guarded balance debit + a CONFIRMED balance ORDER payment.
// Outcomes:
//   · 'activated'   — order is ACTIVE (auto-provision plan, pool had proxies)
//   · 'provisioning'— order is PROVISIONING (manual plan or pool short)
//   · 'not_new'     — order was cancelled/activated meanwhile → caller only
//                     credited the balance, nothing else to do
//   · 'insufficient'— balance no longer covers the order (client drained it
//                     between checkout and settle) → caller leaves it NEW and
//                     tells the client to complete it from balance
export type AutoPayResult =
  | { outcome: 'activated' | 'provisioning'; assignedCount: number }
  | { outcome: 'not_new' }
  | { outcome: 'insufficient' };

export async function activateNewOrderFromBalance({ orderId, clientId }: { orderId: string; clientId: string }): Promise<AutoPayResult> {
  try {
    return await prisma.$transaction(async tx => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { plan: true } });
      if (!order) throw new Error(`Order ${orderId} not found for auto-pay`);
      // Serialize with any concurrent writer on this order; only a still-NEW
      // order is payable here (a since-cancelled or already-activated one is
      // left untouched — the top-up simply stays as balance).
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const fresh = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (fresh?.status !== 'NEW') return { outcome: 'not_new' as const };

      const now = new Date();
      const total = Number(order.amount);
      const payId = await nextPaymentIdInTx(tx);

      // Guarded balance debit FIRST — if the just-credited balance no longer
      // covers the order the whole activation rolls back (InsufficientBalance),
      // and the caller notifies the client to complete it from balance.
      const newBal = await debitBalance(tx, clientId, total);
      await tx.payment.create({
        data: { id: payId, orderId, clientId, provider: 'Balance', method: 'Balance', gross: total, fees: 0, net: total, status: 'CONFIRMED', confirmedAt: now },
      });
      await tx.balanceLedgerEntry.create({
        data: { userId: clientId, op: 'ORDER_DEBIT', amount: -total, balanceAfter: newBal, refOrderId: orderId, refPaymentId: payId, note: `Order ${orderId} (balance + top-up)` },
      });
      const invId = await nextInvoiceIdInTx(tx);
      await tx.invoice.create({ data: { id: invId, paymentId: payId, orderId, clientId, amount: total } });

      // Provision pool-first (mirrors settle-payment / checkout/place).
      let assignedCount = 0;
      if (order.autoProvision) {
        const candidates = await tx.proxy.findMany({
          where: { carrier: order.plan.carrier, region: order.region, pool: order.plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
          take: order.qty,
        });
        if (candidates.length < order.qty) {
          const more = await tx.proxy.findMany({
            where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
            take: order.qty - candidates.length,
          });
          candidates.push(...more);
        }
        for (const px of candidates.slice(0, order.qty)) {
          const aid = await nextAssignmentId();
          await tx.assignment.create({ data: { id: aid, orderId, proxyId: px.id, actorId: 'ADM-SYS', assignedAt: now } });
          await tx.proxy.update({ where: { id: px.id }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
          assignedCount++;
        }
      }
      const fullyAssigned = order.autoProvision && assignedCount >= order.qty;
      const finalStatus = fullyAssigned ? ('ACTIVE' as const) : ('PROVISIONING' as const);
      const custom = applyCustomExpiry(order.customExpiresAt, order.plan.durationDays, now);
      const finalException = order.autoProvision && !fullyAssigned ? ('PAID_NOT_PROVISIONED' as const) : null;

      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          status: finalStatus,
          activatedAt: finalStatus === 'ACTIVE' ? now : null,
          expiresAt: finalStatus === 'ACTIVE' ? custom.expiresAt : null,
          ...(finalStatus === 'ACTIVE' ? { customExpiresAt: null } : {}),
          credentialsSentAt: finalStatus === 'ACTIVE' ? now : null,
          credentialsChannel: null,
          exception: finalException,
          excInfo: finalException ? `Pool exhausted — ${assignedCount}/${order.qty} provisioned` : null,
        },
      });
      await log(tx, clientId, 'PAYMENT.CONFIRM', 'PAYMENT', payId,
        `Order ${orderId} paid from balance after crypto top-up · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`);
      await notify(tx, clientId,
        finalStatus === 'ACTIVE'
          ? `Order ${orderId} activated — ${order.qty} ${order.qty === 1 ? 'proxy' : 'proxies'} ready`
          : `Order ${orderId} paid — provisioning in progress`,
        finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO', `/orders/${orderId}`);
      return { outcome: finalStatus === 'ACTIVE' ? ('activated' as const) : ('provisioning' as const), assignedCount };
    });
  } catch (e) {
    if (e instanceof InsufficientBalance) return { outcome: 'insufficient' };
    throw e;
  }
}

// Per-order renewal discount (owner decision 2026-08-21): admin grants a
// discount on this order's future PAID renewals — % of unit price or flat $
// off the total — for one cycle, N cycles, or indefinitely. While active it
// REPLACES the plan's renewalDiscountPct (renewalPricing). `null` input clears.
export type OrderRenewalDiscountInput = {
  value: number;
  isPercent: boolean;
  cycles: number | null; // null = indefinite; N >= 1 = remaining paid renewals
} | null;

export async function setOrderRenewalDiscount({
  orderId, input, actor,
}: { orderId: string; input: OrderRenewalDiscountInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({ where: { id: orderId }, include: { plan: true } });
    if (!ord) throw new Error('Order not found');
    if (ord.status === 'CANCELLED') throw new Error('Cannot set a renewal discount on a cancelled order');
    if (input) {
      if (!Number.isFinite(input.value) || input.value <= 0) throw new Error('Discount value must be > 0');
      if (input.isPercent) {
        if (!Number.isInteger(input.value) || input.value > 100) throw new Error('Percent discount must be an integer 1..100');
      } else {
        // roundCents equality, not float re-scaling (same R1 fix as bounds).
        if (Math.round(input.value * 100) / 100 !== input.value) throw new Error('Discount amount must be whole cents');
        const fullTotal = Math.round(Number(ord.plan.price) * ord.qty * 100) / 100;
        if (input.value > fullTotal) throw new Error(`Discount amount cannot exceed the renewal total (${money(fullTotal)})`);
      }
      if (input.cycles !== null && (!Number.isInteger(input.cycles) || input.cycles < 1 || input.cycles > 120)) {
        throw new Error('Cycles must be an integer 1..120, or indefinite');
      }
    }
    await tx.order.update({
      where: { id: orderId },
      data: input
        ? { renewalDiscountValue: input.value, renewalDiscountIsPercent: input.isPercent, renewalDiscountCyclesLeft: input.cycles }
        : { renewalDiscountValue: null, renewalDiscountIsPercent: null, renewalDiscountCyclesLeft: null },
    });
    await log(tx, actor.id, 'ORDER.UPDATE', 'ORDER', orderId,
      input
        ? `Renewal discount set · ${input.isPercent ? `${input.value}%` : money(input.value)} · ${input.cycles === null ? 'indefinite' : `${input.cycles} cycle${input.cycles === 1 ? '' : 's'}`}${orderRenewalDiscountActive(ord) ? ' (replaced previous)' : ''}`
        : 'Renewal discount cleared');
    return { ok: true };
  });
}

// Client-level discount (owner decision 2026-08-22): a special price for this
// client — integer percent off ALL their orders, new purchases and renewals.
// Never stacks with a plan renewal discount (the LARGER wins — renewalPricing);
// an active per-order grant beats both. `null` clears. Indefinite by design.
// Capped at 99 (owner decision 2026-08-26): a 100% client discount meant free
// EVERYTHING forever — $0 renewals on every order while new purchases bounced
// off the only-Comp-may-be-$0 guard. A truly free client is what per-order
// Comp / 100% renewal grants are for; the $0-renewal handling stays in place
// for those grants (and for any legacy 100% row — the cap is write-side only).
export async function setClientDiscount({
  userId, pct, actor,
}: { userId: string; pct: number | null; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before || before.role !== 'CLIENT') throw new Error('Client not found');
    if (pct !== null && (!Number.isInteger(pct) || pct < 1 || pct > 99)) {
      throw new Error('Percent discount must be an integer 1..99');
    }
    await tx.user.update({ where: { id: userId }, data: { clientDiscountPct: pct } });
    const was = before.clientDiscountPct != null ? ` (was −${before.clientDiscountPct}%)` : '';
    await log(tx, actor.id, 'CLIENT.UPDATE', 'CLIENT', userId,
      pct !== null ? `Client discount set · −${pct}% on all orders${was}` : `Client discount cleared${was}`);
    return { ok: true };
  });
}

export async function setClientRisk({
  userId, risk, note, actor,
}: { userId: string; risk: 'NONE' | 'REVIEW' | 'FLAG'; note?: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before) throw new Error('Client not found');
    if (risk !== 'NONE' && !note?.trim()) throw new Error('Note required when raising risk');
    await tx.user.update({ where: { id: userId }, data: { risk, riskNote: note?.trim() || null } });
    await log(tx, actor.id, 'CLIENT.RISK_UPDATE', 'CLIENT', userId,
      `Risk ${before.risk} → ${risk}${note ? ' · ' + note.trim() : ''}`);
    return { ok: true };
  });
}
