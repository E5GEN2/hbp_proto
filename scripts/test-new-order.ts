// Standalone assertion test for the admin New Order policy (no test runner in
// the repo — same pattern as test-crypto-window.ts / test-grace.ts).
// Run: pnpm exec tsx scripts/test-new-order.ts
import {
  isInstantMethod,
  assertNewOrderBounds,
  resolveCustomExpiry,
  applyCustomExpiry,
  newOrderMoney,
  type NewOrderMethod,
} from '../src/lib/new-order-policy';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}
function throws(label: string, fn: () => unknown, msgPart?: string) {
  try { fn(); fail++; console.error(`✗ ${label} — expected throw, got none`); }
  catch (e: any) {
    if (msgPart && !String(e?.message).includes(msgPart)) {
      fail++; console.error(`✗ ${label} — threw, but message "${e?.message}" lacks "${msgPart}"`);
    } else pass++;
  }
}
function ok(label: string, fn: () => unknown) {
  try { fn(); pass++; } catch (e: any) { fail++; console.error(`✗ ${label} — unexpected throw: ${e?.message}`); }
}

const DAY = 86_400_000;
const now = new Date('2026-08-20T12:00:00Z');

// ---------- isInstantMethod ----------
eq('stripe is instant', isInstantMethod('stripe'), true);
eq('comp is instant', isInstantMethod('comp'), true);
eq('invoice is not instant', isInstantMethod('invoice'), false);
eq('crypto is not instant', isInstantMethod('crypto'), false);

// ---------- assertNewOrderBounds ----------
ok('qty 1 / discount 0 ok', () => assertNewOrderBounds(1, 0, 0, 55));
ok('qty 100 / discount 100 ok', () => assertNewOrderBounds(100, 100, 0, 55));
throws('qty 0 rejected', () => assertNewOrderBounds(0, 0, 0, 55), 'Quantity');
throws('qty 101 rejected', () => assertNewOrderBounds(101, 0, 0, 55), 'Quantity');
throws('qty 1.5 rejected', () => assertNewOrderBounds(1.5, 0, 0, 55), 'Quantity');
throws('qty NaN rejected', () => assertNewOrderBounds(NaN, 0, 0, 55), 'Quantity');
throws('discount -1 rejected', () => assertNewOrderBounds(1, -1, 0, 55), 'Discount');
throws('discount 101 rejected', () => assertNewOrderBounds(1, 101, 0, 55), 'Discount');
throws('discount 50.5 rejected', () => assertNewOrderBounds(1, 50.5, 0, 55), 'Discount');
throws('discount NaN rejected', () => assertNewOrderBounds(1, NaN, 0, 55), 'Discount');
// $ discount bounds
ok('usd discount within total ok', () => assertNewOrderBounds(2, 0, 100, 55));
ok('usd discount == total ok', () => assertNewOrderBounds(2, 0, 110, 55));
throws('usd discount > total rejected', () => assertNewOrderBounds(2, 0, 110.01, 55), 'exceed');
throws('negative usd rejected', () => assertNewOrderBounds(1, 0, -5, 55), '≥ $0');
throws('sub-cent usd rejected', () => assertNewOrderBounds(1, 0, 5.001, 55), 'whole cents');
throws('both pct and usd rejected', () => assertNewOrderBounds(1, 10, 5, 55), 'not both');
throws('usd NaN rejected', () => assertNewOrderBounds(1, 0, NaN, 55), '≥ \$0');

// ---------- resolveCustomExpiry ----------
eq('empty expiry → null', resolveCustomExpiry(null, 'stripe', 30, now), null);
eq('undefined expiry → null', resolveCustomExpiry(undefined, 'comp', 30, now), null);
eq("'' expiry → null", resolveCustomExpiry('', 'stripe', 30, now), null);

// Owner decision 2026-08-21: custom expiry is allowed for EVERY method — for
// non-instant it persists and applies at activation.
const in1d = new Date(now.getTime() + DAY);
eq('crypto + expiry accepted', resolveCustomExpiry(in1d.toISOString(), 'crypto', 30, now)?.getTime(), in1d.getTime());
eq('invoice + expiry accepted', resolveCustomExpiry(in1d.toISOString(), 'invoice', 30, now)?.getTime(), in1d.getTime());
throws('garbage date rejected', () => resolveCustomExpiry('not-a-date', 'stripe', 30, now), 'Invalid');
throws('past date rejected', () => resolveCustomExpiry(new Date(now.getTime() - DAY).toISOString(), 'stripe', 30, now), 'future');
throws('date == now rejected', () => resolveCustomExpiry(now.toISOString(), 'stripe', 30, now), 'future');
throws('date == plan end rejected (strictly less)', () => resolveCustomExpiry(new Date(now.getTime() + 30 * DAY).toISOString(), 'stripe', 30, now), 'within the plan term');
throws('date past plan end rejected', () => resolveCustomExpiry(new Date(now.getTime() + 31 * DAY).toISOString(), 'comp', 30, now), 'within the plan term');

