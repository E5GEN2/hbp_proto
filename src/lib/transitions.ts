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
import bcrypt from 'bcryptjs';
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

async function nextUserIdInTx(tx: Tx) {
  const rows = await tx.user.findMany({ where: { id: { startsWith: 'USR-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `USR-${String(max + 1).padStart(5, '0')}`;
}

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

async function nextOrderIdInTx(tx: Tx) {
  const rows = await tx.order.findMany({ where: { id: { startsWith: 'ORD-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ORD-${String(max + 1).padStart(5, '0')}`;
}
async function nextPaymentIdInTx(tx: Tx) {
  const rows = await tx.payment.findMany({ where: { id: { startsWith: 'PAY-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PAY-${String(max + 1).padStart(5, '0')}`;
}
async function nextInvoiceIdInTx(tx: Tx) {
  const rows = await tx.invoice.findMany({ where: { id: { startsWith: 'INV-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INV-${String(max + 1).padStart(5, '0')}`;
}

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
    const expiresAt = willActivate ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;

    const orderId = await nextOrderIdInTx(tx);
    const payId = await nextPaymentIdInTx(tx);

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
        status: willActivate ? 'ACTIVE' : (isInstant || input.paymentMethod === 'comp' ? 'PROVISIONING' : 'NEW'),
        autoRenew: input.autoRenew ?? plan.autoRenewDefault,
        autoProvision: plan.autoProvision,
        source: 'admin',
        activatedAt: willActivate ? now : null,
        expiresAt,
        credentialsSentAt: willActivate ? now : null,
        credentialsChannel: willActivate ? 'EMAIL' : null,
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

    // Auto-assign proxies if autoProvision + isInstant
    let assigned = 0;
    if (willActivate && (input.autoAssign ?? true)) {
      const candidates = await tx.proxy.findMany({
        where: { carrier: plan.carrier, region: plan.region, pool: plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: input.qty,
      });
      if (candidates.length < input.qty) {
        const more = await tx.proxy.findMany({
          where: { carrier: plan.carrier, region: plan.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
          take: input.qty - candidates.length,
        });
        candidates.push(...more);
      }
      const ids = await newAssignmentIds(tx, candidates.length);
      for (let i = 0; i < candidates.length; i++) {
        await tx.assignment.create({
          data: { id: ids[i], orderId, proxyId: candidates[i].id, actorId: actor.id, assignedAt: now },
        });
        await tx.proxy.update({ where: { id: candidates[i].id }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
        assigned++;
      }
      if (assigned < input.qty) {
        await tx.order.update({
          where: { id: orderId },
          data: { exception: 'PAID_NOT_PROVISIONED', excInfo: `Pool exhausted — only ${assigned}/${input.qty} provisioned` },
        });
      }
    }

    await notify(tx, input.clientId,
      willActivate && assigned >= input.qty ? `Order ${orderId} activated — ${input.qty} ${input.qty === 1 ? 'proxy' : 'proxies'} ready`
      : isInstant ? `Order ${orderId} received — fulfilment in progress`
      : `Order ${orderId} created — awaiting payment`,
      willActivate && assigned >= input.qty ? 'SUCCESS' : 'INFO',
      `/orders/${orderId}`,
    );
    await log(tx, actor.id, 'ORDER.CREATE', 'ORDER', orderId,
      `Admin-created · ${client.name} (${client.id}) · ${plan.name} · qty ${input.qty} · ${input.paymentMethod} · $${total.toFixed(2)}`);

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

async function nextProxyIdInTx(tx: Tx) {
  const rows = await tx.proxy.findMany({ where: { id: { startsWith: 'PXY-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PXY-${String(max + 1).padStart(5, '0')}`;
}

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
