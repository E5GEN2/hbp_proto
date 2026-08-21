import { prisma } from './prisma';
import { fmtDate } from './date';
import { attemptAutoRenew } from './auto-renew';
import { sendEmail, autoRenewedEmail, autoRenewFailedGraceEmail, autoRenewFailedExpiredEmail, renewalReminderEmail, incidentEmail } from './email';
import { sendTelegram } from './telegram';
import { autoBackfillEnabled } from './runtime-flags';
import { backfillOrderProxies, refreshProvisionException } from './transitions';
import { failAwaitingPayment } from './settle-payment';
import { reconcileCryptoPayments } from './np-reconcile';
import { loadTierGraceHours, effectiveGraceHours } from './grace';
import { applyCustomExpiry } from './new-order-policy';
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
 *      renewal is a plain term extension. Client grace = 0 → release on
 *      the tick after expiry. Kill-switch: autoReleaseAfterGrace flag.
 *   1c. Pre-renewal reminders: non-auto-renew ACTIVE orders inside their
 *      plan's preRenewalReminderHours window get ONE bell notification +
 *      email per term (lastReminderAt gates; renewals reset it).
 *   2. renewalBucket classifier — drives admin Renewals tabs + dashboard
 *      Expiring-soon: H24 / D3 / D7 for approaching expiry, GRACE while inside
 *      the plan's grace window after expiry, EXPIRED past it. RENEWED is sticky
 *      until the order re-enters the ≤7d window.
 *   3. AWAITING payments older than 72h expire. TOPUP deposits flip to FAILED
 *      (resurrectable — a real deposit paid on day 4–7 still credits when the
 *      finished IPN arrives; NOWPayments addresses live ~7 days, and settle
 *      only resurrects a FAILED charge — a CANCELLED one is swallowed by
 *      idempotency and the money is lost). ORDER payments → CANCELLED, and
 *      their still-NEW orders are cancelled too. Owner crypto-deposit-expiry
 *      policy 2026-08-07 (scope: deposits).
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
  backfilled: number;
  reconciled: number;
  skipped?: boolean;
};

// Default matches the seed (`autoReleaseAfterGrace: true`) when the flag row
// is absent. Admin can disable it for custom contracts (Settings → Flags).
async function autoReleaseEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'autoReleaseAfterGrace' } });
  return row ? row.value === true : true;
}

