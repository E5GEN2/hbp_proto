// Standalone assertion test for the time-horizon order signal (status revision
// phase 1) — no test runner in the repo, same pattern as test-grace.ts.
// Run: pnpm exec tsx scripts/test-order-signals.ts
import { orderTimeSignal, timeSignalChip, msToShort, targetBucket, bucketQueueWhere, renewedQueueWhere, BUCKET_CLOCK_STATUSES, RENEWED_QUEUE_STATUSES, type OrderTimeSignal } from '../src/lib/order-signals';
import { DEFAULT_TIER_GRACE_HOURS } from '../src/lib/grace';
import { fmtAdminStamp } from '../src/lib/date';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}
function kindOf(label: string, got: OrderTimeSignal | null, wantKind: OrderTimeSignal['kind'] | null) {
  eq(label, got === null ? null : got.kind, wantKind);
}

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0); // fixed clock
const H = 3_600_000;
const std = { tier: 'STANDARD' as const, graceHoursOverride: null }; // 24h grace
const vip = { tier: 'VIP' as const, graceHoursOverride: null };      // 72h grace
const TG = DEFAULT_TIER_GRACE_HOURS;

const ord = (status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED' | 'NEW' | 'PROVISIONING' | 'PENDING_RENEWAL', hoursToExpiry: number | null, bucket: 'RENEWED' | 'H24' | null = null) => ({
  status: status as any,
  expiresAt: hoursToExpiry === null ? null : new Date(NOW + hoursToExpiry * H),
  renewalBucket: bucket as any,
});

// ── expiring windows (ACTIVE, future expiry) — sweep targetBucket boundaries ──
kindOf('5h left → 24h window', orderTimeSignal(ord('ACTIVE', 5), 2, std, TG, NOW), 'expiring24');
kindOf('exactly 24h → 24h window', orderTimeSignal(ord('ACTIVE', 24), 2, std, TG, NOW), 'expiring24');
kindOf('25h → 3d window', orderTimeSignal(ord('ACTIVE', 25), 2, std, TG, NOW), 'expiring3d');
kindOf('exactly 72h → 3d window', orderTimeSignal(ord('ACTIVE', 72), 2, std, TG, NOW), 'expiring3d');
kindOf('100h → 7d window', orderTimeSignal(ord('ACTIVE', 100), 2, std, TG, NOW), 'expiring7d');
kindOf('exactly 168h → 7d window', orderTimeSignal(ord('ACTIVE', 168), 2, std, TG, NOW), 'expiring7d');
kindOf('169h, no bucket → quiet', orderTimeSignal(ord('ACTIVE', 169), 2, std, TG, NOW), null);
kindOf('169h, RENEWED sticky → renewed', orderTimeSignal(ord('ACTIVE', 169, 'RENEWED'), 2, std, TG, NOW), 'renewed');
// A renewed order whose NEXT window arrived shows the window, not the sticky.
kindOf('20h + RENEWED → 24h window wins', orderTimeSignal(ord('ACTIVE', 20, 'RENEWED'), 2, std, TG, NOW), 'expiring24');

// ── grace (clock-based, works on EXPIRED and on ACTIVE lagging the sweep) ──
kindOf('EXPIRED 5h ago, std 24h grace → grace', orderTimeSignal(ord('EXPIRED', -5), 2, std, TG, NOW), 'grace');
kindOf('ACTIVE 1h past expiry (sweep lag) → grace', orderTimeSignal(ord('ACTIVE', -1), 2, std, TG, NOW), 'grace');
kindOf('boundary instant counts as grace', orderTimeSignal(ord('EXPIRED', -24), 2, std, TG, NOW), 'grace');
kindOf('VIP 30h past expiry (72h grace) → still grace', orderTimeSignal(ord('EXPIRED', -30), 2, vip, TG, NOW), 'grace');
// grace end honours the per-client override
kindOf('override 1h: 2h past → beyond grace', orderTimeSignal(ord('EXPIRED', -2), 0, { tier: 'VIP', graceHoursOverride: 1 }, TG, NOW), 'renewalClosed');
{
  const s = orderTimeSignal(ord('EXPIRED', -5), 2, std, TG, NOW)!;
  eq('grace until = expiry + grace hours', s.until?.getTime(), NOW - 5 * H + 24 * H);
}

