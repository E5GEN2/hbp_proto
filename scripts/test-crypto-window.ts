// Standalone assertion test for the crypto-window policy (no test runner in the
// repo). Run: pnpm exec tsx scripts/test-crypto-window.ts
import {
  transferDetected, serverWindowClosed, localWindowPassed, showWindowCountdown, statusLine, fmtLeft,
  classifyIpn, isResurrectable, resolveIpnAction, type PaymentPhase, type IpnAction, type IpnSnapshot, type IpnVerdict,
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
// Long floating-rate windows (~7d) carry no urgency — no countdown theater.
eq('no countdown for a 7-day window', showWindowCountdown(null, 7 * 24 * 60 * MIN), false);
eq('no countdown just above the 2h threshold', showWindowCountdown('waiting', 2 * 60 * MIN + 1000), false);
eq('countdown at exactly the 2h threshold', showWindowCountdown(null, 2 * 60 * MIN), true);
eq('countdown for a 90-min window', showWindowCountdown(null, 90 * MIN), true);

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
// Hours roll out separately — the countdown can start at the 2h ceiling now.
eq('fmt 2h → 2:00:00 (not 120:00)', fmtLeft(2 * 60 * MIN), '2:00:00');
eq('fmt 90 min → 1:30:00', fmtLeft(90 * MIN), '1:30:00');
eq('fmt 59:59 stays mm:ss', fmtLeft(59 * MIN + 59_000), '59:59');

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

// ── resolveIpnAction — IPN = trigger, API = truth (incident 2026-10-21) ────
const snap = (status: string, fundsArrived = false): IpnSnapshot => ({ status, fundsArrived });
const V = (action: IpnAction, source: 'ipn' | 'api', mismatch = false, unverified = false): IpnVerdict => ({ action, source, mismatch, unverified });
const vcases: [string, IpnSnapshot, IpnSnapshot | null, PaymentPhase, IpnVerdict][] = [
  ['forged finished, API still waiting → nothing settles, mismatch', snap('finished', true), snap('waiting'), 'AWAITING', V('noop', 'api', true)],
  ['real finished, API finished → settle', snap('finished', true), snap('finished', true), 'AWAITING', V('settle', 'api')],
  ['finished but API unreachable → unverified, no action', snap('finished', true), null, 'AWAITING', V('noop', 'ipn', false, true)],
  ['waiting is informational → no API needed', snap('waiting'), null, 'AWAITING', V('noop', 'ipn')],
  ['confirming is informational → no API needed', snap('confirming'), null, 'AWAITING', V('noop', 'ipn')],
  ['expired without funds (open cart) is informational → no API needed', snap('expired'), null, 'AWAITING', V('noop', 'ipn')],
  ['forged failed, API waiting → nothing fails, mismatch', snap('failed'), snap('waiting'), 'AWAITING', V('noop', 'api', true)],
  ['IPN failed but API already finished → settle (API wins), mismatch noted', snap('failed'), snap('finished', true), 'AWAITING', V('settle', 'api', true)],
  ['partially_paid confirmed by API → underpaid alert', snap('partially_paid', true), snap('partially_paid', true), 'AWAITING', V('underpaid_alert', 'api')],
  ['forged partially_paid, API waiting → no alert, mismatch', snap('partially_paid', true), snap('waiting'), 'AWAITING', V('noop', 'api', true)],
  ['expired with funds per API on AWAITING → manual review', snap('expired', true), snap('expired', true), 'AWAITING', V('manual_review', 'api')],
  ['refunded confirmed by API → fail', snap('refunded'), snap('refunded'), 'AWAITING', V('fail', 'api')],
  ['finished on a CONFIRMED row still routes to settle (idempotent downstream)', snap('finished', true), snap('finished', true), 'CONFIRMED', V('settle', 'api')],
  ['finished, API unavailable, row CONFIRMED → still unverified', snap('finished', true), null, 'CONFIRMED', V('noop', 'ipn', false, true)],
  ['IPN says finished with funds, API says finished WITHOUT funds field → still settle (status rules)', snap('finished', true), snap('finished'), 'AWAITING', V('settle', 'api')],
  // The record decides even for an informational IPN (the API may be ahead)
  ['IPN confirming but API already finished → settle (API ahead), stale not suspicious', snap('confirming'), snap('finished', true), 'AWAITING', V('settle', 'api', true)],
  ['IPN waiting, API waiting → noop, no mismatch', snap('waiting'), snap('waiting'), 'AWAITING', V('noop', 'api')],
  ['IPN confirming, API waiting → both informational → no mismatch', snap('confirming'), snap('waiting'), 'AWAITING', V('noop', 'api')],
  ['IPN expired (open cart), API expired with funds → manual review (API ahead)', snap('expired'), snap('expired', true), 'AWAITING', V('manual_review', 'api', true)],
];
for (const [label, ipn, api, before, want] of vcases) eq(`resolveIpnAction: ${label}`, resolveIpnAction(ipn, api, before), want);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