async function notify(userId: string, title: string, kind: 'INFO' | 'WARNING' | 'SUCCESS', link: string) {
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
  if (running) return { ranAt, expired: 0, released: 0, reminders: 0, bucketUpdates: 0, timedOutPayments: 0, cancelledOrders: 0, autoRenewed: 0, autoRenewFailed: 0, backfilled: 0, reconciled: 0, skipped: true };
  running = true;
  const telegramOutbox: { chatId: string | null; text: string }[] = [];
  const emailOutbox: { to: string; subject: string; html: string; text?: string }[] = [];
  try {
    const now = Date.now();
    let expired = 0, released = 0, reminders = 0, bucketUpdates = 0, timedOutPayments = 0, cancelledOrders = 0;
    let autoRenewed = 0, autoRenewFailed = 0, backfilled = 0, reconciled = 0;

    // Per-tier grace hours, read once per sweep (client override applied
    // per-order below). Grace is a client attribute now (lib/grace.ts).
    const tierGrace = await loadTierGraceHours();

    // ── 0. Reconcile crypto payments against NOWPayments (IPN-independent) ───
    //   Authoritative settlement safety net: polls the NP API for open crypto
    //   payments and settles `finished` charges even when IPNs never arrive or
    //   fail signature verification (the PAY-57160 incident). Guarded so a NP
    //   outage can never abort the rest of the sweep.
    try {
      const rc = await reconcileCryptoPayments(now);
      reconciled = rc.settled;
      if (rc.settled || rc.manualReview || rc.underpaid || rc.errors) {
        console.log('[sweep] np-reconcile', JSON.stringify(rc));
      }
    } catch (err) {
      console.error('[sweep] np-reconcile failed', err);
    }

    // ── 1. Past-due ACTIVE orders: auto-renew attempt first, then expire ────
    const dueOrders = await prisma.order.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date(now) } },
      include: { plan: true, client: true },
    });
    for (const o of dueOrders) {
      const graceMs = effectiveGraceHours(o.client, tierGrace) * 3_600_000;
      const graceEnd = (o.expiresAt?.getTime() ?? now) + graceMs;
      const inGrace = graceMs > 0 && now < graceEnd;
      let autoRenewGaveUp = false;

      if (o.autoRenew) {
        const lastAttempt = o.autoRenewLastAttemptAt?.getTime() ?? 0;
        if (now - lastAttempt >= AUTORENEW_RETRY_MS) {
          const outcome = await attemptAutoRenew(o);
          if (outcome.renewed) {
            autoRenewed++;
            // Receipt for money actually charged — transactional, NEVER gated
            // by emailRenewal (P1-4): that pref covers pre-expiry reminders,
            // not proof that a charge happened.
            await sendEmail({ to: o.client.email, ...autoRenewedEmail(o.id, fmtDate(outcome.newExpiry), outcome.via) });
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
              // Action-needed payment failure ("your service will stop") —
              // transactional (P1-4). The emailRenewal caption promises only
              // reminders; opting out must not silence a service-loss notice.
              await sendEmail({ to: o.client.email, ...autoRenewFailedGraceEmail(o.id, fmtDate(new Date(graceEnd)), outcome.reason) });
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

      const bucket = targetBucket({ expiresAt: o.expiresAt, renewalBucket: o.renewalBucket, graceHours: effectiveGraceHours(o.client, tierGrace) }, now);
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
      // Service-loss notice (order actually expired) — transactional, ungated
      // for the same reason as the grace-failure email above (P1-4).
      if (autoRenewGaveUp) {
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
        include: { client: { select: { tier: true, graceHoursOverride: true } }, assignments: { where: { releasedAt: null } } },
      });
      for (const o of stranded) {
        const graceEnd = o.expiresAt!.getTime() + effectiveGraceHours(o.client, tierGrace) * 3_600_000;
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
              data: { status: 'AVAILABLE', health: 'HEALTHY', currentOrderId: null, securityResetAt: releasedAt, passwordRotatedAt: releasedAt, ipRotatedAt: releasedAt },
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

    // ── 1d. Auto-fill under-provisioned orders from the pool ───────────────
    //   An ACTIVE paid order can run below its bought quantity after a proxy
    //   was marked faulty / released mid-term (report finding: released proxies
    //   never came back to deficit orders on their own). When the master switch
    //   is ON, top each such order back up from AVAILABLE proxies — respecting
    //   the order's own autoProvision snapshot (from its plan). OFF by default.
    if (await autoBackfillEnabled()) {
      // PROVISIONING included (Phase B finding B-3): a paid-not-provisioned
      // order — the client paid and holds NOTHING — is the deficit this flag
      // most owes a fix to, not just mid-term ACTIVE gaps.
      const deficits = await prisma.order.findMany({
        where: { status: { in: ['ACTIVE', 'PROVISIONING'] }, paymentStatus: { in: ['PAID', 'CONFIRMED', 'FREE'] }, autoProvision: true },
        include: {
          plan: { select: { carrier: true, pool: true, durationDays: true } },
          client: { select: { id: true, telegramChatId: true, telegramAll: true, email: true, emailIncidents: true } },
          assignments: { where: { releasedAt: null }, select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      // Zero-proxy orders first (B-2): topping 4/5 up must not starve a client
      // who has nothing at all; ties break oldest-first via the query order.
      deficits.sort((a, b) => Number(a.assignments.length > 0) - Number(b.assignments.length > 0));
      for (const o of deficits) {
        if (o.assignments.length >= o.qty) continue; // fully provisioned
        const nowD = new Date(now);
        const outcome = await prisma.$transaction(async tx => {
          // Same TOCTOU guard as the expiry step (line ~156): the admin may
          // have cancelled/suspended this order since the findMany snapshot —
          // backfilling or activating a dead order would resurrect it to
          // ACTIVE while its refund is pending. Re-read inside the tx and use
          // ONLY the fresh row's state.
          const fresh = await tx.order.findUnique({
            where: { id: o.id },
            select: { status: true, activatedAt: true, expiresAt: true, credentialsSentAt: true, customExpiresAt: true },
          });
          if (!fresh || (fresh.status !== 'ACTIVE' && fresh.status !== 'PROVISIONING')) return null;
          const r = await backfillOrderProxies(tx, { id: o.id, qty: o.qty, region: o.region, plan: o.plan }, 'SYSTEM', nowD);
          // A PROVISIONING order that just reached full quota ACTIVATES — same
          // contract as manual Assign: term clock starts now, not at pay time.
          // A pending admin custom expiry (recreation flow) is consumed here;
          // if it passed while the order waited, fall back to the full term
          // and log (an unattended sweep must not park or kill a paid order).
          const activating = fresh.status === 'PROVISIONING' && r.fully;
          if (activating) {
            const custom = applyCustomExpiry(fresh.customExpiresAt, o.plan.durationDays, nowD);
            await tx.order.update({
              where: { id: o.id },
              data: {
                status: 'ACTIVE',
                activatedAt: fresh.activatedAt ?? nowD,
                expiresAt: fresh.expiresAt ?? custom.expiresAt,
                customExpiresAt: null,
                credentialsSentAt: fresh.credentialsSentAt ?? nowD,
              },
            });
            if (custom.stale && fresh.expiresAt === null) {
              await tx.log.create({
                data: { actorId: 'ADM-SYS', action: 'ORDER.UPDATE', objectType: 'ORDER', objectId: o.id, detail: 'Custom expiry passed before backfill activation — full plan term applied' },
              });
            }
          }
          await refreshProvisionException(tx, o.id);
          return { ...r, activated: activating, firstFill: fresh.status === 'PROVISIONING' };
        });
        if (outcome && outcome.added > 0) {
          backfilled += outcome.added;
          const msg = outcome.activated
            ? `Order ${o.id} activated — ${o.qty} ${o.qty === 1 ? 'proxy' : 'proxies'} ready`
            : outcome.fully
              ? `Order ${o.id}: ${outcome.added} replacement ${outcome.added === 1 ? 'proxy' : 'proxies'} assigned — back to full ${o.qty}.`
              : outcome.firstFill
                ? `Order ${o.id}: ${outcome.live}/${o.qty} proxies assigned; the rest will follow as the pool refills.`
                : `Order ${o.id}: ${outcome.added} replacement ${outcome.added === 1 ? 'proxy' : 'proxies'} assigned (${outcome.live}/${o.qty}); the rest will follow as the pool refills.`;
          await notify(o.clientId, msg, outcome.activated ? 'SUCCESS' : 'INFO', `/orders/${o.id}`);
          telegramOutbox.push({ chatId: o.client.telegramAll ? o.client.telegramChatId : null, text: `✅ ${msg}` });
          // The faulty/release incident emails promise "we'll notify you when
          // it's ready" — this backfill IS that resolution, so it must close
          // the thread on the email channel too (review find). Only on the
          // thread-closing event (full again / activated): partial refills can
          // repeat every sweep tick as the pool trickles in — that would spam.
          if (o.client.emailIncidents && (outcome.fully || outcome.activated)) {
            emailOutbox.push({ to: o.client.email, ...incidentEmail(
              outcome.activated ? `Order ${o.id} activated` : `Proxies restored on order ${o.id}`,
              [`${msg}.`], `/orders/${o.id}`, 'View order') });
          }
          await log('ORDER.BACKFILL', 'ORDER', o.id,
            `Auto-filled ${outcome.added} ${outcome.added === 1 ? 'proxy' : 'proxies'} from pool · now ${outcome.live}/${o.qty}`);
        }
      }
    }

    // ── 2. Re-classify renewal buckets (ACTIVE approaching + EXPIRED aging) ─
    const classifiable = await prisma.order.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRED'] }, expiresAt: { not: null } },
      select: { id: true, expiresAt: true, renewalBucket: true, client: { select: { tier: true, graceHoursOverride: true } } },
    });
    for (const o of classifiable) {
      const bucket = targetBucket({ expiresAt: o.expiresAt, renewalBucket: o.renewalBucket, graceHours: effectiveGraceHours(o.client, tierGrace) }, now);
      if (bucket !== o.renewalBucket) {
        await prisma.order.update({ where: { id: o.id }, data: { renewalBucket: bucket } });
        bucketUpdates++;
      }
    }

    // ── 3. Time out stale AWAITING payments after 72h ──────────────────────
    //   Scope: NOWPayments charges only. Admin-arranged out-of-band payments
    //   (Bank transfer, Comp, off-portal crypto) are a different provider and
    //   routinely take longer than 72h — the sweep must not cancel an order
    //   whose wire is simply in transit (audit C7); an admin settles or cancels
    //   those. Dev-only mock charges ('CoinPayments', created only when NP is
    //   unconfigured) are likewise left alone — they never occur in prod.
    //   Since the webhook no longer fails expired-no-funds charges (10-min
    //   window = open cart), this sweep is the ONE place an abandoned crypto
    //   charge dies.
    //   BOTH kinds now flip to FAILED (via failAwaitingPayment for deposits;
    //   inline for orders, which ALSO cancel their still-NEW order): FAILED is
    //   resurrectable, so a genuinely-late payment (NP addresses live ~7d)
    //   still credits when a finished IPN / reconcile lands — CANCELLED was a
    //   money black hole (settle refuses it, the reconciler never re-polls it;
    //   audit C1/C8/C13). A late finished on a FAILED charge whose order is
    //   CANCELLED is parked for manual review by settle, not silently renewed.
    //   A charge carrying a funds signal (npStatus partially_paid) is parked
    //   in MANUAL_REVIEW instead of dying — failing it would tell the client
    //   "nothing was received" about money that partially arrived (audit C9/C12).
    const stale = await prisma.payment.findMany({
      where: {
        status: 'AWAITING', provider: 'NOWPayments',
        createdAt: { lte: new Date(now - AWAITING_TIMEOUT_MS) },
      },
      include: { order: { select: { id: true, status: true, clientId: true } } },
    });
    for (const p of stale) {
      if (p.npStatus === 'partially_paid') {
        const upd = await prisma.payment.updateMany({ where: { id: p.id, status: 'AWAITING' }, data: { status: 'MANUAL_REVIEW' } });
        if (upd.count > 0) {
          timedOutPayments++;
          await prisma.log.create({
            data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: p.id, detail: 'Sweep: 72h window closed on a partially-paid charge — parked for manual review' },
          });
        }
        continue;
      }
      if (p.kind === 'TOPUP') {
        // Deposit: fail (resurrectable), don't cancel. No external HTTP inside
        // — failAwaitingPayment only writes the bell + log in its own tx.
        const r = await failAwaitingPayment(p.id, 'expired — no payment within 3 days');
        if (r.changed) timedOutPayments++;
        continue;
      }
      // ── ORDER payment: FAIL the charge (resurrectable) AND cancel the still-
      //   NEW order, both writes guarded. Optimistic concurrency: a late
      //   `finished` IPN can settle THIS payment and activate its NEW order
      //   between the snapshot and here. The payment flip is a status-guarded
      //   updateMany that ALSO excludes a since-arrived partial signal (audit
      //   C12 — re-checked in-tx, not from the stale snapshot); the order is
      //   re-read IN-tx so a since-activated order is never cancelled. Both in
      //   one tx so a failed payment never orphans a still-NEW order.
      const done = await prisma.$transaction(async tx => {
        const res = await tx.payment.updateMany({
          // ⚠️ NULL-SAFETY: a bare `NOT { npStatus: 'partially_paid' }` (and
          // equally `not:`) is SQL `npStatus <> '…'`, which is NULL — i.e. not
          // true — for a NULL npStatus. Since a never-polled charge has NULL
          // there, the whole reaper would silently no-op on exactly the rows
          // it exists for. Spell the null arm out (re-review C4/C9).
          where: {
            id: p.id, status: 'AWAITING',
            OR: [{ npStatus: null }, { npStatus: { not: 'partially_paid' } }],
          },
          data: { status: 'FAILED' },
        });
        if (res.count === 0) return null; // settled / partial arrived / moved out of AWAITING — leave it
        await tx.log.create({ data: { actorId: null, action: 'PAYMENT.FAIL', objectType: 'PAYMENT', objectId: p.id, detail: 'Sweep: no confirmation within 72h — failed (resurrectable if paid late)' } });
        if (!p.orderId) return { orderCancelled: false };
        const ord = await tx.order.findUnique({ where: { id: p.orderId }, select: { status: true, clientId: true } });
        if (ord?.status !== 'NEW') return { orderCancelled: false }; // activated since the snapshot — keep it
        await tx.order.update({
          where: { id: p.orderId },
          data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date(now), cancelledReason: 'Payment window expired (72h)', autoRenew: false, renewalBucket: null },
        });
        await tx.notification.create({
          data: { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: ord.clientId, title: `Order ${p.orderId} was cancelled — payment wasn't received within 72 hours`, kind: 'INFO', link: `/orders/${p.orderId}` },
        });
        await tx.log.create({ data: { actorId: null, action: 'ORDER.CANCEL', objectType: 'ORDER', objectId: p.orderId, detail: 'Cancelled by sweep — payment window expired' } });
        return { orderCancelled: true };
      });
      if (done) {
        timedOutPayments++;
        if (done.orderCancelled) cancelledOrders++;
      }
    }

    // ── 3b. Reap abandoned NEW orders whose charge already died ────────────
    //   A NEW order whose payment went FAILED (a real 'failed' IPN) has no
    //   AWAITING charge for step 3 to find, so it lingers NEW (audit: ORD-36349).
    //   Reap only after the LATEST charge has been dead for 72h — NOT the order
    //   age (a 4-day-old order whose fresh retry just failed still has its
    //   Retry surfaces up; cancelling it minutes later contradicts the bell's
    //   "you can retry" promise, audit C4). The updateMany is guarded on
    //   status NEW AND paymentStatus FAILED so a concurrent repay (which
    //   re-arms paymentStatus to AWAITING) makes the reap no-op (audit C16).
    const deadNew = await prisma.order.findMany({
      where: { status: 'NEW', paymentStatus: 'FAILED' },
      select: { id: true, clientId: true },
    });
    for (const o of deadNew) {
      const done = await prisma.$transaction(async tx => {
        const live = await tx.payment.findFirst({
          // Refund states are "live" too: an order whose payment is being
          // refunded must not be auto-cancelled with a "window expired" bell
          // while the money is still going back to the client (review C).
          where: { orderId: o.id, status: { in: ['AWAITING', 'MANUAL_REVIEW', 'CONFIRMED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'] } }, select: { id: true },
        });
        if (live) return false; // being paid / under review / settled — leave it
        // Age off the newest charge, not the order: a just-failed retry keeps
        // the order alive until ITS 72h elapses.
        const latest = await tx.payment.findFirst({
          where: { orderId: o.id }, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true },
        });
        if (!latest || latest.status !== 'FAILED' || latest.createdAt.getTime() > now - AWAITING_TIMEOUT_MS) return false;
        const res = await tx.order.updateMany({
          where: { id: o.id, status: 'NEW', paymentStatus: 'FAILED' },
          data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date(now), cancelledReason: 'Payment window expired (72h)', autoRenew: false, renewalBucket: null },
        });
        if (res.count === 0) return false;
        await tx.notification.create({
          data: { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: o.clientId, title: `Order ${o.id} was cancelled — payment wasn't received within 72 hours`, kind: 'INFO', link: `/orders/${o.id}` },
        });
        await tx.log.create({ data: { actorId: null, action: 'ORDER.CANCEL', objectType: 'ORDER', objectId: o.id, detail: 'Cancelled by sweep — payment window expired (dead charge)' } });
        return true;
      });
      if (done) cancelledOrders++;
    }

    // ── 4. Purge expired email-verification rows ───────────────────────────
    //   issueVerification is create-only (the durable resend cap counts rows),
    //   so abandoned/expired challenges never self-delete — they only go inert.
    //   Reap them here to bound table growth (already-verified users' rows are
    //   deleted at completeVerification time).
    await prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });

    // ── 5. Client-bell retention (owner rule): notifications live 7 days ────
    //   The Notification table only feeds the client bell (/api/notifications);
    //   the admin ops-bell derives from live queues and stores nothing, so this
    //   purge cannot touch admin signals.
    await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now - 7 * 86_400_000) } } });

    return { ranAt, expired, released, reminders, bucketUpdates, timedOutPayments, cancelledOrders, autoRenewed, autoRenewFailed, backfilled, reconciled };
  } finally {
    running = false;
    // External HTTP after the DB work — never inside a transaction.
    for (const m of telegramOutbox) await sendTelegram(m.chatId, m.text);
    for (const e of emailOutbox) await sendEmail(e);
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
        if (r.expired || r.released || r.reminders || r.bucketUpdates || r.timedOutPayments || r.cancelledOrders || r.autoRenewed || r.autoRenewFailed || r.backfilled || r.reconciled) {
          console.log('[sweep]', JSON.stringify(r));
        }
      })
      .catch(err => console.error('[sweep] failed', err));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, SWEEP_INTERVAL_MS);
}