// ── past grace: released vs held ──
kindOf('past grace, 0 live → renewal closed', orderTimeSignal(ord('EXPIRED', -30), 0, std, TG, NOW), 'renewalClosed');
kindOf('past grace, proxies still bound → held (loud)', orderTimeSignal(ord('EXPIRED', -30), 2, std, TG, NOW), 'pastGraceHeld');

// ── statuses whose clock is off ──
kindOf('SUSPENDED → no signal (frozen)', orderTimeSignal(ord('SUSPENDED', 5, 'H24'), 2, std, TG, NOW), null);
kindOf('CANCELLED → no signal', orderTimeSignal(ord('CANCELLED', -30), 0, std, TG, NOW), null);
kindOf('NEW, no term → no signal', orderTimeSignal(ord('NEW', null), 0, std, TG, NOW), null);
kindOf('PROVISIONING (clock held) → no signal', orderTimeSignal(ord('PROVISIONING', null), 0, std, TG, NOW), null);
kindOf('PENDING_RENEWAL → no signal', orderTimeSignal(ord('PENDING_RENEWAL', 5), 2, std, TG, NOW), null);
kindOf('ACTIVE without expiresAt → no signal', orderTimeSignal(ord('ACTIVE', null), 2, std, TG, NOW), null);

// ── vocabulary invariants: label/tone/href fixed per kind ──
{
  const s = orderTimeSignal(ord('ACTIVE', 5), 2, std, TG, NOW)!;
  eq('24h chip contract', { label: s.label, tone: s.tone, href: s.href, untilPassed: s.untilPassed }, { label: 'Expiring · 24h', tone: 'danger', href: '/admin/renewals?view=24h', untilPassed: false });
  const g = orderTimeSignal(ord('EXPIRED', -5), 2, std, TG, NOW)!;
  eq('grace chip contract', { label: g.label, tone: g.tone, href: g.href, untilPassed: g.untilPassed }, { label: 'In grace', tone: 'warning', href: '/admin/renewals?view=grace', untilPassed: false });
  const r = orderTimeSignal(ord('ACTIVE', 200, 'RENEWED'), 2, std, TG, NOW)!;
  eq('renewed chip contract', { label: r.label, tone: r.tone, href: r.href, until: r.until }, { label: 'Renewed', tone: 'success', href: '/admin/renewals?view=renewed', until: null });
  // Past-grace kinds carry a PASSED boundary — surfaces must word it "grace
  // ended", never "until" (review find: "until <past date>" inverts meaning).
  const c = orderTimeSignal(ord('EXPIRED', -30), 0, std, TG, NOW)!;
  eq('renewalClosed boundary is passed', c.untilPassed, true);
  const h = orderTimeSignal(ord('EXPIRED', -30), 2, std, TG, NOW)!;
  eq('pastGraceHeld boundary is passed', h.untilPassed, true);
}

// ── timeSignalChip (serializable form for the list tables, phase 2) ──
{
  eq('chip of null is null', timeSignalChip(null), null);
  const s = orderTimeSignal(ord('ACTIVE', 5), 2, std, TG, NOW)!;
  eq('future boundary tip says "until"', timeSignalChip(s), {
    label: 'Expiring · 24h', tone: 'danger', href: '/admin/renewals?view=24h',
    tip: `until ${fmtAdminStamp(new Date(NOW + 5 * H))}`,
  });
  const c = orderTimeSignal(ord('EXPIRED', -30), 0, std, TG, NOW)!;
  eq('passed boundary tip says "grace ended"', timeSignalChip(c), {
    label: 'Renewal closed', tone: 'muted', href: '/admin/renewals?view=expired',
    tip: `grace ended ${fmtAdminStamp(new Date(NOW - 30 * H + 24 * H))}`,
  });
  const r = orderTimeSignal(ord('ACTIVE', 200, 'RENEWED'), 2, std, TG, NOW)!;
  eq('renewed chip has no tip', timeSignalChip(r), {
    label: 'Renewed', tone: 'success', href: '/admin/renewals?view=renewed', tip: null,
  });
}

