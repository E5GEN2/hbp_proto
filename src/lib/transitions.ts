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
import { nextInvoiceId, nextOrderId, nextPaymentId, nextUserId, nextProxyId, nextAssignmentId } from './id';
import { renewalUnitPrice } from './renewal';
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
  return prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { plan: true } }, client: true },
    });
    if (!pay) throw new Error('Payment not found');
    if (!['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'].includes(pay.status)) {
      throw new Error(`Cannot mark paid from status ${pay.status}`);
    }

    const now = new Date();

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'CONFIRMED', confirmedAt: now, source, externalRef },
    });

    if (pay.order) {
      const ord = pay.order;
      const plan = ord.plan;
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
      const expiresAt = willActivate && fullyAssigned ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;
      await tx.order.update({
        where: { id: ord.id },
        data: {
          paymentStatus: 'PAID',
          status: willActivate && fullyAssigned ? 'ACTIVE' : 'PROVISIONING',
          activatedAt: willActivate && fullyAssigned ? now : null,
          expiresAt,
          credentialsSentAt: willActivate && fullyAssigned ? now : null,
          credentialsChannel: null,
          exception: willActivate && !fullyAssigned ? 'PAID_NOT_PROVISIONED' : null,
          excInfo: willActivate && !fullyAssigned ? `Pool capacity hit — only ${assignedCount}/${ord.qty} provisioned` : null,
        },
      });

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
    }

    await log(tx, actor.id, 'PAYMENT.CONFIRM', 'PAYMENT', paymentId,
      `Payment confirmed by ${actor.name ?? actor.id}${source ? ` · source=${source}` : ''}${externalRef ? ` · ref=${externalRef}` : ''}`);

    return { ok: true };
  });
}

/**
 * Admin refunds a confirmed payment.
 * Credits client balance, tags order with refund-pending exception.
 */
export async function refundPayment({
  paymentId, actor, amount, reason,
}: { paymentId: string; actor: Actor; amount?: number; reason: string }) {
  return prisma.$transaction(async tx => {
    const pay = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: true, client: true },
    });
    if (!pay) throw new Error('Payment not found');
    // CONFIRMED/PAID = admin-initiated refund; REFUND_REQUESTED = executing a
    // client's refund request (the flag clientRequestRefund raised).
    if (!['CONFIRMED', 'PAID', 'REFUND_REQUESTED'].includes(pay.status)) {
      throw new Error(`Cannot refund from status ${pay.status}`);
    }

    const refundAmount = amount ?? Number(pay.gross);
    const now = new Date();

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'REFUNDED', refundedAmount: refundAmount, refundedAt: now },
    });

    // Credit balance ledger
    const newBalance = Number(pay.client.balance) + refundAmount;
    await tx.user.update({ where: { id: pay.clientId }, data: { balance: newBalance } });
    await tx.balanceLedgerEntry.create({
      data: {
        userId: pay.clientId,
        op: 'REFUND_CREDIT',
        amount: refundAmount,
        balanceAfter: newBalance,
        refPaymentId: paymentId,
        refOrderId: pay.orderId ?? null,
        note: reason,
      },
    });

    // Tag order with refund-pending (don't auto-cancel)
    if (pay.order && !pay.order.exception) {
      await tx.order.update({
        where: { id: pay.order.id },
        data: { exception: 'REFUND_PENDING', excInfo: `Refund of $${refundAmount} issued — ${reason}` },
      });
    }

    await notify(tx, pay.clientId,
      `Refund of $${refundAmount} credited to your balance · ${reason}`,
      'SUCCESS',
      pay.orderId ? `/orders/${pay.orderId}` : '/billing',
    );

    await log(tx, actor.id, 'PAYMENT.REFUND', 'PAYMENT', paymentId,
      `Refund $${refundAmount} · ${reason} · actor=${actor.name ?? actor.id}`);

    return { ok: true, newBalance };
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
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { status: 'AVAILABLE', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
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
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({ where: { id: orderId } });
    if (!ord) throw new Error('Order not found');
    if (ord.status !== 'ACTIVE' && ord.status !== 'PROVISIONING') throw new Error(`Cannot suspend from status ${ord.status}`);

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'SUSPENDED',
        autoRenewBeforeSuspend: ord.autoRenew,
        autoRenew: false,
        credentialsBeforeSuspend: ord.credentialsChannel,
      },
    });
    // Proxies stay reserved (per the prototype contract)
    await tx.assignment.updateMany({
      where: { orderId, releasedAt: null },
      data: { suspendedAt: new Date() },
    });

    await notify(tx, ord.clientId, `Order ${orderId} suspended by operator · ${reason}`, 'WARNING', `/orders/${orderId}`);
    // Client creds are hidden on suspend, but the proxy stays bound and the
    // client may have copied them — record the standing manual-rotation duty
    // (no upstream auto-rotation). Surfaced on the admin order page + modal.
    await log(tx, actor.id, 'ORDER.SUSPEND', 'ORDER', orderId, `Suspended · ${reason} · creds hidden from client — ROTATE proxy password + IP-rotation link on the upstream manually`);
    return { ok: true };
  });
}

