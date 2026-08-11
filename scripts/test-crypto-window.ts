// Standalone assertion test for the crypto-window policy (no test runner in the
// repo). Run: pnpm exec tsx scripts/test-crypto-window.ts
import {
  transferDetected, serverWindowClosed, localWindowPassed, showWindowCountdown, statusLine, fmtLeft,
  classifyIpn, isResurrectable, type PaymentPhase, type IpnAction,
} from '../src/lib/crypto-window';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

const MIN = 60_000;

// ── serverWindowClosed (ONLY signal allowed to REPLACE the pay view) ───────
eq('fresh charge → not server-closed', serverWindowClosed(null), false);
eq('waiting → not server-closed', serverWindowClosed('waiting'), false);
eq('mirrored expired → server-closed', serverWindowClosed('expired'), true);
eq('mirrored failed → server-closed', serverWindowClosed('failed'), true);
eq('transfer detected overrides → not server-closed', serverWindowClosed('confirming'), false);
eq('partially_paid = detected → not server-closed', serverWindowClosed('partially_paid'), false);

// ── localWindowPassed (inline hint only — NEVER hides the address; audit C15)
eq('fresh clock positive → not passed', localWindowPassed(null, 9 * MIN), false);
eq('clock hit 0, no server signal → passed (address stays up)', localWindowPassed(null, 0), true);
eq('clock negative (fast client clock) → passed, NOT hidden', localWindowPassed('waiting', -5000), true);
eq('server already says expired → NOT localPassed (full view takes over)', localWindowPassed('expired', -5000), false);
eq('transfer detected overrides a lapsed clock → not passed', localWindowPassed('confirming', -5000), false);
eq('no expiry known (legacy) → never passed', localWindowPassed(null, null), false);

// ── showWindowCountdown (every coin, incl. stablecoins) ───────────────────
eq('countdown while live+waiting', showWindowCountdown(null, 8 * MIN), true);
eq('countdown while npStatus waiting', showWindowCountdown('waiting', 8 * MIN), true);
eq('no countdown once detected', showWindowCountdown('confirming', 8 * MIN), false);
eq('no countdown after expired', showWindowCountdown('expired', 8 * MIN), false);
eq('no countdown when clock at 0', showWindowCountdown(null, 0), false);
eq('no countdown when no expiry', showWindowCountdown(null, null), false);

// ── transferDetected ──────────────────────────────────────────────────────
for (const s of ['confirming', 'confirmed', 'sending', 'partially_paid']) eq(`detected: ${s}`, transferDetected(s), true);
for (const s of [null, 'waiting', 'expired', 'failed', 'finished']) eq(`not detected: ${s}`, transferDetected(s), false);

// ── statusLine ────────────────────────────────────────────────────────────
eq('statusLine waiting default', statusLine(null).text, 'Waiting for your transfer…');
eq('statusLine confirming', statusLine('confirming').text.startsWith('Payment detected'), true);
eq('statusLine partial warns', statusLine('partially_paid').warn, true);

// ── fmtLeft ───────────────────────────────────────────────────────────────
eq('fmt 10:00', fmtLeft(10 * MIN), '10:00');
eq('fmt 0:09', fmtLeft(9000), '0:09');
eq('fmt clamps negative', fmtLeft(-5000), '0:00');

// ── classifyIpn — the money policy table ──────────────────────────────────
type Case = [string, string, boolean, PaymentPhase, IpnAction];
const cases: Case[] = [
  // finished always settles (resurrect handled by settle itself)
  ['finished from awaiting', 'finished', false, 'AWAITING', 'settle'],
  ['finished from failed (late pay)', 'finished', true, 'FAILED', 'settle'],
  ['finished on manual_review', 'finished', true, 'MANUAL_REVIEW', 'settle'],
  // expired, NO funds → open cart, do nothing (the incident fix)
  ['expired no funds from awaiting → noop', 'expired', false, 'AWAITING', 'noop'],
  // expired WITH funds → manual review, from any live-or-dead state
  ['expired+funds from awaiting → review', 'expired', true, 'AWAITING', 'manual_review'],
  ['expired+funds from failed (10-min kill then paid) → review', 'expired', true, 'FAILED', 'manual_review'],
  ['expired+funds from cancelled (72h then paid) → review', 'expired', true, 'CANCELLED', 'manual_review'],
  // failed (a REAL NP failure, not the timing expiry) with no funds → fail
  ['failed no funds → fail', 'failed', false, 'AWAITING', 'fail'],
  ['failed+funds → review', 'failed', true, 'AWAITING', 'manual_review'],
  // refunded never parks as review (funds went back), always fail path
  ['refunded+funds → fail (not review)', 'refunded', true, 'AWAITING', 'fail'],
  ['refunded no funds → fail', 'refunded', false, 'AWAITING', 'fail'],
  // partially_paid: live charge alerts; dead charge parks
  ['partial on awaiting → underpaid alert', 'partially_paid', true, 'AWAITING', 'underpaid_alert'],
  ['partial on failed → review', 'partially_paid', true, 'FAILED', 'manual_review'],
  ['partial on cancelled → review', 'partially_paid', true, 'CANCELLED', 'manual_review'],
  // intermediate statuses do nothing
  ['confirming → noop', 'confirming', false, 'AWAITING', 'noop'],
  ['sending → noop', 'sending', false, 'AWAITING', 'noop'],
];
for (const [label, status, funds, before, want] of cases) eq(`classifyIpn: ${label}`, classifyIpn(status, funds, before), want);

// ── isResurrectable — which dead statuses a `finished` may still revive ────
// The NP address stays payable ~7d and there is no cancel API, so every
// locally-dead label can still receive real money.
eq('FAILED resurrectable (window lapsed, paid late)', isResurrectable('FAILED'), true);
eq('MANUAL_REVIEW resurrectable (parked, then fully paid)', isResurrectable('MANUAL_REVIEW'), true);
eq('CANCELLED resurrectable (client cancelled, funds already sent)', isResurrectable('CANCELLED'), true);
eq('CONFIRMED NOT resurrectable (would double-credit)', isResurrectable('CONFIRMED'), false);
eq('AWAITING NOT "resurrect" (that is the normal settle path)', isResurrectable('AWAITING'), false);
eq('REFUNDED NOT resurrectable', isResurrectable('REFUNDED'), false);
eq('null status NOT resurrectable', isResurrectable(null), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
