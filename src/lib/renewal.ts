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