export async function resumeOrder({ orderId, actor }: { orderId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { releasedAt: null } } },
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
      },
    });
    await tx.assignment.updateMany({
      where: { orderId, releasedAt: null },
      data: { suspendedAt: null },
    });

    await notify(tx, ord.clientId, `Order ${orderId} resumed`, 'SUCCESS', `/orders/${orderId}`);
    await log(tx, actor.id, 'ORDER.RESUME', 'ORDER', orderId, intact ? 'Resumed to ACTIVE' : 'Resumed to PROVISIONING (manual recovery needed)');
    return { ok: true };
  });
}

export async function extendOrder({
  orderId, actor, additionalDays, paymentMethod,
}: { orderId: string; actor: Actor; additionalDays?: number; paymentMethod?: 'comp' | 'balance' | 'invoice' }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({ where: { id: orderId }, include: { plan: true } });
    if (!ord) throw new Error('Order not found');
    if (ord.status === 'CANCELLED') throw new Error('Cannot extend a cancelled order');

    const now = new Date();
    const days = additionalDays ?? ord.plan.durationDays;

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

    const base = ord.expiresAt && ord.expiresAt > now ? ord.expiresAt : now;
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
      `Order ${orderId} extended by ${days} days. New expiry: ${newExpiry.toDateString()}`,
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

export async function assignProxyManually({
  orderId, proxyIds, actor,
}: { orderId: string; proxyIds: string[]; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { plan: true, assignments: { where: { releasedAt: null } } },
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
    const ids = await newAssignmentIds(tx, proxyIds.length);
    for (let i = 0; i < proxyIds.length; i++) {
      const pid = proxyIds[i];
      const p = await tx.proxy.findUnique({ where: { id: pid } });
      if (!p) throw new Error(`Proxy ${pid} not found`);
      if (p.status !== 'AVAILABLE') throw new Error(`Proxy ${pid} is ${p.status}`);
      await tx.assignment.create({
        data: { id: ids[i], orderId, proxyId: pid, actorId: actor.id, assignedAt: now },
      });
      await tx.proxy.update({ where: { id: pid }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
    }

    const currentlyAssigned = ord.assignments.length + proxyIds.length;
    const fullyAssigned = currentlyAssigned >= ord.qty;
    if (fullyAssigned) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'ACTIVE',
          activatedAt: ord.activatedAt ?? now,
          // Honour the plan's real term — was hardcoded +30d, so a 7- or
          // 90-day plan provisioned via manual Assign got 30 days (P1 #1).
          expiresAt: ord.expiresAt ?? new Date(now.getTime() + ord.plan.durationDays * 86_400_000),
          credentialsSentAt: ord.credentialsSentAt ?? now,
          credentialsChannel: ord.credentialsChannel ?? null,
          exception: ord.exception === 'PAID_NOT_PROVISIONED' ? null : ord.exception,
          excInfo: ord.exception === 'PAID_NOT_PROVISIONED' ? null : ord.excInfo,
        },
      });
      await notify(tx, ord.clientId, `Your proxies for ${orderId} are ready`, 'SUCCESS', `/orders/${orderId}`);
    }

    await log(tx, actor.id, 'PROXY.ASSIGN', 'ORDER', orderId,
      `Manually assigned ${proxyIds.length} ${proxyIds.length === 1 ? 'proxy' : 'proxies'} · [${proxyIds.join(', ')}]`);
    return { ok: true, fullyAssigned };
  });
}

