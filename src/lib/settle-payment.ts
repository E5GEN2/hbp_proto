// Single place where an AWAITING crypto payment turns into value: balance
// top-up, new-order activation, or renewal extension. Called from the
// NOWPayments IPN webhook (real money) and from the legacy mock confirm
// endpoint (dev only) — both paths settle identically and idempotently.

import { prisma } from './prisma';
import { nextInvoiceId, nextAssignmentId } from './id';
import { fmtDate } from './date';
import { money } from './money';
import { creditBalance } from './balance';
import { reprovisionRenewedOrder } from './transitions';
import { sendEmail, orderPaidEmail, orderRenewedEmail, depositConfirmedEmail } from './email';
import { sendAdminTelegram, adminNewOrderAlert, adminCryptoAttentionAlert } from './telegram';
import { appUrl } from './app-url';
import { isResurrectable, RESURRECTABLE_STATUSES } from './crypto-window';
import { renewalBase, renewalDiscountDecrement } from './renewal';
import { applyCustomExpiry } from './new-order-policy';

export type SettleResult =
  | { ok: true; already: true }
  | { ok: true; kind: 'deposit' | 'order' | 'renewal' | 'review' };

function notifId() {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Thrown inside a settle transaction when the status-guarded CONFIRMED flip
// matches no row — another writer (a racing settle, or admin MarkPaid) won the
// race and already moved the payment out of a settleable state. Rolls the tx
// back so we never credit/assign twice; the caller turns it into {already}.
class AlreadySettled extends Error {}

export async function settleAwaitingPayment(paymentId: string, via: string, opts?: { resurrectFailed?: boolean }): Promise<SettleResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { client: true } });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  // Idempotency: IPN retries and double-clicks must not re-credit. A locally
  // FAILED charge (fixed-rate window expired before the transfer confirmed)
  // still settles when the caller says so — the money is real; the status
  // flips FAILED→CONFIRMED directly, never touching AWAITING (which the
  // payments_one_awaiting_per_order index may already have re-allocated).
  // MANUAL_REVIEW resurrects the same way: it means "funds detected on a dead
  // charge, human queued" — when NP then reports the charge fully `finished`,
  // auto-settling IS the resolution; swallowing it left the row parked forever
  // and the client unpaid (audit 2026-08-11).
  // CANCELLED resurrects too. The sweep no longer produces cancelled charges,
  // but clientCancelNewOrder / admin cancelOrder still do — and NP has no
  // cancel API, so that address stays payable for ~7 days. A client who hits
  // "Cancel order" seconds after sending (the button lives inside the pay
  // panel) would otherwise have a fully-paid `finished` charge dropped with no
  // log, no alert and no reconciler net. Resurrecting reaches the cancelled-
  // order guard below, which parks it for a human instead of auto-activating
  // an order nobody wants (re-review C1/C2/C3).
  const resurrect = opts?.resurrectFailed === true && isResurrectable(payment.status);
  if (payment.status !== 'AWAITING' && !resurrect) return { ok: true, already: true };

  const now = new Date();
  const clientId = payment.clientId;
  const clientEmail = payment.client.email;

  // Status-guarded CONFIRMED flip — the first write of every settle tx. Since
  // MANUAL_REVIEW is now BOTH an auto-settle target (resurrect) and the admin
  // MarkPaid queue, two writers can race; keying the flip on the settleable
  // statuses makes the loser's updateMany match 0 rows → AlreadySettled →
  // rollback, so money is credited exactly once (audit C5).
  const guardedConfirm = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const r = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ['AWAITING', ...RESURRECTABLE_STATUSES] } },
      data: { status: 'CONFIRMED', confirmedAt: now },
    });
    if (r.count === 0) throw new AlreadySettled();
  };

  // ── Balance top-up (payment carries no order) ─────────────────────────────
  if (!payment.orderId) {
    const amount = Number(payment.gross);
    let newBal = 0;
    try {
      await prisma.$transaction(async tx => {
        await guardedConfirm(tx);
        const me = await tx.user.findUnique({ where: { id: clientId }, select: { id: true } });
        if (!me) throw new Error(`User ${clientId} not found for deposit ${payment.id}`);
        newBal = await creditBalance(tx, clientId, amount); // atomic (P1-1)
        await tx.balanceLedgerEntry.create({
          data: { userId: clientId, op: 'TOPUP', amount, balanceAfter: newBal, refPaymentId: payment.id, note: `Deposit crypto (${via})` },
        });
        const invoiceId = await nextInvoiceId();
        await tx.invoice.create({ data: { id: invoiceId, paymentId: payment.id, orderId: null, clientId, amount } });
        await tx.notification.create({
          data: { id: notifId(), userId: clientId, title: `Deposit of ${money(amount)} added to your balance · new bal ${money(newBal)}`, kind: 'SUCCESS', link: '/billing' },
        });
        await tx.log.create({
          data: { actorId: clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id, detail: `Crypto deposit confirmed via ${via} · ${money(amount)}` },
        });
      });
    } catch (e) {
      if (e instanceof AlreadySettled) return { ok: true, already: true };
      throw e;
    }
    await sendEmail({ to: clientEmail, ...depositConfirmedEmail(money(amount), money(newBal)) });
    return { ok: true, kind: 'deposit' };
  }

  const order = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { plan: true } });
  if (!order) throw new Error(`Order ${payment.orderId} not found for payment ${payment.id}`);

  // ── Cancelled order: money arrived on a dead order — never auto-extend or
  //    auto-activate it (proxies were released; the client may not want it).
  //    Park the payment in MANUAL_REVIEW + alert an admin to refund or
  //    reactivate. Newly reachable now that abandoned order charges end as
  //    FAILED (resurrectable) on a CANCELLED order (audit C2/C10/C14).
  if (order.status === 'CANCELLED') {
    // One transaction: re-read the order INSIDE it (the status above predates
    // this write — a concurrent repay/settle could have revived it) and park
    // only from the live-or-dead states. MANUAL_REVIEW is deliberately NOT in
    // the guard set, so an IPN resend on an already-parked row matches 0 rows
    // and stays silent instead of re-logging and re-alerting (re-review
    // C5/C6/C10/C14).
    let parked = false;
    await prisma.$transaction(async tx => {
      const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
      if (fresh?.status !== 'CANCELLED') return; // revived meanwhile — fall through on a later call
      const r = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['AWAITING', 'FAILED', 'CANCELLED'] } },
        data: { status: 'MANUAL_REVIEW' },
      });
      if (r.count === 0) return;
      parked = true;
      await tx.log.create({
        data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: payment.id, detail: `Funds settled on CANCELLED order ${order.id} via ${via} — parked for manual review (refund or reactivate)` },
      });
      // The client last saw "cancelled — nothing was charged". Say the true
      // thing now, or they think their money vanished.
      await tx.notification.create({
        data: {
          id: notifId(), userId: clientId,
          title: `We received your payment for ${order.id} — it's being verified`,
          kind: 'INFO', link: `/orders/${order.id}`,
        },
      });
    });
    if (parked) {
      try {
        await sendAdminTelegram(adminCryptoAttentionAlert({
          paymentId: payment.id,
          reason: `funds on a cancelled order (${via})`,
          clientName: payment.client.name ?? payment.client.id,
          clientId,
          received: money(Number(payment.gross)),
          expected: money(Number(payment.gross)),
          orderRef: order.id,
          adminUrl: appUrl(`/admin/payments/${payment.id}`),
        }));
      } catch { /* best-effort alert */ }
      return { ok: true, kind: 'review' };
    }
    return { ok: true, already: true };
  }

  // ── Renewal: the order itself is already settled and the charge extends it.
  //    Discriminate by order.status, NOT paymentStatus: a NEW order whose
  //    charge expired carries paymentStatus=FAILED, and a resurrected late
  //    settlement must still take the initial-purchase path below (activate,
  //    not extend). Any non-NEW order = renewal charge: EXTENDS the original
  //    order when its proxies are still bound (B-2); an EXPIRED order has had
  //    them auto-released to the pool, so it re-provisions like a new order
  //    (fresh term from now; short pool → PAID_NOT_PROVISIONED, clock held). ──
  if (order.status !== 'NEW') {
    let newExpiry: Date | null = null; // assigned in-tx from the FRESH expiry base
    let reproShort = false;
    try {
    await prisma.$transaction(async tx => {
      await guardedConfirm(tx);
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: payment.id, orderId: order.id, clientId: order.clientId, amount: Number(payment.gross) },
      });

      // Fresh in-tx re-read (review find): `order` predates this tx — extend
      // from the CURRENT expiry or a concurrent renewal's period gets eaten.
      const freshOrd = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, expiresAt: true, exception: true } });
      if (!freshOrd) throw new Error(`Order ${order.id} vanished during settle`);
      // Cancelled between the pre-tx read and here → roll back rather than
      // "extend" a dead order and email the client that it was renewed. The
      // next IPN / reconcile tick re-enters and lands in the cancelled-order
      // park above, which is the branch written for this money (re-review
      // C6/C8 — mirrors the NEW-order branch's status-guarded write).
      if (freshOrd.status === 'CANCELLED') throw new AlreadySettled();
      const repro = freshOrd.status === 'EXPIRED' ? await reprovisionRenewedOrder(tx, order, 'ADM-SYS', now) : null;
      if (repro) {
        reproShort = !repro.fullyAssigned;
        newExpiry = repro.fullyAssigned ? new Date(now.getTime() + order.plan.durationDays * 86_400_000) : null;
        // Paid renewal → consume one per-order discount cycle (no-op when
        // indefinite/absent/exhausted). The crypto charge was priced with the
        // discount at creation; only one renewal can be in flight (AWAITING
        // guard), so creation-time price and this decrement can't diverge.
        await tx.order.update({ where: { id: order.id }, data: { ...repro.data, ...renewalDiscountDecrement(order) } });
        await tx.log.create({
          data: {
            actorId: order.clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id,
            detail: `Crypto renewal confirmed via ${via} for ${order.id} — re-provisioned ${repro.assignedCount}/${order.qty}${repro.fullyAssigned ? '' : ' · PAID_NOT_PROVISIONED'}`,
          },
        });
        await tx.notification.create({
          data: {
            id: notifId(), userId: order.clientId,
            title: repro.fullyAssigned
              ? `Order ${order.id} renewed — ${order.qty} fresh ${order.qty === 1 ? 'proxy' : 'proxies'} assigned`
              : `Order ${order.id} renewed — proxies are being provisioned`,
            kind: 'SUCCESS', link: `/orders/${order.id}`,
          },
        });
        return;
      }

      // Anchor the new term on the ORIGINAL expiry, not now: a renewal always
      // extends from when the order was due to end, regardless of when the
      // money landed (renewal-policy PR). renewalBase floors to `now` only if a
      // full term from that anchor would be entirely in the past (grace >
      // duration, or a very late settle on a still-bound order under
      // autoReleaseAfterGrace=off), so this never writes a past-dated expiry.
      const base = renewalBase(freshOrd.expiresAt, order.plan.durationDays, now);
      newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);
      await tx.order.update({
        where: { id: order.id },
        data: {
          expiresAt: newExpiry,
          status: freshOrd.status === 'EXPIRED' ? 'ACTIVE' : freshOrd.status,
          renewalBucket: 'RENEWED',
          lastReminderAt: null,
          exception: freshOrd.exception === 'RENEWAL_NOT_EXTENDED' ? null : freshOrd.exception,
          ...renewalDiscountDecrement(order),
        },
      });
      await tx.log.create({
        data: {
          actorId: order.clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id,
          detail: `Crypto renewal payment confirmed via ${via} for ${order.id} — extended to ${newExpiry!.toISOString().slice(0, 10)}`,
        },
      });
      await tx.notification.create({
        data: {
          id: notifId(), userId: order.clientId,
          title: `Order ${order.id} renewed — new expiry ${fmtDate(newExpiry!)}`,
          kind: 'SUCCESS', link: `/orders/${order.id}`,
        },
      });
    });
    } catch (e) {
      if (e instanceof AlreadySettled) return { ok: true, already: true };
      throw e;
    }
    await sendEmail({ to: clientEmail, ...orderRenewedEmail(order.id, newExpiry ? fmtDate(newExpiry) : (reproShort ? 'starts when your proxies are assigned' : fmtDate(now))) });
    return { ok: true, kind: 'renewal' };
  }

  // ── New order: mark paid, then provision (assign proxies if the plan wants
  //    auto-provisioning and the pool has capacity). ─────────────────────────
  // Purchase-time snapshot, not the plan's current flag (report №3).
  const wantsAutoProvision = order.autoProvision;
  let finalActive = false;
  let finalAssigned = 0;

  try {
  await prisma.$transaction(async tx => {
    await guardedConfirm(tx);
    {
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: payment.id, orderId: order.id, clientId: order.clientId, amount: Number(order.amount) },
      });
    }

    let assignedCount = 0;
    if (wantsAutoProvision) {
      // Pool-first, then widen to any pool of the same carrier+region — the
      // crypto path used to skip straight to the wide query, diluting the
      // plan's own pool (P2 #3). Mirrors markPaymentPaid / checkout/place.
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
      for (const p of candidates) {
        const aid = await nextAssignmentId();
        await tx.assignment.create({ data: { id: aid, orderId: order.id, proxyId: p.id, actorId: 'ADM-SYS', assignedAt: now } });
        await tx.proxy.update({ where: { id: p.id }, data: { status: 'ASSIGNED', currentOrderId: order.id } });
        assignedCount++;
      }
    }

    const fullyAssigned = assignedCount >= order.qty;
    const finalStatus =
      wantsAutoProvision && fullyAssigned ? 'ACTIVE' as const
      : 'PROVISIONING' as const;
    finalActive = finalStatus === 'ACTIVE';
    finalAssigned = assignedCount;
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    // Consume a persisted admin custom expiry on activation (stale → full plan
    // term; money just landed, never park or kill a paid order).
    const custom = applyCustomExpiry(order.customExpiresAt, order.plan.durationDays, now);
    const finalExpires = finalStatus === 'ACTIVE' ? custom.expiresAt : null;
    const finalException = wantsAutoProvision && !fullyAssigned ? 'PAID_NOT_PROVISIONED' as const : null;

    // Status-guarded like every other writer here: sweep 3b (or a client
    // cancel) can flip this order out of NEW while we're mid-transaction, and
    // an unguarded update would resurrect a cancelled order into ACTIVE with
    // proxies attached. Count 0 → roll the whole settle back; the next IPN /
    // reconcile tick re-runs it and lands in the cancelled-order park above,
    // which is the correct home for money on a dead order (re-review C8).
    const ordUpd = await tx.order.updateMany({
      where: { id: order.id, status: 'NEW' },
      data: {
        paymentStatus: 'PAID',
        status: finalStatus,
        activatedAt: finalActivated,
        expiresAt: finalExpires,
        ...(finalStatus === 'ACTIVE' ? { customExpiresAt: null } : {}),
        credentialsSentAt: finalActivated,
        credentialsChannel: null,
        exception: finalException,
        excInfo: finalException ? `Pool exhausted — ${assignedCount}/${order.qty} provisioned` : null,
      },
    });
    if (ordUpd.count === 0) throw new AlreadySettled();
    if (finalStatus === 'ACTIVE' && custom.stale) {
      await tx.log.create({
        data: { actorId: 'ADM-SYS', action: 'ORDER.UPDATE', objectType: 'ORDER', objectId: order.id, detail: 'Custom expiry passed before activation — full plan term applied' },
      });
    }

    await tx.log.create({
      data: {
        actorId: order.clientId,
        action: 'PAYMENT.CONFIRM',
        objectType: 'PAYMENT',
        objectId: payment.id,
        detail: `Crypto payment confirmed via ${via} for ${order.id} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`,
      },
    });

    await tx.notification.create({
      data: {
        id: notifId(), userId: order.clientId,
        title: finalStatus === 'ACTIVE'
          ? `Order ${order.id} activated — ${order.qty} ${order.qty === 1 ? 'proxy' : 'proxies'} ready`
          : `Order ${order.id} paid — provisioning in progress`,
        kind: finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
        link: `/orders/${order.id}`,
      },
    });
  });
  } catch (e) {
    if (e instanceof AlreadySettled) return { ok: true, already: true };
    throw e;
  }

  await sendEmail({ to: clientEmail, ...orderPaidEmail(order.id, finalActive) });
  await sendAdminTelegram(adminNewOrderAlert({
    orderId: order.id,
    clientName: payment.client.name ?? payment.client.id,
    clientId: order.clientId,
    planName: order.plan.name,
    qty: order.qty,
    amount: money(Number(order.amount)),
    method: payment.method,
    status: finalActive ? 'ACTIVE' : 'PROVISIONING',
    assigned: finalAssigned,
    adminUrl: appUrl(`/admin/orders/${order.id}`),
    via,
  }));
  return { ok: true, kind: 'order' };
}

