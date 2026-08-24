// Standalone assertion test for the client-grace policy (no test runner in the
// repo — same pattern as test-crypto-window.ts).
// Run: pnpm exec tsx scripts/test-grace.ts
import {
  DEFAULT_TIER_GRACE_HOURS,
  effectiveGraceHours,
  isPastGrace,
  renewalClosed,
  type TierGraceHours,
 effectiveReminderHours,
} from '../src/lib/grace';
import { renewalBase } from '../src/lib/renewal';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

const H = 3_600_000;
// Admin-tuned per-tier settings distinct from the code defaults, to prove the
// cascade reads settings (not just constants).
const SETTINGS: TierGraceHours = { VIP: 100, PRO: 60, STANDARD: 30 };

// ── effectiveGraceHours: override > tier-setting > default ──────────────────
eq('default constants are the owner tiers', DEFAULT_TIER_GRACE_HOURS, { VIP: 72, PRO: 48, STANDARD: 24 });

eq('no override → tier setting (VIP)', effectiveGraceHours({ tier: 'VIP', graceHoursOverride: null }, SETTINGS), 100);
eq('no override → tier setting (PRO)', effectiveGraceHours({ tier: 'PRO', graceHoursOverride: null }, SETTINGS), 60);
eq('no override → tier setting (STANDARD)', effectiveGraceHours({ tier: 'STANDARD', graceHoursOverride: null }, SETTINGS), 30);

eq('override wins over tier setting', effectiveGraceHours({ tier: 'VIP', graceHoursOverride: 5 }, SETTINGS), 5);
eq('override of 0 is honored (no grace)', effectiveGraceHours({ tier: 'VIP', graceHoursOverride: 0 }, SETTINGS), 0);
eq('negative override ignored → tier setting', effectiveGraceHours({ tier: 'PRO', graceHoursOverride: -1 }, SETTINGS), 60);

// When Settings → Grace has no stored value, loadTierGraceHours falls back to
// the defaults; simulate that by passing the default table here.
eq('tier fallback default when settings == defaults', effectiveGraceHours({ tier: 'STANDARD', graceHoursOverride: null }, DEFAULT_TIER_GRACE_HOURS), 24);

// ── isPastGrace: strictly time-based, boundary is exclusive ─────────────────
const t0 = 1_000_000_000_000; // arbitrary fixed "expiry" epoch ms
const expiry = new Date(t0);
const std = { tier: 'STANDARD' as const, graceHoursOverride: null }; // 30h in SETTINGS
const graceEnd = t0 + 30 * H;

eq('null expiresAt → never past grace', isPastGrace(null, std, SETTINGS, t0 + 999 * H), false);
eq('before expiry → not past grace', isPastGrace(expiry, std, SETTINGS, t0 - 1), false);
eq('at expiry → not past grace (still in grace)', isPastGrace(expiry, std, SETTINGS, t0), false);
eq('mid-grace → not past grace', isPastGrace(expiry, std, SETTINGS, t0 + 15 * H), false);
eq('exactly at grace end → NOT past (boundary exclusive)', isPastGrace(expiry, std, SETTINGS, graceEnd), false);
eq('one ms past grace end → past grace', isPastGrace(expiry, std, SETTINGS, graceEnd + 1), true);
eq('long after grace → past grace', isPastGrace(expiry, std, SETTINGS, t0 + 1000 * H), true);

// Override drives the boundary.
const vipShort = { tier: 'VIP' as const, graceHoursOverride: 1 }; // 1h grace despite VIP
eq('override 1h: mid-hour not past', isPastGrace(expiry, vipShort, SETTINGS, t0 + 30 * 60_000), false);
eq('override 1h: 2h later past', isPastGrace(expiry, vipShort, SETTINGS, t0 + 2 * H), true);

