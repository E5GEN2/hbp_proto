import { prisma } from './prisma';
import { fmtDate } from './date';
import type { RenewalBucket } from '@prisma/client';

/**
 * The system's only time-driven job (audit B-1). Idempotent — safe to run at any
 * frequency; every step re-checks state and only writes on change.
 *
 *   1. ACTIVE orders past `expiresAt` → EXPIRED. Assignments are PRESERVED —
 *      the grace window keeps the proxies bound (LIFECYCLE_CONTRACT l.87);
 *      auto-release after grace stays deferred until the flag is wired.
 *   2. renewalBucket classifier — drives admin Renewals tabs + dashboard
 *      Expiring-soon: H24 / D3 / D7 for approaching expiry, GRACE while inside
 *      the plan's grace window after expiry, EXPIRED past it. RENEWED is sticky
 *      until the order re-enters the ≤7d window.
 *   3. AWAITING payments older than 72h → CANCELLED; their still-NEW orders are
 *      cancelled too (payment window expired).
 *
 * Auto-renew execution at expiry is intentionally NOT here yet — it moves money
 * and needs its own sign-off (fix-plan Phase 3).
 */

const AWAITING_TIMEOUT_MS = 72 * 3_600_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export type SweepResult = {
  ranAt: string;
  expired: number;
  bucketUpdates: number;
  timedOutPayments: number;
  cancelledOrders: number;
  skipped?: boolean;
};

async function notify(userId: string, title: string, kind: 'INFO' | 'WARNING', link: string) {
  await prisma.notification.create({
    data: { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId, title, kind, link },
  });
}

// actorId null renders as "System" in the admin log table
async function log(action: string, objectType: 'ORDER' | 'PAYMENT', objectId: string, detail: string) {
  await prisma.log.create({ data: { actorId: null, action, objectType, objectId, detail } });
}

function targetBucket(order: { expiresAt: Date | null; renewalBucket: RenewalBucket | null; graceHours: number }, now: number): RenewalBucket | null {
  if (!order.expiresAt) return null;
  const msLeft = order.expiresAt.getTime() - now;
  if (msLeft <= 0) {
    return now < order.expiresAt.getTime() + order.graceHours * 3_600_000 ? 'GRACE' : 'EXPIRED';
  }
  const hoursLeft = msLeft / 3_600_000;
  if (hoursLeft <= 24) return 'H24';
  if (hoursLeft <= 72) return 'D3';
  if (hoursLeft <= 168) return 'D7';
  // Beyond 7 days out: keep "Renewal paid" visible on the renewals board
  return order.renewalBucket === 'RENEWED' ? 'RENEWED' : null;
}

let running = false;

export async function runSweep(): Promise<SweepResult> {
  const ranAt = new Date().toISOString();
  if (running) return { ranAt, expired: 0, bucketUpdates: 0, timedOutPayments: 0, cancelledOrders: 0, skipped: true };
  running = true;
  try {
    const now = Date.now();
    let expired = 0, bucketUpdates = 0, timedOutPayments = 0, cancelledOrders = 0;

    // ── 1. Expire past-due ACTIVE orders ────────────────────────────────────
    const dueOrders = await prisma.order.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date(now) } },
      include: { plan: { select: { gracePeriodHours: true } } },
    });
    for (const o of dueOrders) {
      const bucket = targetBucket({ expiresAt: o.expiresAt, renewalBucket: o.renewalBucket, graceHours: o.plan.gracePeriodHours }, now);
      await prisma.$transaction(async tx => {
        const fresh = await tx.order.findUnique({ where: { id: o.id }, select: { status: true } });
        if (fresh?.status !== 'ACTIVE') return; // renewed/cancelled since the read
        await tx.order.update({
          where: { id: o.id },
          data: { status: 'EXPIRED', renewalBucket: bucket },
        });
      });
      expired++;
      await notify(o.clientId,
        `Order ${o.id} expired on ${fmtDate(o.expiresAt)} — renew to keep your proxies`,
        'WARNING', `/orders/${o.id}`);
      await log('ORDER.EXPIRE', 'ORDER', o.id,
        `Expired by sweep · was due ${o.expiresAt?.toISOString() ?? '—'} · bucket=${bucket ?? '—'}${o.autoRenew ? ' · auto-renew was ON (execution not wired yet)' : ''}`);
    }

    // ── 2. Re-classify renewal buckets (ACTIVE approaching + EXPIRED aging) ─
    const classifiable = await prisma.order.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRED'] }, expiresAt: { not: null } },
      select: { id: true, expiresAt: true, renewalBucket: true, plan: { select: { gracePeriodHours: true } } },
    });
    for (const o of classifiable) {
      const bucket = targetBucket({ expiresAt: o.expiresAt, renewalBucket: o.renewalBucket, graceHours: o.plan.gracePeriodHours }, now);
      if (bucket !== o.renewalBucket) {
        await prisma.order.update({ where: { id: o.id }, data: { renewalBucket: bucket } });
        bucketUpdates++;
      }
    }

    // ── 3. Time out stale AWAITING payments (+ their still-NEW orders) ──────
    const stale = await prisma.payment.findMany({
      where: { status: 'AWAITING', createdAt: { lte: new Date(now - AWAITING_TIMEOUT_MS) } },
      include: { order: { select: { id: true, status: true, clientId: true } } },
    });
    for (const p of stale) {
      await prisma.payment.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
      timedOutPayments++;
      await log('PAYMENT.CANCEL', 'PAYMENT', p.id, 'Cancelled by sweep — no confirmation within 72h');
      if (p.order && p.order.status === 'NEW') {
        await prisma.order.update({
          where: { id: p.order.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: 'Payment window expired (72h)', autoRenew: false, renewalBucket: null },
        });
        cancelledOrders++;
        await notify(p.order.clientId,
          `Order ${p.order.id} was cancelled — payment wasn't received within 72 hours`,
          'INFO', `/orders/${p.order.id}`);
        await log('ORDER.CANCEL', 'ORDER', p.order.id, 'Cancelled by sweep — payment window expired');
      } else if (p.orderId === null) {
        await notify(p.clientId,
          `Deposit ${p.id} was cancelled — no on-chain confirmation within 72 hours`,
          'INFO', '/billing');
      }
    }

    return { ranAt, expired, bucketUpdates, timedOutPayments, cancelledOrders };
  } finally {
    running = false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __sweepLoopStarted: boolean | undefined;
}

export function startSweepLoop() {
  if (global.__sweepLoopStarted) return;
  global.__sweepLoopStarted = true;
  const tick = () => {
    runSweep()
      .then(r => {
        if (r.expired || r.bucketUpdates || r.timedOutPayments || r.cancelledOrders) {
          console.log('[sweep]', JSON.stringify(r));
        }
      })
      .catch(err => console.error('[sweep] failed', err));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, SWEEP_INTERVAL_MS);
}
