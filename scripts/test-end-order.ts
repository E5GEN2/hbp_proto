// Standalone assertion test for "End order now" (owner ask 2026-09-05,
// ORD-21399) — no test runner in the repo, same pattern as test-grace.ts.
// Pins the pure parts of src/lib/end-order.ts: the eligibility gate (shared by
// the server transition and the admin order page, so these boundaries are the
// contract for both), the write plan (auto-renew, duty clearing, client
// channels) and the portal bell copy.
// Run: pnpm exec tsx scripts/test-end-order.ts
import {
  endOrderNowGate, endOrderPlan, endOrderClientNotice, dutyDiedWithTerm,
  END_ORDER_NOW_STATUSES, END_ORDER_REASON_MAX, DUTY_EXCEPTIONS,
  type EndOrderNowGate,
} from '../src/lib/end-order';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}
function allowed(label: string, got: EndOrderNowGate) { eq(label, got.ok, true); }
function refused(label: string, got: EndOrderNowGate, needle: string) {
  eq(label, got.ok, false);
  eq(`${label} (reason mentions "${needle}")`, got.ok === false && got.reason.includes(needle), true);
}

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0); // fixed clock
const H = 3_600_000;
const at = (hours: number) => new Date(NOW + hours * H);

eq('eligible statuses are exactly ACTIVE / EXPIRED / SUSPENDED', END_ORDER_NOW_STATUSES, ['ACTIVE', 'EXPIRED', 'SUSPENDED']);
eq('reason cap is 500 (matches the dialog textarea)', END_ORDER_REASON_MAX, 500);

// ── status gate ──────────────────────────────────────────────────────────────
for (const s of ['NEW', 'AWAITING', 'PROVISIONING', 'CANCELLED', 'PENDING_RENEWAL'] as const) {
  refused(`${s} is never endable`, endOrderNowGate({ status: s, expiresAt: at(-1), liveAssignments: 1 }, NOW), 'Only a past-due');
}

// ── no term ──────────────────────────────────────────────────────────────────
refused('ACTIVE without expiry (never activated) → no term', endOrderNowGate({ status: 'ACTIVE', expiresAt: null, liveAssignments: 1 }, NOW), 'no term');
refused('SUSPENDED from PROVISIONING (expiry null) → no term', endOrderNowGate({ status: 'SUSPENDED', expiresAt: null, liveAssignments: 0 }, NOW), 'no term');

// ── past-due boundary: expiresAt <= now is due (sweep `lte` parity) ──────────
refused('ACTIVE 1ms before expiry → not past due (cancel instead)', endOrderNowGate({ status: 'ACTIVE', expiresAt: new Date(NOW + 1), liveAssignments: 1 }, NOW), 'not past due');
allowed('ACTIVE at the exact expiry instant → past due', endOrderNowGate({ status: 'ACTIVE', expiresAt: new Date(NOW), liveAssignments: 1 }, NOW));
allowed('EXPIRED at the exact expiry instant → past due', endOrderNowGate({ status: 'EXPIRED', expiresAt: new Date(NOW), liveAssignments: 1 }, NOW));
allowed('SUSPENDED at the exact expiry instant → past due', endOrderNowGate({ status: 'SUSPENDED', expiresAt: new Date(NOW), liveAssignments: 1 }, NOW));
allowed('ACTIVE 1ms past expiry → past due', endOrderNowGate({ status: 'ACTIVE', expiresAt: new Date(NOW - 1), liveAssignments: 1 }, NOW));
refused('SUSPENDED with a future expiry → not past due', endOrderNowGate({ status: 'SUSPENDED', expiresAt: at(24), liveAssignments: 1 }, NOW), 'not past due');
refused('EXPIRED with a future expiry (impossible row, still refused) → not past due', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(1), liveAssignments: 1 }, NOW), 'not past due');

// ── the three grace forms ────────────────────────────────────────────────────
allowed('grace form A: ACTIVE past due (auto-renew retrying) → endable', endOrderNowGate({ status: 'ACTIVE', expiresAt: at(-5), liveAssignments: 2 }, NOW));
allowed('grace form B: EXPIRED in grace, proxies bound → endable', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-5), liveAssignments: 1 }, NOW));
allowed('rescue: SUSPENDED past due, proxy bound (ORD-21399) → endable', endOrderNowGate({ status: 'SUSPENDED', expiresAt: at(-30), liveAssignments: 1 }, NOW));
allowed('ACTIVE past due with NO proxies (released earlier) → still endable (flips the status)', endOrderNowGate({ status: 'ACTIVE', expiresAt: at(-5), liveAssignments: 0 }, NOW));
allowed('SUSPENDED past due with NO proxies → still endable', endOrderNowGate({ status: 'SUSPENDED', expiresAt: at(-5), liveAssignments: 0 }, NOW));
allowed('EXPIRED past grace but proxies still held (autoRelease off) → endable', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-1000), liveAssignments: 1 }, NOW));

