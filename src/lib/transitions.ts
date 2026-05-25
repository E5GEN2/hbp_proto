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
import { nextInvoiceId } from './id';
import type { Prisma, LogObjectType, NotificationKind, OrderException, OrderStatus, PaymentStatus, ProxyStatus, ProxyHealth } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name?: string };

// In-tx ID generators that see pending writes (avoid collisions in batched ops).
async function newAssignmentIds(tx: Tx, count: number): Promise<string[]> {
  const rows = await tx.assignment.findMany({ where: { id: { startsWith: 'ASN-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return Array.from({ length: count }, (_, i) => `ASN-${String(max + 1 + i).padStart(5, '0')}`);
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
      const willActivate = plan.autoProvision;
      const expiresAt = willActivate ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;

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
      await tx.order.update({
        where: { id: ord.id },
        data: {
          paymentStatus: 'PAID',
          status: willActivate && fullyAssigned ? 'ACTIVE' : 'PROVISIONING',
          activatedAt: willActivate && fullyAssigned ? now : null,
          expiresAt,
          credentialsSentAt: willActivate && fullyAssigned ? now : null,
          credentialsChannel: willActivate && fullyAssigned ? 'EMAIL' : null,
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
    if (pay.status !== 'CONFIRMED' && pay.status !== 'PAID') throw new Error(`Cannot refund from status ${pay.status}`);

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
        // If paid, raise refund-pending so finance can close the loop
        exception: wasPaid ? 'REFUND_PENDING' : ord.exception,
      },
    });

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
    await log(tx, actor.id, 'ORDER.SUSPEND', 'ORDER', orderId, `Suspended · ${reason}`);
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

    const days = additionalDays ?? ord.plan.durationDays;
    const base = ord.expiresAt && ord.expiresAt > new Date() ? ord.expiresAt : new Date();
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

export async function assignProxyManually({
  orderId, proxyIds, actor,
}: { orderId: string; proxyIds: string[]; actor: Actor }) {
  return prisma.$transaction(async tx => {
    const ord = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { releasedAt: null } } },
    });
    if (!ord) throw new Error('Order not found');

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
          expiresAt: ord.expiresAt ?? new Date(now.getTime() + 30 * 86_400_000),
          credentialsSentAt: ord.credentialsSentAt ?? now,
          credentialsChannel: ord.credentialsChannel ?? 'EMAIL',
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

/* ════════════════════════════════════════════════════════════════════════
   PLANS
   ════════════════════════════════════════════════════════════════════════ */

export async function togglePlanActive({
  planId, actor, active, reason,
}: { planId: string; actor: Actor; active: boolean; reason?: string }) {
  return prisma.$transaction(async tx => {
    const plan = await tx.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error('Plan not found');
    if (plan.active === active) return { ok: true, noop: true };
    await tx.plan.update({ where: { id: planId }, data: { active } });
    await log(tx, actor.id, 'PLAN.UPDATE', 'PLAN', planId, `${active ? 'Enabled' : 'Disabled'}${reason ? ' · ' + reason : ''} — ${active ? 'visible in client catalog' : 'hidden from client catalog'}`);
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
