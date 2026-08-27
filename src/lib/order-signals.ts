// Secondary order signals — the TIME-HORIZON layer of the admin status system
// (owner revision 2026-08-26, phase 1). Answers "where does this order sit
// relative to its expiry/grace clock", computed LIVE from expiresAt + the
// client's effective grace — never from renewalBucket. The bucket column is
// the sweep-maintained QUEUE feeding the Renewals board: it lags a sweep tick
// and freezes on SUSPENDED, so display must not read it for the clock. The one
// exception is the sticky RENEWED marker, which is not clock-derived (it means
// "a renewal was paid and the next window is >7d out").
//
// Vocabulary rule (coherent signals): one signal = one label = one tone = one
// destination, shared by every admin surface. Phase 1 renders it on the order
// detail page; phase 2 moves the list tables onto this same helper.

import type { OrderStatus, RenewalBucket, UserTier } from '@prisma/client';
import { effectiveGraceHours, renewalClosed, type TierGraceHours } from './grace';
import { fmtAdminStamp } from './date';

export type OrderTimeSignal = {
  kind: 'expiring24' | 'expiring3d' | 'expiring7d' | 'grace' | 'pastGraceHeld' | 'renewalClosed' | 'renewed';
  // Base label; surfaces may append the boundary ("· until 28 Aug, 14:00").
  label: string;
  // Maps 1:1 onto the shared .chip.* tone classes (globals.css).
  tone: 'danger' | 'warning' | 'violet' | 'success' | 'muted';
  // The Renewals view this signal belongs to (a signal's counter/list home).
  href: string;
  // The clock boundary behind the signal: the expiry for expiring*, the grace
  // end for grace/pastGraceHeld/renewalClosed; null for the sticky renewed.
  until: Date | null;
  // Whether that boundary is already in the past (the two past-grace kinds).
  // Surfaces MUST word the stamp accordingly — "until <stamp>" for a future
  // deadline, "grace ended <stamp>" for a passed one: phrasing a past grace
  // end as "until X" reads as the closure lifting at X, the inverse of the
  // truth (adversarial review P1-review finding).
  untilPassed: boolean;
};

// The 24h/3d/7d windows are the same boundaries the sweep's targetBucket uses
// for the Renewals queue — one taxonomy, two consumers (live display here,
// materialized queue there).
export function orderTimeSignal(
  order: { status: OrderStatus; expiresAt: Date | null; renewalBucket: RenewalBucket | null },
  liveAssignments: number,
  client: { tier: UserTier; graceHoursOverride: number | null },
  tierGrace: TierGraceHours,
  nowMs: number,
): OrderTimeSignal | null {
  // The clock only runs for orders holding a live term: ACTIVE (approaching
  // expiry) and EXPIRED (inside/past grace). SUSPENDED is frozen by design,
  // NEW/PROVISIONING have no term yet, CANCELLED/PENDING_RENEWAL are done.
  if (order.status !== 'ACTIVE' && order.status !== 'EXPIRED') return null;
  if (!order.expiresAt) return null;

  const expMs = order.expiresAt.getTime();
  const msLeft = expMs - nowMs;

  if (msLeft > 0) {
    const hoursLeft = msLeft / 3_600_000;
    if (hoursLeft <= 24) return { kind: 'expiring24', label: 'Expiring · 24h', tone: 'danger', href: '/admin/renewals?view=24h', until: order.expiresAt, untilPassed: false };
    if (hoursLeft <= 72) return { kind: 'expiring3d', label: 'Expiring · 3d', tone: 'warning', href: '/admin/renewals?view=3d', until: order.expiresAt, untilPassed: false };
    if (hoursLeft <= 168) return { kind: 'expiring7d', label: 'Expiring · 7d', tone: 'violet', href: '/admin/renewals?view=7d', until: order.expiresAt, untilPassed: false };
    // Beyond 7 days the clock is quiet; surface the sticky "renewal paid"
    // marker so a freshly-renewed order reads as resolved, not unsignalled.
    if (order.renewalBucket === 'RENEWED') return { kind: 'renewed', label: 'Renewed', tone: 'success', href: '/admin/renewals?view=renewed', until: null, untilPassed: false };
    return null;
  }

  // Past the expiry instant — grace math, decided by the CLOCK (isPastGrace
  // semantics: in-grace = NOT past grace, so the boundary instant itself still
  // counts as grace — consistent with renewalClosed below). status may read
  // ACTIVE for up to one sweep tick after expiry; showing the grace state
  // early is honest and matches the clock-based server renewal guards.
  const graceEnd = new Date(expMs + effectiveGraceHours(client, tierGrace) * 3_600_000);
  if (nowMs <= graceEnd.getTime()) {
    return { kind: 'grace', label: 'In grace', tone: 'warning', href: '/admin/renewals?view=grace', until: graceEnd, untilPassed: false };
  }
  if (renewalClosed(order.expiresAt, liveAssignments, client, tierGrace, nowMs)) {
    return { kind: 'renewalClosed', label: 'Renewal closed', tone: 'muted', href: '/admin/renewals?view=expired', until: graceEnd, untilPassed: true };
  }
  // Past grace but proxies still bound (the autoReleaseAfterGrace kill-switch
  // off — custom contracts): a contiguous renewal is STILL possible, and the
  // client is holding proxies past their paid window — flag it loudly.
  return { kind: 'pastGraceHeld', label: 'Past grace · proxies held', tone: 'danger', href: '/admin/renewals?view=expired', until: graceEnd, untilPassed: true };
}

