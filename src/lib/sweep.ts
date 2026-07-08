import { prisma } from './prisma';
import { fmtDate } from './date';
import { attemptAutoRenew } from './auto-renew';
import { sendEmail, autoRenewedEmail, autoRenewFailedGraceEmail, autoRenewFailedExpiredEmail, renewalReminderEmail } from './email';
import type { RenewalBucket } from '@prisma/client';

/**
 * The system's only time-driven job (audit B-1). Idempotent — safe to run at any
 * frequency; every step re-checks state and only writes on change.
 *
 *   1. ACTIVE orders past `expiresAt`: auto-renew orders get a charge attempt
 *      first (balance → card waterfall, see auto-renew.ts; retried every 24h
 *      inside the plan's grace window, during which the order STAYS ACTIVE) —
 *      only then EXPIRED. Non-auto-renew orders expire immediately as before.
 *      Assignments are PRESERVED through the grace window — the client keeps
 *      using the proxies (LIFECYCLE_CONTRACT l.87).
 *   1b. Once grace is fully over, step 1b RELEASES the proxies back to the
 *      pool (reason ORDER_EXPIRED, security-reset stamps) — credentials
 *      vanish from the client portal at that moment. Renewal of an order
 *      whose proxies were released re-provisions fresh ones
 *      (reprovisionRenewedOrder); while proxies are still bound (in grace)
 *      renewal is a plain term extension. gracePeriodHours = 0 → release on
 *      the tick after expiry. Kill-switch: autoReleaseAfterGrace flag.
 *   1c. Pre-renewal reminders: non-auto-renew ACTIVE orders inside their
 *      plan's preRenewalReminderHours window get ONE bell notification +
 *      email per term (lastReminderAt gates; renewals reset it).
 *   2. renewalBucket classifier — drives admin Renewals tabs + dashboard
 *      Expiring-soon: H24 / D3 / D7 for approaching expiry, GRACE while inside
 *      the plan's grace window after expiry, EXPIRED past it. RENEWED is sticky
 *      until the order re-enters the ≤7d window.
 *   3. AWAITING payments older than 72h → CANCELLED; their still-NEW orders are
 *      cancelled too (payment window expired).
 *
 * Auto-renew execution signed off by the owner 2026-07-06 (balance → card →
 * grace/expire waterfall + email on every outcome).
 */

const AWAITING_TIMEOUT_MS = 72 * 3_600_000;
const AUTORENEW_RETRY_MS = 24 * 3_600_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export type SweepResult = {
  ranAt: string;
  expired: number;
  released: number;
  reminders: number;
  bucketUpdates: number;
  timedOutPayments: number;
  cancelledOrders: number;
  autoRenewed: number;
  autoRenewFailed: number;
  skipped?: boolean;
};

