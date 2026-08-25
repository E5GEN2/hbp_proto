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

// Client-level discount (owner decision 2026-08-22): a per-client percent off
// ALL orders — new purchases and renewals ("special price for this client").
// Discounts never stack: when a plan renewal discount also applies, the LARGER
// of the two wins (an active per-order grant beats both — see renewalPricing).
export function effectiveRenewalPct(
  planPct: number | null | undefined,
  clientPct: number | null | undefined,
): number {
  return Math.max(planPct ?? 0, clientPct ?? 0);
}

// Unit price of a NEW purchase for a given client. New purchases carry no plan
// renewal discount, so the client discount is the only one that can apply —
// no max() needed here. Same exact-cent rounding as renewalUnitPrice.
export function purchaseUnitPrice(price: number, clientDiscountPct: number | null | undefined): number {
  return renewalUnitPrice(price, clientDiscountPct);
}

// Per-order renewal discount (owner decision 2026-08-21): an admin can grant a
// discount on a specific order's future PAID renewals — percent of the unit
// price or a flat $ off the total — limited to N cycles or indefinite.
// While ACTIVE it REPLACES the plan-level AND client-level discounts (never
// stacks — the most specific grant wins); exhausted (cyclesLeft === 0) or
// absent → max(client, plan) applies as before.
// This is the ONE pricing function for every renewal charge and display —
// audit B-6 rule: the shown price must always equal the charged one.
export type OrderRenewalDiscountFields = {
  qty: number;
  renewalDiscountValue: unknown; // Prisma Decimal | number | null
  renewalDiscountIsPercent: boolean | null;
  renewalDiscountCyclesLeft: number | null;
};

export function orderRenewalDiscountActive(o: {
  renewalDiscountValue: unknown; renewalDiscountCyclesLeft: number | null;
}): boolean {
  return o.renewalDiscountValue != null &&
    (o.renewalDiscountCyclesLeft === null || o.renewalDiscountCyclesLeft > 0);
}

export function renewalPricing(
  plan: { price: unknown; renewalDiscountPct: number | null },
  order: OrderRenewalDiscountFields,
  // The order's client — carrier of the client-level discount (owner decision
  // 2026-08-22). Required so no charge path can silently forget it; pass null
  // only where no client-level discount can exist.
  client: { clientDiscountPct: number | null } | null,
): {
  unit: number; total: number;
  source: 'order' | 'client' | 'plan' | 'none';
  // Human label for the discount line, e.g. "−15%" or "−$5.00" ('' when none)
  label: string;
} {
  const price = Number(plan.price);
  const round = (n: number) => Math.round(n * 100) / 100;
  if (orderRenewalDiscountActive(order)) {
    const v = Number(order.renewalDiscountValue);
    if (order.renewalDiscountIsPercent) {
      const unit = renewalUnitPrice(price, Math.min(100, Math.max(0, v)));
      return { unit, total: round(unit * order.qty), source: 'order', label: `−${v}%` };
    }
    // Flat $ off the TOTAL, floored at $0. unit is the effective per-proxy
    // price (display only — charges always use `total`).
    const total = Math.max(0, round(price * order.qty - v));
    return { unit: round(total / order.qty), total, source: 'order', label: `−$${v.toFixed(2)}` };
  }
  // No active per-order grant → the LARGER of client-level and plan discounts
  // (never their sum — owner decision). Tie goes to 'plan' (same money either
  // way; only the label's source differs).
  const planPct = plan.renewalDiscountPct ?? 0;
  const clientPct = client?.clientDiscountPct ?? 0;
  const pct = effectiveRenewalPct(planPct, clientPct);
  const unit = renewalUnitPrice(price, pct);
  return {
    unit, total: round(unit * order.qty),
    source: pct <= 0 ? 'none' : clientPct > planPct ? 'client' : 'plan',
    label: pct > 0 ? `−${pct}%` : '',
  };
}

// The exactly-once cycle consumption, called at every PAID renewal settle
// point (auto-renew, client one-click, checkout instant, crypto settle, admin
// MarkPaid renewal) — GATED by the caller on the charge-time snapshot
// (payment.renewalDiscountApplied / renewalPricing().source === 'order'):
// a cycle is consumed only for a charge the order discount actually priced
// (adversarial review R1 — a grant made while a full-price crypto charge was
// in flight must not be eaten by that charge's settle). Admin comp Extend
// never consumes a cycle (free grant, nothing was priced).
// Atomic guarded decrement: `WHERE cyclesLeft > 0` excludes NULL (indefinite)
// and 0 (exhausted) and can never go negative — and unlike an absolute write
// from a pre-tx snapshot it can't clobber a concurrent admin re-grant (R1).
export async function consumeRenewalDiscountCycle(
  tx: { order: { updateMany: (args: { where: { id: string; renewalDiscountCyclesLeft: { gt: number } }; data: { renewalDiscountCyclesLeft: { decrement: number } } }) => Promise<unknown> } },
  orderId: string,
): Promise<void> {
  await tx.order.updateMany({
    where: { id: orderId, renewalDiscountCyclesLeft: { gt: 0 } },
    data: { renewalDiscountCyclesLeft: { decrement: 1 } },
  });
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