// ── The renewalBucket QUEUE taxonomy (phase 3) ──────────────────────────────
// The bucket column materializes the same 24h/3d/7d/grace windows for the
// Renewals board. Only these statuses have a running clock — the sweep
// classifies exactly this set, cancelOrder/suspendOrder clear the bucket on
// the way out, and every bucket READER must carry the same gate so a stale
// bucket (legacy rows, direct writes) can never resurface a frozen order in
// a queue, a KPI or the bell.
export const BUCKET_CLOCK_STATUSES: OrderStatus[] = ['ACTIVE', 'EXPIRED'];

// The one where-shape for reading a bucket queue: dashboard KPIs/strip, the
// Renewals tabs and the admin bell all count with THIS, so every counter
// equals the list it links to (coherent-signals rule).
export function bucketQueueWhere(bucket: RenewalBucket): { renewalBucket: RenewalBucket; status: { in: OrderStatus[] } } {
  return { renewalBucket: bucket, status: { in: BUCKET_CLOCK_STATUSES } };
}

// ── Live pre-expiry windows (phase 4) ───────────────────────────────────────
// The 24h/3d/7d queues read LIVE: a pure expiresAt range needs no per-client
// data, so the Renewals tabs, the dashboard KPI/strip and the row chips all
// share the display layer's exact boundaries with ZERO sweep lag (the bucket
// column lags up to one 5-min tick). grace/expired deliberately stay
// materialized (bucketQueueWhere): their boundary is per-client — the grace
// override → tier → settings cascade — which is exactly what the sweep's
// classification exists to bake into a queryable column; their lag is ≤ one
// tick and the phase-3 status gate already hides frozen rows.
// Accepted transient from this split: an order that crossed its expiry leaves
// the live window immediately but only enters the materialized grace queue at
// the next sweep tick, so for ≤5 min it sits on neither Renewals tab (its
// detail chip still shows "In grace" — orderTimeSignal is live). This is the
// same ≤one-tick grace lag above, self-heals, and expressing grace live would
// mean the per-client cascade in SQL — the reason it stays materialized.
// Boundaries mirror orderTimeSignal: (now, now+24h], (now+24h, now+72h],
// (now+72h, now+168h] — an order expiring at the exact instant `now` is not
// "expiring", it is already in grace (display agrees). ACTIVE only: EXPIRED
// cannot carry a future expiry, and a sweep-lagged ACTIVE-past-expiry row
// belongs to grace, not to a window.
export type LiveWindow = '24h' | '3d' | '7d';

export function liveWindowWhere(win: LiveWindow, nowMs: number): {
  status: OrderStatus; expiresAt: { gt: Date; lte: Date };
} {
  const [fromH, toH] = win === '24h' ? [0, 24] : win === '3d' ? [24, 72] : [72, 168];
  return {
    status: 'ACTIVE',
    expiresAt: { gt: new Date(nowMs + fromH * 3_600_000), lte: new Date(nowMs + toH * 3_600_000) },
  };
}