const zeroGrace = { tier: 'VIP' as const, graceHoursOverride: 0 }; // no grace at all
eq('override 0: at expiry not yet past (boundary exclusive)', isPastGrace(expiry, zeroGrace, SETTINGS, t0), false);
eq('override 0: 1ms past expiry → past grace', isPastGrace(expiry, zeroGrace, SETTINGS, t0 + 1), true);

// ── renewalClosed: past grace AND no live proxies ───────────────────────────
// std grace = 30h in SETTINGS; expiry at t0; graceEnd = t0 + 30h.
eq('closed: past grace + 0 live → true', renewalClosed(expiry, 0, std, SETTINGS, graceEnd + 1), true);
eq('open: past grace but proxies still bound (autoRelease off) → false', renewalClosed(expiry, 2, std, SETTINGS, graceEnd + 1000 * H), false);
eq('open: in grace + 0 live (early release edge) → false', renewalClosed(expiry, 0, std, SETTINGS, t0 + 5 * H), false);
eq('open: in grace + live → false', renewalClosed(expiry, 3, std, SETTINGS, t0 + 5 * H), false);
eq('open: null expiry → false', renewalClosed(null, 0, std, SETTINGS, t0 + 999 * H), false);
eq('open: at grace end + 0 live (boundary exclusive) → false', renewalClosed(expiry, 0, std, SETTINGS, graceEnd), false);

// ── renewalBase: anchor on expiry unless a full term is wholly in the past ───
const DAYMS = 86_400_000;
const exp2 = new Date(t0);
// Normal grace renewal: 30-day plan, renew 1 day into grace → anchor on expiry
// (NO bonus): base must equal expiry, not now.
eq('base: term reaches future → anchors on expiry (no bonus)',
  renewalBase(exp2, 30, new Date(t0 + 1 * DAYMS)).getTime(), t0);
// ACTIVE order (expiry in the future) → anchor on expiry (unchanged behaviour).
eq('base: future expiry → anchors on expiry',
  renewalBase(new Date(t0 + 5 * DAYMS), 30, new Date(t0)).getTime(), t0 + 5 * DAYMS);
// Degenerate: a full term from expiry is wholly in the past (grace > duration,
// or a long outage) → floor to now so newExpiry stays in the future.
eq('base: term wholly past → floors to now',
  renewalBase(exp2, 7, new Date(t0 + 10 * DAYMS)).getTime(), t0 + 10 * DAYMS);
// Exactly one term elapsed (expiry + duration == now) → not strictly future →
// floor to now (avoids newExpiry == now dead-on-arrival).
eq('base: exactly one term elapsed → floors to now',
  renewalBase(exp2, 7, new Date(t0 + 7 * DAYMS)).getTime(), t0 + 7 * DAYMS);
// Null expiry → now.
eq('base: null expiry → now', renewalBase(null, 30, new Date(t0)).getTime(), t0);
// The floor guarantees newExpiry > now in every case (the auto-renew P0 fix).
for (const [label, exp, dur, nowMs] of [
  ['normal grace', exp2, 30, t0 + 1 * DAYMS],
  ['grace>duration', exp2, 7, t0 + 10 * DAYMS],
  ['long outage', exp2, 7, t0 + 40 * DAYMS],
  ['future expiry', new Date(t0 + 5 * DAYMS), 30, t0],
] as [string, Date, number, number][]) {
  const nb = renewalBase(exp, dur, new Date(nowMs)).getTime() + dur * DAYMS;
  eq(`base: newExpiry strictly future (${label})`, nb > nowMs, true);
}

// ---------- effectiveReminderHours (cascade 2026-08-22) ----------
eq('reminder: client override wins', effectiveReminderHours(24, 48, 72), 24);
eq('reminder: client 0 = explicitly off', effectiveReminderHours(0, 48, 72), 0);
eq('reminder: no client -> plan', effectiveReminderHours(null, 48, 72), 48);
eq('reminder: plan 0 = off, not fall-through', effectiveReminderHours(null, 0, 72), 0);
eq('reminder: no client, no plan -> global', effectiveReminderHours(null, null, 72), 72);

console.log(`\ngrace policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