// ── nothing to end ───────────────────────────────────────────────────────────
refused('EXPIRED with proxies already released → already ended (button hidden)', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-100), liveAssignments: 0 }, NOW), 'Already ended');
refused('EXPIRED in grace but proxies already released → already ended', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-1), liveAssignments: 0 }, NOW), 'Already ended');

// ── money guard: a paid renewal the client never received ────────────────────
refused('RENEWAL_NOT_EXTENDED → refused, extend first', endOrderNowGate({ status: 'ACTIVE', expiresAt: at(-5), liveAssignments: 1, renewalNotExtended: true }, NOW), 'extend it');
refused('RENEWAL_NOT_EXTENDED on EXPIRED → refused too', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-5), liveAssignments: 1, renewalNotExtended: true }, NOW), 'extend it');
refused('RENEWAL_NOT_EXTENDED on SUSPENDED → refused too', endOrderNowGate({ status: 'SUSPENDED', expiresAt: at(-5), liveAssignments: 1, renewalNotExtended: true }, NOW), 'extend it');
allowed('renewalNotExtended=false is a no-op', endOrderNowGate({ status: 'ACTIVE', expiresAt: at(-5), liveAssignments: 1, renewalNotExtended: false }, NOW));

// ── precedence ───────────────────────────────────────────────────────────────
refused('status gate wins over everything', endOrderNowGate({ status: 'CANCELLED', expiresAt: null, liveAssignments: 0, renewalNotExtended: true }, NOW), 'Only a past-due');
refused('no-term wins over renewalNotExtended', endOrderNowGate({ status: 'ACTIVE', expiresAt: null, liveAssignments: 1, renewalNotExtended: true }, NOW), 'no term');
refused('no-term wins over already-ended (EXPIRED, null expiry, 0 live)', endOrderNowGate({ status: 'EXPIRED', expiresAt: null, liveAssignments: 0 }, NOW), 'no term');
refused('not-past-due wins over renewalNotExtended', endOrderNowGate({ status: 'ACTIVE', expiresAt: at(1), liveAssignments: 1, renewalNotExtended: true }, NOW), 'not past due');
refused('renewalNotExtended wins over already-ended', endOrderNowGate({ status: 'EXPIRED', expiresAt: at(-100), liveAssignments: 0, renewalNotExtended: true }, NOW), 'extend it');

// ── write plan: auto-renew preference, duty clearing, client channels ────────
eq('duty exceptions are exactly the three provisioning duties', DUTY_EXCEPTIONS, ['PAID_NOT_PROVISIONED', 'REPLACEMENT_PENDING', 'RENEWAL_FAULTY_PROXY']);
eq('plan: form A (ACTIVE + auto-renew) keeps the preference and emails the sweep\'s term-ended notice',
  endOrderPlan({ status: 'ACTIVE', autoRenew: true, autoRenewBeforeSuspend: null, exception: null }),
  { autoRenew: true, autoRenewRestored: false, clearDuty: false, emailMode: 'autoRenewExpired', rotationDuty: false });
eq('plan: ACTIVE without auto-renew → bell only',
  endOrderPlan({ status: 'ACTIVE', autoRenew: false, autoRenewBeforeSuspend: null, exception: null }),
  { autoRenew: false, autoRenewRestored: false, clearDuty: false, emailMode: null, rotationDuty: false });
eq('plan: form B (EXPIRED) keeps the preference, bell only (sweep 1b parity)',
  endOrderPlan({ status: 'EXPIRED', autoRenew: true, autoRenewBeforeSuspend: null, exception: null }),
  { autoRenew: true, autoRenewRestored: false, clearDuty: false, emailMode: null, rotationDuty: false });
eq('plan: rescue restores the parked preference (ORD-21399: autoRenew=false, parked=true) + incident email + rotation duty',
  endOrderPlan({ status: 'SUSPENDED', autoRenew: false, autoRenewBeforeSuspend: true, exception: null }),
  { autoRenew: true, autoRenewRestored: true, clearDuty: false, emailMode: 'incident', rotationDuty: true });