// RENEWED is a sticky MARKER, not a clock window, so its queue is wider than
// the clock gate (review find): a paid renewal that hit a short pool sits in
// PROVISIONING with expiresAt null (reprovisionRenewedOrder's clock-held
// state) and renewalBucket RENEWED — exactly the row the Renewal-paid tab
// exists to surface for manual Assign. Frozen/terminal statuses stay out.
export const RENEWED_QUEUE_STATUSES: OrderStatus[] = ['ACTIVE', 'EXPIRED', 'PROVISIONING'];

// Renewal-paid queue where-shape. Takes `now` because phase 4 made the
// pre-expiry tabs LIVE while this one stays on the materialized sticky: a
// RENEWED order whose expiry has aged back into the live ≤7d horizon already
// shows on its live-window tab, so it must be EXCLUDED here or it double-lists
// until the next sweep re-buckets it (review find — one row, one tab). The
// exclusion only bites ACTIVE rows with a future ≤7d expiry; the sticky's real
// homes — >7d out, or the clock-held PROVISIONING/EXPIRED states (null / past
// expiry, not in the range) — are untouched.
export function renewedQueueWhere(nowMs: number): {
  renewalBucket: RenewalBucket; status: { in: OrderStatus[] }; NOT: { status: OrderStatus; expiresAt: { gt: Date; lte: Date } };
} {
  return {
    renewalBucket: 'RENEWED',
    status: { in: RENEWED_QUEUE_STATUSES },
    NOT: { status: 'ACTIVE', expiresAt: { gt: new Date(nowMs), lte: new Date(nowMs + 168 * 3_600_000) } },
  };
}

// The sweep's bucket classifier (moved here from sweep.ts in phase 3 so the
// queue taxonomy lives beside the display taxonomy above — one set of
// boundaries, two consumers). Returns the bucket an order belongs to at
// `now`, or null when its clock is quiet (no expiry, or >7d out without a
// sticky RENEWED marker).
export function targetBucket(
  order: { expiresAt: Date | null; renewalBucket: RenewalBucket | null; graceHours: number },
  now: number,
): RenewalBucket | null {
  if (!order.expiresAt) return null;
  const msLeft = order.expiresAt.getTime() - now;
  if (msLeft <= 0) {
    // NB: strict `<` at the grace end (the sweep's historical boundary),
    // while the display layer above counts the exact instant as still-grace
    // (`<=`, matching isPastGrace). The two disagree for that one instant
    // only — harmless (the queue re-buckets on the next tick, the chip is
    // live) and pinned by the test suite so a real drift can't hide in it.
    return now < order.expiresAt.getTime() + order.graceHours * 3_600_000 ? 'GRACE' : 'EXPIRED';
  }
  const hoursLeft = msLeft / 3_600_000;
  if (hoursLeft <= 24) return 'H24';
  if (hoursLeft <= 72) return 'D3';
  if (hoursLeft <= 168) return 'D7';
  // Beyond 7 days out: keep "Renewal paid" visible on the renewals board
  return order.renewalBucket === 'RENEWED' ? 'RENEWED' : null;
}

// Serializable chip form (phase 2): the RSC pages compute the signal and hand
// the client-side tables this plain object — Dates flattened into the ready
// tooltip string, so every surface words the boundary identically ("until X"
// for a future deadline, "grace ended X" for a passed one — see untilPassed).
export type OrderSignalChip = {
  label: string;
  tone: OrderTimeSignal['tone'];
  href: string;
  tip: string | null;
};

export function timeSignalChip(sig: OrderTimeSignal | null): OrderSignalChip | null {
  if (!sig) return null;
  return {
    label: sig.label,
    tone: sig.tone,
    href: sig.href,
    tip: sig.until ? `${sig.untilPassed ? 'grace ended' : 'until'} ${fmtAdminStamp(sig.until)}` : null,
  };
}

// Short human duration for "time left" copy: '45m', '5h', '2d 4h', '12d'.
// Floors at '<1m' for a boundary about to pass; never returns a negative.
export function msToShort(ms: number): string {
  if (ms < 60_000) return '<1m';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 7) return `${days}d`;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