// Default matches the seed (`autoReleaseAfterGrace: true`) when the flag row
// is absent. Admin can disable it for custom contracts (Settings → Flags).
async function autoReleaseEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'autoReleaseAfterGrace' } });
  return row ? row.value === true : true;
}

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
  if (running) return { ranAt, expired: 0, released: 0, reminders: 0, bucketUpdates: 0, timedOutPayments: 0, cancelledOrders: 0, autoRenewed: 0, autoRenewFailed: 0, skipped: true };
  running = true;
  try {
    const now = Date.now();
    let expired = 0, released = 0, reminders = 0, bucketUpdates = 0, timedOutPayments = 0, cancelledOrders = 0;
    let autoRenewed = 0, autoRenewFailed = 0;

    // ── 1. Past-due ACTIVE orders: auto-renew attempt first, then expire ────
    const dueOrders = await prisma.order.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date(now) } },
      include: { plan: true, client: true },
    });
    for (const o of dueOrders) {
      const graceMs = o.plan.gracePeriodHours * 3_600_000;
      const graceEnd = (o.expiresAt?.getTime() ?? now) + graceMs;
      const inGrace = graceMs > 0 && now < graceEnd;
      let autoRenewGaveUp = false;

      if (o.autoRenew) {
        const lastAttempt = o.autoRenewLastAttemptAt?.getTime() ?? 0;
        if (now - lastAttempt >= AUTORENEW_RETRY_MS) {
          const outcome = await attemptAutoRenew(o);
          if (outcome.renewed) {
            autoRenewed++;
            if (o.client.emailRenewal) {
              await sendEmail({ to: o.client.email, ...autoRenewedEmail(o.id, fmtDate(outcome.newExpiry), outcome.via) });
            }
            continue; // extended — stays ACTIVE
          }
          autoRenewFailed++;
          const firstFail = !o.autoRenewLastAttemptAt;
          await prisma.order.update({
            where: { id: o.id },
            data: { autoRenewLastAttemptAt: new Date(now), ...(inGrace ? { renewalBucket: 'GRACE' as const } : {}) },
          });
          await log('ORDER.AUTORENEW_FAIL', 'ORDER', o.id,
            `Auto-renew failed · ${outcome.reason}${inGrace ? ` · in grace until ${new Date(graceEnd).toISOString()}` : ''}`);
          if (inGrace) {
            // First failure announces the grace window; daily retries stay
            // silent (log only) to avoid mail spam.
            if (firstFail) {
              await notify(o.clientId,
                `Auto-renew failed for ${o.id} — proxies keep working until ${fmtDate(new Date(graceEnd))}. Top up your balance and we'll retry.`,
                'WARNING', `/orders/${o.id}`);
              if (o.client.emailRenewal) {
                await sendEmail({ to: o.client.email, ...autoRenewFailedGraceEmail(o.id, fmtDate(new Date(graceEnd)), outcome.reason) });
              }
            }
            continue; // keep ACTIVE through the grace window
          }
          autoRenewGaveUp = true; // no grace (or grace over) → expire below
        } else if (inGrace) {
          continue; // between retries inside grace — keep ACTIVE
        } else {
          autoRenewGaveUp = true; // grace over, retry not due — expire below
        }
      }

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
      // Honest next-step per grace: with a window the proxies keep working
      // until graceEnd (renew keeps THEM); without one they release on the
      // next tick and a later renewal assigns fresh ones.
      await notify(o.clientId,
        autoRenewGaveUp
          ? `Order ${o.id} expired — auto-renew could not complete. Renew to get fresh proxies.`
          : graceMs > 0
            ? `Order ${o.id} expired — proxies keep working until ${fmtDate(new Date(graceEnd))}; renew before then to keep them`
            : `Order ${o.id} expired on ${fmtDate(o.expiresAt)} — renew to get fresh proxies`,
        'WARNING', `/orders/${o.id}`);
      if (autoRenewGaveUp && o.client.emailRenewal) {
        await sendEmail({ to: o.client.email, ...autoRenewFailedExpiredEmail(o.id) });
      }
      await log('ORDER.EXPIRE', 'ORDER', o.id,
        `Expired by sweep · was due ${o.expiresAt?.toISOString() ?? '—'} · bucket=${bucket ?? '—'}${autoRenewGaveUp ? ' · auto-renew exhausted' : ''}`);
    }

    // ── 1b. Auto-release proxies once the grace window is fully over ────────
    //   Expiry (step 1) intentionally KEEPS assignments through grace
    //   (LIFECYCLE_CONTRACT). This returns them to the pool afterwards:
    //   assignments closed with reason ORDER_EXPIRED, proxies → AVAILABLE
    //   with the same security-reset stamps cancelOrder/returnProxyToPool
    //   use (password + IP rotation markers — the next client never inherits
    //   live credentials). Gated by the autoReleaseAfterGrace flag; until now
    //   this was a daily manual admin chore (report finding #5).
    if (await autoReleaseEnabled()) {
      const stranded = await prisma.order.findMany({
        where: { status: 'EXPIRED', expiresAt: { not: null }, assignments: { some: { releasedAt: null } } },
        include: { plan: { select: { gracePeriodHours: true } }, assignments: { where: { releasedAt: null } } },
      });
      for (const o of stranded) {
        const graceEnd = o.expiresAt!.getTime() + o.plan.gracePeriodHours * 3_600_000;
        if (now < graceEnd) continue; // still inside grace — proxies stay bound
        const releasedAt = new Date(now);
        await prisma.$transaction(async tx => {
          for (const a of o.assignments) {
            await tx.assignment.update({
              where: { id: a.id },
              data: { releasedAt, reason: 'ORDER_EXPIRED', reasonDetail: 'Auto-released after grace window' },
            });
            await tx.proxy.update({
              where: { id: a.proxyId },
              data: { status: 'AVAILABLE', currentOrderId: null, securityResetAt: releasedAt, passwordRotatedAt: releasedAt, ipRotatedAt: releasedAt },
            });
          }
        });
        released += o.assignments.length;
        await notify(o.clientId,
          `Order ${o.id}: the grace period ended and its proxies were released. Renew to get fresh proxies.`,
          'INFO', `/orders/${o.id}`);
        await log('ORDER.RELEASE', 'ORDER', o.id,
          `Auto-released ${o.assignments.length} ${o.assignments.length === 1 ? 'proxy' : 'proxies'} after grace · pool restored, credentials/IP rotation markers stamped`);
      }
    }

    // ── 1c. Pre-renewal reminders ────────────────────────────────────────────
    //   plan.preRenewalReminderHours was written by the plan form but never
    //   read — clients learned about expiry only after the fact. One reminder
    //   per term, for orders WITHOUT auto-renew (auto-renew orders charge
    //   automatically; their failures get dedicated grace emails).
    //   lastReminderAt gates repeats; every renewal path resets it to null,
    //   so each new term reminds once.
    const reminderDue = await prisma.order.findMany({
      where: { status: 'ACTIVE', autoRenew: false, lastReminderAt: null, expiresAt: { gt: new Date(now) } },
      include: { plan: { select: { preRenewalReminderHours: true } }, client: { select: { email: true, emailRenewal: true } } },
    });
    for (const o of reminderDue) {
      const hours = o.plan.preRenewalReminderHours;
      if (hours <= 0) continue; // plan opted out of reminders
      if (o.expiresAt!.getTime() - now > hours * 3_600_000) continue; // not in the window yet
      await prisma.order.update({ where: { id: o.id }, data: { lastReminderAt: new Date(now) } });
      reminders++;
      await notify(o.clientId,
        `Order ${o.id} expires ${fmtDate(o.expiresAt)} — renew to keep your proxies`,
        'WARNING', `/orders/${o.id}`);
      if (o.client.emailRenewal) {
        await sendEmail({ to: o.client.email, ...renewalReminderEmail(o.id, fmtDate(o.expiresAt!)) });
      }
      await log('ORDER.REMINDER', 'ORDER', o.id,
        `Pre-renewal reminder sent · expires ${o.expiresAt!.toISOString()} · window ${hours}h`);
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

    return { ranAt, expired, released, reminders, bucketUpdates, timedOutPayments, cancelledOrders, autoRenewed, autoRenewFailed };
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
        if (r.expired || r.released || r.reminders || r.bucketUpdates || r.timedOutPayments || r.cancelledOrders || r.autoRenewed || r.autoRenewFailed) {
          console.log('[sweep]', JSON.stringify(r));
        }
      })
      .catch(err => console.error('[sweep] failed', err));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, SWEEP_INTERVAL_MS);
}
