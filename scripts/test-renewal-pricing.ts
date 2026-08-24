// Standalone assertion test for renewal pricing with per-order discounts (no
// test runner in the repo — same pattern as test-new-order.ts).
// Run: pnpm exec tsx scripts/test-renewal-pricing.ts
import {
  renewalUnitPrice,
  renewalPricing,
  orderRenewalDiscountActive,
  consumeRenewalDiscountCycle,
  effectiveRenewalPct,
  purchaseUnitPrice,
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

eq('no discounts', renewalPricing(plan, ord({ qty: 2 }), null), { unit: 55, total: 110, source: 'none', label: '' });
eq('plan discount only', renewalPricing(planDisc, ord({ qty: 2 }), null), { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('order % replaces plan', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 50, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: null }), null),
  { unit: 27.5, total: 55, source: 'order', label: '−50%' });
eq('order $ off total', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 10, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: 3 }), null),
  { unit: 50, total: 100, source: 'order', label: '−$10.00' });
eq('order $ > total floors at 0', renewalPricing(plan, ord({ qty: 1, renewalDiscountValue: 100, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: 1 }), null),
  { unit: 0, total: 0, source: 'order', label: '−$100.00' });
eq('exhausted order discount → plan applies', renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 50, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: 0 }), null),
  { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('order 100% → $0', renewalPricing(plan, ord({ qty: 3, renewalDiscountValue: 100, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: null }), null),
  { unit: 0, total: 0, source: 'order', label: '−100%' });
// Decimal-ish inputs (Prisma Decimal arrives as object; Number() path)
eq('string price coerces', renewalPricing({ price: '19.99' as unknown, renewalDiscountPct: 0 }, ord({ qty: 3 }), null), { unit: 19.99, total: 59.97, source: 'none', label: '' });
eq('cent rounding on $ discount', renewalPricing(plan, ord({ qty: 3, renewalDiscountValue: 0.01, renewalDiscountIsPercent: false, renewalDiscountCyclesLeft: null }), null),
  { unit: 55, total: 164.99, source: 'order', label: '−$0.01' });

// ---------- client-level discount (owner decisions 2026-08-22) ----------
// Never stacks with the plan discount — the LARGER of the two applies; an
// ACTIVE per-order grant beats both (even when numerically smaller); an
// exhausted grant falls back to max(client, plan).
const cli = (pct: number | null) => ({ clientDiscountPct: pct });

eq('client beats smaller plan (20 vs 15)', renewalPricing(planDisc, ord({ qty: 2 }), cli(20)),
  { unit: 44, total: 88, source: 'client', label: '−20%' });
eq('plan beats smaller client (15 vs 10)', renewalPricing(planDisc, ord({ qty: 2 }), cli(10)),
  { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('tie goes to plan (15 vs 15)', renewalPricing(planDisc, ord({ qty: 2 }), cli(15)),
  { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('client only (plan 0)', renewalPricing(plan, ord({ qty: 2 }), cli(10)),
  { unit: 49.5, total: 99, source: 'client', label: '−10%' });
eq('client null → plan as before', renewalPricing(planDisc, ord({ qty: 2 }), cli(null)),
  { unit: 46.75, total: 93.5, source: 'plan', label: '−15%' });
eq('active order grant beats larger client (5% vs 50%)',
  renewalPricing(plan, ord({ qty: 2, renewalDiscountValue: 5, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: 1 }), cli(50)),
  { unit: 52.25, total: 104.5, source: 'order', label: '−5%' });
eq('exhausted order grant → max(client, plan) resumes',
  renewalPricing(planDisc, ord({ qty: 2, renewalDiscountValue: 50, renewalDiscountIsPercent: true, renewalDiscountCyclesLeft: 0 }), cli(20)),
  { unit: 44, total: 88, source: 'client', label: '−20%' });

// ---------- effectiveRenewalPct (the max rule itself) ----------
eq('max(plan, client)', effectiveRenewalPct(15, 20), 20);
eq('max handles nulls', effectiveRenewalPct(null, null), 0);
eq('max plan wins', effectiveRenewalPct(15, 10), 15);

// ---------- purchaseUnitPrice (new purchases — client discount only) ----------
eq('purchase no discount', purchaseUnitPrice(55, null), 55);
eq('purchase 20% of 55', purchaseUnitPrice(55, 20), 44);
eq('purchase 15% of 19.99 rounds to cent', purchaseUnitPrice(19.99, 15), 16.99);
eq('purchase 100% → $0', purchaseUnitPrice(55, 100), 0);

// ---------- consumeRenewalDiscountCycle (SQL shape via a fake tx) ----------
// The guard lives in the WHERE (cyclesLeft > 0 excludes NULL/0 — can't go
// negative, can't clobber a concurrent re-grant); assert the exact call shape.
async function main() {
  const calls: unknown[] = [];
  const fakeTx = { order: { updateMany: async (args: unknown) => { calls.push(args); return {}; } } };
  await consumeRenewalDiscountCycle(fakeTx as never, 'ORD-1');
  eq('consume issues one guarded atomic decrement', calls, [{
    where: { id: 'ORD-1', renewalDiscountCyclesLeft: { gt: 0 } },
    data: { renewalDiscountCyclesLeft: { decrement: 1 } },
  }]);

  console.log(`\nrenewal pricing: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
