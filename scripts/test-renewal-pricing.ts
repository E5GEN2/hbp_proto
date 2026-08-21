// Standalone assertion test for renewal pricing with per-order discounts (no
// test runner in the repo — same pattern as test-new-order.ts).
// Run: pnpm exec tsx scripts/test-renewal-pricing.ts
import {
  renewalUnitPrice,
  renewalPricing,
  orderRenewalDiscountActive,
  renewalDiscountDecrement,
} from '../src/lib/renewal';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

const ord = (over: Partial<{ qty: number; renewalDiscountValue: number | null; renewalDiscountIsPercent: boolean | null; renewalDiscountCyclesLeft: number | null }> = {}) => ({
  qty: 1, renewalDiscountValue: null, renewalDiscountIsPercent: null, renewalDiscountCyclesLeft: null, ...over,
});

// ---------- renewalUnitPrice (unchanged contract) ----------
eq('no plan discount', renewalUnitPrice(55, 0), 55);
eq('plan 15%', renewalUnitPrice(55, 15), 46.75);
eq('null pct', renewalUnitPrice(55, null), 55);

// ---------- orderRenewalDiscountActive ----------
eq('absent → inactive', orderRenewalDiscountActive(ord()), false);
eq('indefinite → active', orderRenewalDiscountActive(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: null })), true);
eq('cycles 2 → active', orderRenewalDiscountActive(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: 2 })), true);
eq('cycles 0 → exhausted', orderRenewalDiscountActive(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: 0 })), false);

// ---------- renewalPricing ----------
const plan = { price: 55, renewalDiscountPct: 0 };
const planDisc = { price: 55, renewalDiscountPct: 15 };

eq('no discounts', renewalPricing(plan, ord({ qty: 2 })), { unit: 55, total: 110, source: 'none', label: '' });
eq('plan discount only', renewalPricing(planDisc, ord({ qty: 2 })), { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('order % replaces plan', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 50, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: null })),
  { unit: 27.5, total: 55, source: 'order', label: '−50%' });
eq('order $ off total', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 10, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: 3 })),
  { unit: 50, total: 100, source: 'order', label: '−$10.00' });
eq('order $ > total floors at 0', renewalPricing(plan, ord({ qty: 1, renewalDiscountValue: 100, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: 1 })),
  { unit: 0, total: 0, source: 'order', label: '−$100.00' });
eq('exhausted order discount → plan applies', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 50, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: 0 })),
  { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('order 100% → $0', renewalPricing(plan, ord({ qty: 3, renewalDiscountValue: 100, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: null })),
  { unit: 0, total: 0, source: 'order', label: '−100%' });
// Decimal-ish inputs (Prisma Decimal arrives as object; Number() path)
eq('string price coerces', renewalPricing({ price: '19.99' as unknown, renewalDiscountPct: 0 }, ord({ qty: 3 })), { unit: 19.99, total: 59.97, source: 'none', label: '' });
eq('cent rounding on $ discount', renewalPricing(plan, ord({ qty: 3, renewalDiscountValue: 0.01, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: null })),
  { unit: 55, total: 164.99, source: 'order', label: '−$0.01' });

// ---------- renewalDiscountDecrement ----------
eq('absent → no write', renewalDiscountDecrement(ord()), {});
eq('indefinite → no write', renewalDiscountDecrement(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: null })), {});
eq('cycles 3 → 2', renewalDiscountDecrement(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: 3 })), { renewalDiscountCyclesLeft: 2 });
eq('cycles 1 → 0 (one-time consumed)', renewalDiscountDecrement(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: 1 })), { renewalDiscountCyclesLeft: 0 });
eq('cycles 0 → no write (never negative)', renewalDiscountDecrement(ord({ renewalDiscountValue: 10, renewalDiscountCyclesLeft: 0 })), {});

console.log(`\nrenewal pricing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
