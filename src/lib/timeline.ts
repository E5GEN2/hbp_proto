// Newest-first ordering for synthesized activity feeds (dashboard, order
// detail). The latest event must always sit on top, and two orders' feeds must
// read in the same direction.
//
// Why a plain `at`-descending sort isn't enough: the lifecycle events of a
// single order are created inside ONE checkout/provision transaction and get
// near-identical timestamps whose sub-second order does NOT match the logical
// lifecycle. In production we observed an order whose `activatedAt` and payment
// `confirmedAt` were stamped ~13ms *before* its own `createdAt`, so a pure
// timestamp sort floated "Order placed" to the top and buried "Provisioned" at
// the bottom — the whole feed read oldest→newest, while a sibling order (whose
// later "awaiting fulfillment" event carried a genuinely later timestamp) read
// newest→oldest. Same page, opposite directions.
//
// Fix: bucket events by whole second, then break ties by lifecycle stage so the
// latest stage wins. Same-transaction jitter (tens of ms) collapses into one
// bucket and is ordered logically; genuinely-later events (a renewal weeks on,
// a fulfillment 30 min later) land in a newer bucket and are ordered by time.
// The comparator is a total order (bucket → stage → exact ms, each strict), so
// the result is deterministic on every render.

// Lifecycle stage ranks — higher = later in an order's life = higher in the
// feed when two events share a second. Gaps leave room for future stages.
export const LIFECYCLE = {
  placed: 10,
  awaiting: 20,
  failed: 25,
  paid: 30,
  fulfilling: 35,
  provisioned: 40,
  alert: 50,
  refunded: 60,
  cancelled: 70,
} as const;

export type TimelineEvent = { at: Date; seq: number };

export function byRecency(a: TimelineEvent, b: TimelineEvent): number {
  const secA = Math.floor(a.at.getTime() / 1000);
  const secB = Math.floor(b.at.getTime() / 1000);
  if (secA !== secB) return secB - secA; // newest whole-second first
  if (a.seq !== b.seq) return b.seq - a.seq; // same second → latest lifecycle stage first
  return b.at.getTime() - a.at.getTime(); // final deterministic tiebreak
}