export async function sendCredentials({
  orderId, actor, channel,
}: { orderId: string; actor: Actor; channel: 'EMAIL' | 'TELEGRAM' | 'BOTH' }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({ where: { id: orderId } });
    if (!ord) throw new Error('Order not found');
    const now = new Date();
    await tx.order.update({
      where: { id: orderId },
      data: { credentialsSentAt: now, credentialsChannel: channel },
    });
    await notify(tx, ord.clientId, `Credentials for ${orderId} sent via ${channel.toLowerCase()}`, 'INFO', `/orders/${orderId}`);
    await log(tx, actor.id, 'ORDER.CREDENTIALS_SENT', 'ORDER', orderId, `Sent via ${channel}`);
    return { ok: true };
  });
}

/* ════════════════════════════════════════════════════════════════════════
   PROXIES
   ════════════════════════════════════════════════════════════════════════ */

export async function markProxyFaulty({
  proxyId, actor, reason, autoReplace,
}: { proxyId: string; actor: Actor; reason: string; autoReplace: boolean }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: true } } },
    });
    if (!proxy) throw new Error('Proxy not found');

    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: 'FAULTY', health: 'OFFLINE' },
    });

    // Tag any active orders with replacement-pending exception
    for (const a of proxy.assignments) {
      if (!a.order.exception) {
        await tx.order.update({
          where: { id: a.orderId },
          data: { exception: 'REPLACEMENT_PENDING', excInfo: `Proxy ${proxyId} marked faulty: ${reason}` },
        });
        await notify(tx, a.order.clientId,
          `Proxy ${proxyId} on order ${a.orderId} flagged faulty — replacement in progress`,
          'WARNING', `/orders/${a.orderId}`,
        );
      }
    }

    // Optionally auto-replace
    let replacement: string | null = null;
    if (autoReplace && proxy.assignments.length > 0) {
      const a = proxy.assignments[0];
      const candidate = await tx.proxy.findFirst({
        where: { carrier: proxy.carrier, region: proxy.region, pool: proxy.pool, status: 'AVAILABLE', health: 'HEALTHY' },
      });
      if (candidate) {
        // Close old assignment
        await tx.assignment.update({
          where: { id: a.id },
          data: { releasedAt: new Date(), reason: 'REPLACEMENT', reasonDetail: `Replaced by ${candidate.id}` },
        });
        await tx.proxy.update({ where: { id: proxyId }, data: { currentOrderId: null, status: 'RELEASED' } });

        // New assignment
        const [aid] = await newAssignmentIds(tx, 1);
        await tx.assignment.create({
          data: { id: aid, orderId: a.orderId, proxyId: candidate.id, actorId: actor.id, reason: 'REPLACEMENT', reasonDetail: `Replaces ${proxyId}` },
        });
        await tx.proxy.update({ where: { id: candidate.id }, data: { status: 'ASSIGNED', currentOrderId: a.orderId } });

        await tx.order.update({
          where: { id: a.orderId },
          data: { exception: null, excInfo: null },
        });
        replacement = candidate.id;
        await notify(tx, a.order.clientId, `Faulty proxy ${proxyId} replaced with ${candidate.id}`, 'SUCCESS', `/proxies/${candidate.id}`);
      }
    }

    await log(tx, actor.id, 'PROXY.MARK_FAULTY', 'PROXY', proxyId,
      `Faulty · ${reason}${autoReplace ? ` · auto-replace=${replacement ?? 'no candidate'}` : ''}`);
    return { ok: true, replacement };
  });
}

