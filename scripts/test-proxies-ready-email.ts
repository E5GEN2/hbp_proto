// Standalone assertion test for the proxies-ready delivery notice (no test
// runner in the repo — same pattern as test-grace.ts / test-crypto-window.ts).
// Run: pnpm exec tsx scripts/test-proxies-ready-email.ts
import { proxiesReadyEmail } from '../src/lib/email';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); }
}
function eq(label: string, got: unknown, want: unknown) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

// ── First activation ────────────────────────────────────────────────────────
const first = proxiesReadyEmail('ORD-40041', 3, false);
eq('activation subject', first.subject, 'Your proxies are ready — order ORD-40041');
ok('activation html names the order', first.html.includes('ORD-40041'));
ok('activation html says live', first.html.includes('3 mobile proxies are now live'));
ok('activation html points at credentials', first.html.includes('Assigned Proxies'));
ok('activation text mirrors the variant', first.text.includes('3 mobile proxies are live on order ORD-40041'));

// ── Restore after a reopened deficit ────────────────────────────────────────
const back = proxiesReadyEmail('ORD-40041', 3, true);
eq('restore subject', back.subject, 'Proxies restored — order ORD-40041');
ok('restore html says back to full', back.html.includes('back to its full 3 mobile proxies'));
ok('restore text says back to full', back.text.includes('back to its full 3 mobile proxies'));
ok('the two variants are distinct', back.subject !== first.subject && back.html !== first.html);

// ── Singular / plural agreement (qty comes straight from the order) ─────────
const one = proxiesReadyEmail('ORD-10848', 1, false);
ok('singular noun', one.html.includes('1 mobile proxy is now live'));
ok('singular in text too', one.text.includes('1 mobile proxy is live'));
ok('plural at 2', proxiesReadyEmail('ORD-10848', 2, false).html.includes('2 mobile proxies are now live'));
ok('singular restore', proxiesReadyEmail('ORD-10848', 1, true).html.includes('full 1 mobile proxy'));

// ── Every variant links to the order and renders no placeholder holes ───────
for (const [label, m] of [['activation', first], ['restore', back], ['singular', one]] as const) {
  ok(`${label}: html links to the order page`, m.html.includes('/orders/ORD-'));
  ok(`${label}: text links to the order page`, m.text.includes('/orders/ORD-'));
  ok(`${label}: no undefined/NaN leaked`, !/undefined|NaN/.test(m.html + m.text + m.subject));
}

console.log(`\nproxies-ready email: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