const in7d = new Date(now.getTime() + 7 * DAY);
eq('7d into a 30d plan accepted (stripe)', resolveCustomExpiry(in7d.toISOString(), 'stripe', 30, now)?.getTime(), in7d.getTime());
const oneMinShort = new Date(now.getTime() + 30 * DAY - 60_000);
eq('plan end − 1min accepted (comp)', resolveCustomExpiry(oneMinShort.toISOString(), 'comp', 30, now)?.getTime(), oneMinShort.getTime());
const oneMs = new Date(now.getTime() + 1);
eq('now + 1ms accepted', resolveCustomExpiry(oneMs.toISOString(), 'stripe', 30, now)?.getTime(), oneMs.getTime());

// ---------- newOrderMoney ----------
eq('plain stripe, no discount', newOrderMoney(55, 0, 0, 1, 'stripe'), { unitPrice: 55, total: 55, fees: 1.65, net: 53.35 });
eq('stripe qty 3 fee rounds to cents', newOrderMoney(19, 0, 0, 3, 'stripe'), { unitPrice: 19, total: 57, fees: 1.71, net: 55.29 });
eq('discount rounds unit price to cents', newOrderMoney(9.99, 33, 0, 3, 'stripe'), { unitPrice: 6.69, total: 20.07, fees: 0.6, net: 19.47 });
eq('invoice books no fee', newOrderMoney(55, 10, 0, 2, 'invoice'), { unitPrice: 49.5, total: 99, fees: 0, net: 99 });
eq('crypto books no fee', newOrderMoney(55, 0, 0, 1, 'crypto'), { unitPrice: 55, total: 55, fees: 0, net: 55 });
eq('comp is $0 regardless of discount', newOrderMoney(55, 40, 0, 3, 'comp'), { unitPrice: 0, total: 0, fees: 0, net: 0 });
eq('100% discount → $0 (not negative)', newOrderMoney(55, 100, 0, 2, 'stripe'), { unitPrice: 0, total: 0, fees: 0, net: 0 });
eq('float dust killed: 0.1-style totals', newOrderMoney(10.35, 50, 0, 3, 'invoice'), { unitPrice: 5.18, total: 15.54, fees: 0, net: 15.54 });
// Half-cent boundary parity with the client self-serve family (renewal.ts):
// the old round2(price*(1-pct/100)) gave 1.42 here via float noise, one cent
// under what purchaseUnitPrice/renewalUnitPrice charge the same client
// self-serve. One pct → one price on every surface (adversarial review).
eq('half-cent boundary matches purchaseUnitPrice', newOrderMoney(1.9, 25, 0, 1, 'crypto'), { unitPrice: 1.43, total: 1.43, fees: 0, net: 1.43 });
eq('half-cent boundary qty>1', newOrderMoney(1.5, 15, 0, 2, 'invoice'), { unitPrice: 1.28, total: 2.56, fees: 0, net: 2.56 });
// $ discount: comes off the TOTAL; unit = total/qty cent-rounded
eq('usd discount off total', newOrderMoney(55, 0, 10, 2, 'invoice'), { unitPrice: 50, total: 100, fees: 0, net: 100 });
eq('usd discount == total → $0 floor', newOrderMoney(55, 0, 110, 2, 'invoice'), { unitPrice: 0, total: 0, fees: 0, net: 0 });
eq('usd discount unit drifts by cents but total exact', newOrderMoney(19, 0, 0.01, 3, 'invoice'), { unitPrice: 19, total: 56.99, fees: 0, net: 56.99 });
eq('usd discount + stripe fee', newOrderMoney(55, 0, 5, 1, 'stripe'), { unitPrice: 50, total: 50, fees: 1.5, net: 48.5 });
eq('comp is $0 regardless of usd discount', newOrderMoney(55, 0, 10, 1, 'comp'), { unitPrice: 0, total: 0, fees: 0, net: 0 });

// ---------- applyCustomExpiry ----------
const future = new Date(now.getTime() + 5 * DAY);
eq('no custom → full term', applyCustomExpiry(null, 30, now), { expiresAt: new Date(now.getTime() + 30 * DAY), usedCustom: false, stale: false });
eq('future custom → used', applyCustomExpiry(future, 30, now), { expiresAt: future, usedCustom: true, stale: false });
eq('past custom → stale fallback to full term', applyCustomExpiry(new Date(now.getTime() - DAY), 30, now), { expiresAt: new Date(now.getTime() + 30 * DAY), usedCustom: false, stale: true });
eq('custom == now → stale', applyCustomExpiry(now, 30, now), { expiresAt: new Date(now.getTime() + 30 * DAY), usedCustom: false, stale: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
