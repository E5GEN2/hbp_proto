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