eq('plan: rescue with nothing parked → off',
  endOrderPlan({ status: 'SUSPENDED', autoRenew: false, autoRenewBeforeSuspend: null, exception: null }),
  { autoRenew: false, autoRenewRestored: false, clearDuty: false, emailMode: 'incident', rotationDuty: true });
eq('plan: rescue with parked=false → off',
  endOrderPlan({ status: 'SUSPENDED', autoRenew: false, autoRenewBeforeSuspend: false, exception: null }).autoRenew, false);
for (const exc of DUTY_EXCEPTIONS) {
  eq(`plan: ${exc} is cleared with the term`, endOrderPlan({ status: 'ACTIVE', autoRenew: false, autoRenewBeforeSuspend: null, exception: exc }).clearDuty, true);
}
eq('plan: REFUND_PENDING stays with finance', endOrderPlan({ status: 'EXPIRED', autoRenew: false, autoRenewBeforeSuspend: null, exception: 'REFUND_PENDING' }).clearDuty, false);
eq('plan: RENEWAL_NOT_EXTENDED is never cleared here (the gate refuses it)', endOrderPlan({ status: 'ACTIVE', autoRenew: false, autoRenewBeforeSuspend: null, exception: 'RENEWAL_NOT_EXTENDED' }).clearDuty, false);
eq('plan: no exception → nothing to clear', endOrderPlan({ status: 'ACTIVE', autoRenew: false, autoRenewBeforeSuspend: null, exception: null }).clearDuty, false);

// ── portal bell copy ─────────────────────────────────────────────────────────
eq('bell: released, in grace → Renew', endOrderClientNotice('ORD-21399', 'Sep 4, 2026', 1, true),
  'Order ORD-21399 expired on Sep 4, 2026 — its proxies were released. Renew to get fresh proxies.');
eq('bell: released, past grace → Start a new order', endOrderClientNotice('ORD-21399', 'Sep 4, 2026', 2, false),
  'Order ORD-21399 expired on Sep 4, 2026 — its proxies were released. Start a new order to get fresh proxies.');
eq('bell: nothing released → no release claim', endOrderClientNotice('ORD-1', 'Sep 4, 2026', 0, true),
  'Order ORD-1 expired on Sep 4, 2026. Renew to get fresh proxies.');

// ── sweep mirror: a duty dies with the term (EXPIRED · past grace · no proxies) ──
const DUTY = { status: 'EXPIRED' as const, exception: 'PAID_NOT_PROVISIONED' as const, liveAssignments: 0, expiresAt: at(-48), graceHours: 24 };
eq('duty: EXPIRED + PNP + 0 live + past grace → dies', dutyDiedWithTerm(DUTY, NOW), true);
eq('duty: exactly at grace end → dies (sweep 1b boundary)', dutyDiedWithTerm({ ...DUTY, expiresAt: at(-24) }, NOW), true);
eq('duty: 1ms before grace end → stays', dutyDiedWithTerm({ ...DUTY, expiresAt: new Date(NOW - 24 * H + 1) }, NOW), false);
eq('duty: in grace → stays (a renewal can revive the order)', dutyDiedWithTerm({ ...DUTY, expiresAt: at(-1) }, NOW), false);
eq('duty: proxies still held past grace → stays', dutyDiedWithTerm({ ...DUTY, liveAssignments: 1 }, NOW), false);
eq('duty: ACTIVE → untouched', dutyDiedWithTerm({ ...DUTY, status: 'ACTIVE' }, NOW), false);
eq('duty: SUSPENDED → untouched', dutyDiedWithTerm({ ...DUTY, status: 'SUSPENDED' }, NOW), false);
eq('duty: no term → untouched', dutyDiedWithTerm({ ...DUTY, expiresAt: null }, NOW), false);
eq('duty: REFUND_PENDING is finance, not a duty → stays', dutyDiedWithTerm({ ...DUTY, exception: 'REFUND_PENDING' }, NOW), false);
eq('duty: RENEWAL_NOT_EXTENDED is not a duty → stays', dutyDiedWithTerm({ ...DUTY, exception: 'RENEWAL_NOT_EXTENDED' }, NOW), false);
eq('duty: no exception → nothing', dutyDiedWithTerm({ ...DUTY, exception: null }, NOW), false);
for (const exc of DUTY_EXCEPTIONS) eq(`duty: ${exc} dies with the term`, dutyDiedWithTerm({ ...DUTY, exception: exc }, NOW), true);
eq('duty: grace 0h → dies right at expiry', dutyDiedWithTerm({ ...DUTY, expiresAt: new Date(NOW), graceHours: 0 }, NOW), true);

console.log(`\nend order now: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