// IPN told us the charge died (expired / failed / refunded before credit).
// Only an AWAITING payment flips — a settled one is left alone.
export async function failAwaitingPayment(paymentId: string, reason: string): Promise<{ ok: true; changed: boolean }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'AWAITING') return { ok: true, changed: false };

  let flipped = false;
  await prisma.$transaction(async tx => {
    // Guard the flip on status INSIDE the tx (optimistic concurrency): a late
    // `finished` IPN can drive settleAwaitingPayment to credit the balance and
    // flip AWAITING→CONFIRMED between the read above and this write. An update
    // keyed on id alone would clobber that CONFIRMED row back to FAILED —
    // mislabelling money that IS in the balance, firing a false "didn't
    // complete" bell, and (the charge being resurrectable) leaving the client's
    // `finished` IPN resends stuck in a duplicate-invoice 500 loop. updateMany
    // with the status predicate makes the flip a no-op when settle won the race
    // (or another sweep already moved it out of AWAITING).
    const res = await tx.payment.updateMany({ where: { id: payment.id, status: 'AWAITING' }, data: { status: 'FAILED' } });
    if (res.count === 0) return; // settled / already terminal concurrently — leave it, no bell/log
    flipped = true;
    if (payment.orderId) {
      const order = await tx.order.findUnique({ where: { id: payment.orderId } });
      // Only a brand-new unpaid order flips to FAILED; a settled order with a
      // dead renewal charge keeps its own paymentStatus.
      if (order && order.paymentStatus === 'AWAITING') {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } });
      }
      // The client got NO signal before — the order just sat there failed.
      await tx.notification.create({
        data: {
          id: notifId(), userId: payment.clientId,
          title: `Payment for order ${payment.orderId} didn't complete — you can retry from the order page`,
          kind: 'WARNING', link: `/orders/${payment.orderId}`,
        },
      });
    } else {
      await tx.notification.create({
        data: {
          id: notifId(), userId: payment.clientId,
          title: `Deposit ${payment.id} didn't complete — your balance was not credited`,
          kind: 'WARNING', link: '/billing',
        },
      });
    }
    await tx.log.create({
      data: {
        actorId: payment.clientId, action: 'PAYMENT.FAIL', objectType: 'PAYMENT', objectId: payment.id,
        detail: `Crypto payment ${reason}`,
      },
    });
  });
  return { ok: true, changed: flipped };
}
