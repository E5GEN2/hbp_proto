// Renewal pricing (audit B-6): a plan's renewalDiscountPct applies whenever an
// existing order is EXTENDED (renewal via checkout, one-click balance renewal).
// Shared by the server charge paths AND the checkout UI so the displayed unit
// price always equals the charged one.

export function renewalUnitPrice(price: number, discountPct: number | null | undefined): number {
  const pct = discountPct ?? 0;
  if (pct <= 0) return price;
  // price × (100 − pct) is an integer number of cents when price has ≤2dp,
  // so this rounds exactly to the cent.
  return Math.round(price * (100 - pct)) / 100;
}

// The base date a renewal extends FROM (renewal-policy PR). Anchor on the
// order's ORIGINAL expiry so paying late within grace buys no bonus time and
// auto-renew keeps a stable renewal date (no drift from the sweep's tick
// latency). Fall back to `now` ONLY when a full term measured from that anchor
// would land entirely in the past — i.e. more than one whole period has elapsed
// since expiry (grace configured longer than the plan, or a sweep/app outage
// longer than one term). That guarantees `base + durationDays` is always in the
// future, so:
//   · a client never pays for a dead-on-arrival term, and
//   · auto-renew can never re-charge an order that would otherwise stay past-due
//     and re-trigger every sweep tick.
// NB: this is deliberately NOT `max(expiresAt, now)` — that would hand the grace
// days back as bonus time, the exact overcharge-of-days this PR removes. Here
// the anchor stays at expiresAt for the normal case (grace ≪ duration); `now`
// is used only in the degenerate "term already fully elapsed" case.
export function renewalBase(expiresAt: Date | null, durationDays: number, now: Date): Date {
  if (expiresAt && expiresAt.getTime() + durationDays * 86_400_000 > now.getTime()) return expiresAt;
  return now;
}
