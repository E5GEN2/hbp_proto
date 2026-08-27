// Standalone assertion test for split-payment math (no test runner in the repo,
// same pattern as test-renewal-pricing.ts). Run: pnpm exec tsx scripts/test-split-payment.ts
import { splitTopupAmount, splitFromBalance } from '../src/lib/split-payment';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

const MIN = 10;

// ── splitTopupAmount: shortfall, floored at the crypto minimum ──
eq('shortfall above the floor is charged exactly', splitTopupAmount(50, 20, MIN), 30);
eq('shortfall == floor', splitTopupAmount(30, 20, MIN), 10);
eq('shortfall BELOW floor → charge the floor', splitTopupAmount(25, 20, MIN), 10); // shortfall 5 → 10
eq('tiny shortfall on a big balance → floor', splitTopupAmount(100, 99, MIN), 10); // shortfall 1 → 10
eq('sub-minimum ORDER, partial balance → floor', splitTopupAmount(5, 2, MIN), 10); // total below $10 still works via top-up
eq('exact-cent shortfall', splitTopupAmount(19.99, 4.5, MIN), 15.49);
eq('cent rounding on shortfall', splitTopupAmount(9.5, 4.5, MIN), 10); // shortfall 5.00 → floor 10
eq('float dust killed', splitTopupAmount(0.3, 0.1, MIN), 10); // shortfall 0.2 → floor

// ── splitFromBalance: order part covered by the existing balance = total − topup ──
eq('from balance when top-up == shortfall', splitFromBalance(50, 30), 20); // balance covers 20, matches shortfall
eq('from balance when top-up overshoots the shortfall', splitFromBalance(25, 10), 15); // total 25, top-up 10 (floored) → balance covers 15
eq('sub-min order: balance covers total minus the floored top-up', splitFromBalance(5, 10), -5); // top-up 10 exceeds a $5 order → $5 leftover balance after (never negative charge; this is display arithmetic — order is fully covered, $5 stays)
eq('cent exactness', splitFromBalance(19.99, 15.49), 4.5);

// Invariant: fromBalance + topup === total (to the cent) for a normal split
// where the shortfall clears the floor.
for (const [total, balance] of [[50, 20], [19.99, 4.5], [100, 30]] as const) {
  const t = splitTopupAmount(total, balance, MIN);
  const fb = splitFromBalance(total, t);
  eq(`fromBalance + topup == total (${total}/${balance})`, Math.round((fb + t) * 100) / 100, total);
}

console.log(`\nsplit payment: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