// ── targetBucket (queue classifier, moved from sweep.ts in phase 3).
//    The pre-expiry windows are in lockstep with the display layer (parity
//    loop below); the grace-END instant deliberately diverges — display
//    counts it as still-grace (<=, isPastGrace semantics), the queue as
//    EXPIRED (the sweep's historical strict <) — pinned explicitly below so
//    a real drift can't hide behind the known one-instant difference. ──
{
  const tb = (hoursToExpiry: number | null, bucket: 'RENEWED' | null = null, graceHours = 24) =>
    targetBucket({ expiresAt: hoursToExpiry === null ? null : new Date(NOW + hoursToExpiry * H), renewalBucket: bucket as any, graceHours }, NOW);
  eq('no expiry → no bucket', tb(null), null);
  eq('5h → H24', tb(5), 'H24');
  eq('exactly 24h → H24', tb(24), 'H24');
  eq('25h → D3', tb(25), 'D3');
  eq('100h → D7', tb(100), 'D7');
  eq('exactly 168h → D7', tb(168), 'D7');
  eq('169h no sticky → null', tb(169), null);
  eq('169h RENEWED sticky survives', tb(169, 'RENEWED'), 'RENEWED');
  eq('5h past, 24h grace → GRACE', tb(-5), 'GRACE');
  eq('30h past, 24h grace → EXPIRED', tb(-30), 'EXPIRED');
  eq('30h past, 72h grace → GRACE', tb(-30, null, 72), 'GRACE');
  // Boundary parity with the display layer: both sides classify the same
  // instant into the same window (inclusive <=24/<=72/<=168 on hoursLeft).
  for (const h of [24, 25, 72, 73, 168]) {
    const sig = orderTimeSignal(ord('ACTIVE', h), 2, std, TG, NOW)!;
    const want = { expiring24: 'H24', expiring3d: 'D3', expiring7d: 'D7' }[sig.kind as string];
    eq(`window parity at ${h}h`, tb(h), want);
  }
  // The KNOWN one-instant divergence at the grace end (see targetBucket's
  // comment): display says still-grace, queue says EXPIRED. Pinned so a real
  // boundary drift on either side fails loudly instead of hiding behind it.
  eq('grace-end instant: display still grace', orderTimeSignal(ord('EXPIRED', -24), 2, std, TG, NOW)!.kind, 'grace');
  eq('grace-end instant: queue already EXPIRED', tb(-24), 'EXPIRED');
  eq('one ms before grace end: queue still GRACE', targetBucket({ expiresAt: new Date(NOW - 24 * H + 1), renewalBucket: null, graceHours: 24 }, NOW), 'GRACE');
}

// ── bucketQueueWhere (the one where-shape every bucket reader counts with) ──
eq('queue where carries the clock-status gate', bucketQueueWhere('H24'), {
  renewalBucket: 'H24', status: { in: ['ACTIVE', 'EXPIRED'] },
});
eq('clock statuses are exactly ACTIVE+EXPIRED', BUCKET_CLOCK_STATUSES, ['ACTIVE', 'EXPIRED']);
// RENEWED is a sticky marker, not a clock window: its queue additionally
// admits PROVISIONING — a paid renewal held for manual Assign after a short
// pool (reprovisionRenewedOrder) must stay on the Renewal-paid tab.
eq('renewed queue admits the clock-held reprovision state', renewedQueueWhere(), {
  renewalBucket: 'RENEWED', status: { in: ['ACTIVE', 'EXPIRED', 'PROVISIONING'] },
});
eq('renewed statuses exclude frozen/terminal', RENEWED_QUEUE_STATUSES.includes('SUSPENDED' as any) || RENEWED_QUEUE_STATUSES.includes('CANCELLED' as any), false);

// ── msToShort ──
eq('sub-minute floors', msToShort(30_000), '<1m');
eq('minutes', msToShort(45 * 60_000), '45m');
eq('hours', msToShort(5 * H), '5h');
eq('hours + minutes', msToShort(5 * H + 30 * 60_000), '5h 30m');
eq('days + hours', msToShort(2 * 24 * H + 4 * H), '2d 4h');
eq('exact days', msToShort(3 * 24 * H), '3d');
eq('a week+ drops hours', msToShort(12 * 24 * H + 5 * H), '12d');

console.log(`\norder signals: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