export async function releaseProxy({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');
    await tx.assignment.updateMany({
      where: { proxyId, releasedAt: null },
      data: { releasedAt: new Date(), reason: 'CANCEL', reasonDetail: 'Admin released' },
    });
    await tx.proxy.update({ where: { id: proxyId }, data: { status: 'RELEASED', currentOrderId: null } });
    await log(tx, actor.id, 'PROXY.RELEASE', 'PROXY', proxyId, 'Manually released');
    return { ok: true };
  });
}

// RELEASED → AVAILABLE. Same security-reset markers cancelOrder stamps when it
// returns proxies to pool: the next client must never inherit live credentials.
export async function returnProxyToPool({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');
    if (proxy.status !== 'RELEASED') throw new Error(`Only RELEASED proxies can return to pool (this one is ${proxy.status})`);
    const now = new Date();
    await tx.proxy.update({
      where: { id: proxyId },
      data: { status: 'AVAILABLE', currentOrderId: null, securityResetAt: now, passwordRotatedAt: now, ipRotatedAt: now },
    });
    await log(tx, actor.id, 'PROXY.RETURN_TO_POOL', 'PROXY', proxyId, 'Returned to pool · credentials/IP rotation markers stamped');
    return { ok: true };
  });
}

// FAULTY → healthy. If an order is still attached the proxy goes back to
// serving it (ASSIGNED) and the replacement-pending exception clears;
// otherwise it returns to the pool as AVAILABLE.
export async function markProxyHealthy({ proxyId, actor }: { proxyId: string; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, include: { order: true } } },
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
    }
    await log(tx, actor.id, 'PROXY.MARK_HEALTHY', 'PROXY', proxyId,
      `Healthy again · ${active ? `back to serving ${active.orderId}` : 'returned to pool'}`);
    return { ok: true, backTo: active ? active.orderId : null };
  });
}

// AVAILABLE/ASSIGNED ↔ MAINTENANCE. Entering maintenance PRESERVES any open
// assignment (the client keeps the proxy on paper; it just stops being
// eligible for new work); leaving restores ASSIGNED/AVAILABLE accordingly.
export async function setProxyMaintenance({ proxyId, on, actor }: { proxyId: string; on: boolean; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      include: { assignments: { where: { releasedAt: null }, take: 1 } },
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
      await tx.proxy.update({
        where: { id: proxyId },
        data: { status: active ? 'ASSIGNED' : 'AVAILABLE', currentOrderId: active ? active.orderId : null },
      });
    }
    await log(tx, actor.id, 'PROXY.MAINTENANCE', 'PROXY', proxyId, on ? 'Entered maintenance' : 'Left maintenance');
    return { ok: true };
  });
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
  preRenewalReminderHours: number;
  gracePeriodHours: number;
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
        gracePeriodHours: input.gracePeriodHours,
        renewalDiscountPct: input.renewalDiscountPct,
        lowCapacityThresholdPct: input.lowCapacityThresholdPct ?? null,
      },
    });

    await log(tx, actor.id, 'PLAN.CREATE', 'PLAN', plan.id,
      `Created ${plan.name} · ${plan.carrier} · ${plan.region} · ${plan.durationDays}d · $${plan.price} · quota=${plan.availableQuota}${plan.active ? ' · published to client portal' : ' · disabled'}`);

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
  return prisma.$transaction(async tx => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('User not found');
    const newBalance = Number(u.balance) + delta;
    if (newBalance < 0) throw new Error('Adjustment would create negative balance');

    await tx.user.update({ where: { id: userId }, data: { balance: newBalance } });
    await tx.balanceLedgerEntry.create({
      data: {
        userId, op: 'MANUAL_ADJUST', amount: delta, balanceAfter: newBalance,
        note: note ? `${reason} — ${note}` : reason,
      },
    });

    await notify(tx, userId,
      delta >= 0
        ? `Balance credit: +$${delta} · ${reason}`
        : `Balance debit: -$${Math.abs(delta)} · ${reason}`,
      delta >= 0 ? 'SUCCESS' : 'WARNING', '/billing',
    );
    await log(tx, actor.id, 'CLIENT.BALANCE_ADJUST', 'CLIENT', userId,
      `${delta >= 0 ? '+' : ''}$${delta} · ${reason}${note ? ' · ' + note : ''} → balance=$${newBalance}`);
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
          data: { status: 'SUSPENDED', autoRenewBeforeSuspend: o.autoRenew, autoRenew: false },
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
    const password = input.password?.trim() || Math.random().toString(36).slice(2, 14);
    const passwordHash = await bcrypt.hash(password, 10);
    await tx.user.create({
      data: {
        id,
        name: input.name.trim(),
        email,
        passwordHash,
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
  preRenewalReminderHours?: number;
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
  paymentMethod: 'stripe' | 'invoice' | 'crypto' | 'comp';
  autoAssign?: boolean;
  autoRenew?: boolean;
};

// ORD-/PAY- are random by product rule (2026-07-06) — uniqueness-checked
// against the base table, PK is the hard guard. INV- stays sequential via
// its sequence.
const nextOrderIdInTx = (_tx: Tx) => nextOrderId();
const nextPaymentIdInTx = (_tx: Tx) => nextPaymentId();
const nextInvoiceIdInTx = (tx: Tx) => nextInvoiceId(tx);

export async function createOrderByAdmin({ input, actor }: { input: NewOrderInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const client = await tx.user.findUnique({ where: { id: input.clientId } });
    if (!client || client.role !== 'CLIENT') throw new Error('Client not found');
    if (client.status === 'BLOCKED') throw new Error('Client is blocked');

    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.active || plan.deletedAt) throw new Error('Plan unavailable');

    if (input.qty < 1) throw new Error('Quantity must be ≥ 1');

    // Capacity check
    const alloc = await tx.order.aggregate({
      _sum: { qty: true },
      where: { planId: plan.id, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    if (plan.availableQuota - (alloc._sum.qty ?? 0) < input.qty) throw new Error('Plan capacity insufficient');

    const discount = input.discountPct ?? 0;
    const unitPrice = Number(plan.price) * (1 - discount / 100);
    const total = unitPrice * input.qty;
    const isInstant = input.paymentMethod === 'comp' || input.paymentMethod === 'stripe';
    const willActivate = isInstant && plan.autoProvision;
    const now = new Date();
    // (Term is computed as `finalExpires` below, gated on ACTIVE — the order
    // create uses that; no pay-time expiry here.)

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
    const finalStatus =
      input.paymentMethod === 'comp' && fullyAssigned ? 'ACTIVE' as const
      : willActivate && fullyAssigned ? 'ACTIVE' as const
      : isInstant || input.paymentMethod === 'comp' ? 'PROVISIONING' as const
      : 'NEW' as const;
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    const finalExpires = finalStatus === 'ACTIVE' ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;
    const finalException =
      (willActivate || input.paymentMethod === 'comp') && (input.autoAssign ?? true) && !fullyAssigned
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
        discountPct: discount,
        region: plan.region,
        paymentStatus: input.paymentMethod === 'comp' ? 'FREE' : (isInstant ? 'PAID' : (input.paymentMethod === 'crypto' ? 'AWAITING' : 'PENDING')),
        status: finalStatus,
        autoRenew: input.autoRenew ?? plan.autoRenewDefault,
        autoProvision: plan.autoProvision,
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
        provider: input.paymentMethod === 'stripe' ? 'Stripe' : input.paymentMethod === 'crypto' ? 'CoinPayments' : input.paymentMethod === 'invoice' ? 'Bank transfer' : 'Comp',
        method: input.paymentMethod === 'stripe' ? 'Visa •• 4242' : input.paymentMethod === 'crypto' ? 'USDT-TRC20' : input.paymentMethod === 'invoice' ? 'Bank wire' : 'Comp',
        gross: total,
        fees: isInstant && input.paymentMethod === 'stripe' ? total * 0.03 : 0,
        net: total,
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
        : finalException === 'PAID_NOT_PROVISIONED'
          ? `Order ${orderId} received — provisioning in progress (capacity hit)`
          : isInstant ? `Order ${orderId} received — fulfilment in progress`
          : `Order ${orderId} created — awaiting payment`,
      finalStatus === 'ACTIVE' ? 'SUCCESS' : finalException ? 'WARNING' : 'INFO',
      `/orders/${orderId}`,
    );
    await log(tx, actor.id, 'ORDER.CREATE', 'ORDER', orderId,
      `Admin-created · ${client.name} (${client.id}) · ${plan.name} · qty ${input.qty} · ${input.paymentMethod} · $${total.toFixed(2)} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`);

    return { ok: true, orderId };
  });
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
};

const nextProxyIdInTx = (tx: Tx) => nextProxyId(tx);

export async function registerProxy({ input, actor }: { input: RegisterProxyInput; actor: Actor }) {
  return prisma.$transaction(async tx => {
    if (!input.modem.trim() || !input.ip.trim() || !input.username.trim() || !input.password.trim()) {
      throw new Error('All proxy fields required');
    }
    if (input.port < 1 || input.port > 65535) throw new Error('Port out of range');
    const id = await nextProxyIdInTx(tx);
    await tx.proxy.create({
      data: {
        id,
        modem: input.modem.trim(),
        imei: input.imei?.trim() || null,
        carrier: input.carrier,
        region: input.region,
        pool: input.pool,
        city: input.city?.trim() || null,
        ip: input.ip.trim(),
        port: input.port,
        username: input.username.trim(),
        password: input.password.trim(),
        rotateToken: Math.random().toString(36).slice(2, 18),
        status: 'AVAILABLE',
        health: 'HEALTHY',
      },
    });
    await log(tx, actor.id, 'PROXY.REGISTER', 'PROXY', id,
      `Registered ${id} · ${input.carrier} · ${input.region} · ${input.pool} · ${input.modem}`);
    return { ok: true, proxyId: id };
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
    await tx.order.update({
      where: { id: orderId },
      // paymentStatus flips too — the order snapshot and dashboard feed read
      // it, and a cancelled order must not keep looking "Awaiting".
      data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date(), cancelledReason: 'Cancelled by client before payment' },
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

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'REFUND_REQUESTED' },
    });
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

  // Renewals honour the plan's renewal discount (audit B-6) — same helper as
  // the checkout renewal path, so the displayed price equals the charged one.
  const unit = renewalUnitPrice(Number(o.plan.price), o.plan.renewalDiscountPct);
  const price = unit * o.qty;
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
    const newBalance = balance - price;
    await tx.user.update({ where: { id: clientId }, data: { balance: newBalance } });
    await tx.balanceLedgerEntry.create({
      data: { userId: clientId, op: 'ORDER_DEBIT', amount: -price, balanceAfter: newBalance, refOrderId: orderId, note: `Renewal of ${orderId}` },
    });
    const payId = await nextPaymentIdInTx(tx);
    await tx.payment.create({
      data: {
        id: payId, orderId, clientId,
        provider: 'Balance', method: 'Balance',
        gross: price, fees: 0, net: price,
        status: 'CONFIRMED', confirmedAt: now,
      },
    });
    const invId = await nextInvoiceIdInTx(tx);
    await tx.invoice.create({ data: { id: invId, paymentId: payId, orderId, clientId, amount: price } });

    const base = o.expiresAt && o.expiresAt > now ? o.expiresAt : now;
    const newExpiry = new Date(base.getTime() + o.plan.durationDays * 86_400_000);
    await tx.order.update({
      where: { id: orderId },
      data: {
        expiresAt: newExpiry,
        status: o.status === 'EXPIRED' ? 'ACTIVE' : o.status,
        activatedAt: o.activatedAt ?? now,
        renewalBucket: 'RENEWED',
        lastReminderAt: null,
        exception: o.exception === 'RENEWAL_NOT_EXTENDED' ? null : o.exception,
      },
    });
    await log(tx, clientId, 'ORDER.EXTEND', 'ORDER', orderId,
      `Client renewal · $${price} from balance · new expiry ${newExpiry.toDateString()}`);
    await notify(tx, clientId, `Order ${orderId} renewed — new expiry ${newExpiry.toLocaleDateString()}`, 'SUCCESS', `/orders/${orderId}`);
    return { ok: true, redirect: null, newExpiry: newExpiry.toISOString() };
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
