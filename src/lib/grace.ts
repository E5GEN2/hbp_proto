// Grace period is a CLIENT attribute (owner decision 2026-08-12), not a plan
// attribute. It resolves as a cascade:
//   1. user.graceHoursOverride   — per-client override (Edit client), if set
//   2. Settings → Grace per-tier — admin-tunable VIP/Pro/Standard hours
//   3. tier fallback default     — the constants below
// Grace is the window after an order's expiry during which its proxies keep
// working and it can still be renewed contiguously; past it, the order is done
// and the client buys a new one.

import { prisma } from './prisma';
import type { UserTier } from '@prisma/client';

// Owner 2026-08-12: VIP 3 days, PRO 2 days, Standard 1 day. Used when Settings
// → Grace has no explicit per-tier value stored.
export const DEFAULT_TIER_GRACE_HOURS: Record<UserTier, number> = {
  VIP: 72,
  PRO: 48,
  STANDARD: 24,
};

export type TierGraceHours = Record<UserTier, number>;

// The admin-tunable per-tier grace from the `grace` SystemSetting (the Grace
// Rules form has persisted these since Phase 1 but nothing consumed them until
// now). Missing/invalid values fall back to the tier defaults above.
export async function loadTierGraceHours(): Promise<TierGraceHours> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'grace' } });
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const pick = (k: string, d: number) => {
    const n = Number(v[k]);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    VIP: pick('VIPGraceHours', DEFAULT_TIER_GRACE_HOURS.VIP),
    PRO: pick('ProGraceHours', DEFAULT_TIER_GRACE_HOURS.PRO),
    STANDARD: pick('StandardGraceHours', DEFAULT_TIER_GRACE_HOURS.STANDARD),
  };
}

// The grace hours that apply to one client: a per-client override wins,
// otherwise the client's tier value.
export function effectiveGraceHours(
  client: { tier: UserTier; graceHoursOverride: number | null },
  tierGrace: TierGraceHours,
): number {
  if (client.graceHoursOverride != null && client.graceHoursOverride >= 0) return client.graceHoursOverride;
  return tierGrace[client.tier] ?? DEFAULT_TIER_GRACE_HOURS[client.tier] ?? DEFAULT_TIER_GRACE_HOURS.STANDARD;
}

// True once an order is past BOTH its expiry AND its client's grace window —
// the point where its proxies have been (or will be) released and it can no
// longer be renewed contiguously; the client buys a fresh order instead
// (renewal-policy PR). Decided by the CLOCK, never by order.status: status
// flips to EXPIRED at the expiry instant (still inside grace), and the sweep's
// renewalBucket (GRACE vs EXPIRED) lags a tick — only the time comparison is
// authoritative. A never-activated order (expiresAt null) is not past grace.
// Mirrors the same boundary the sweep uses in targetBucket / auto-release.
export function isPastGrace(
  expiresAt: Date | null,
  client: { tier: UserTier; graceHoursOverride: number | null },
  tierGrace: TierGraceHours,
  nowMs: number,
): boolean {
  if (!expiresAt) return false;
  return nowMs > expiresAt.getTime() + effectiveGraceHours(client, tierGrace) * 3_600_000;
}

// An order can no longer be renewed contiguously — the client must buy a NEW
// order — once it is BOTH past its grace window (by the clock, isPastGrace) AND
// holding no live proxies (they were released back to the pool). Requiring both
// is deliberate: in the default config proxies release exactly at grace-end so
// the two conditions coincide, but with the `autoReleaseAfterGrace` kill-switch
// off ("custom contracts", sweep.ts) proxies stay bound past grace — and an
// order the client still holds proxies on can still be renewed contiguously, so
// we must NOT force "buy again" while those proxies are live. This is the single
// predicate every renewal-origination path and the client UI use to decide
// Renew vs Buy-again (renewal-policy PR).
export function renewalClosed(
  expiresAt: Date | null,
  liveAssignments: number,
  client: { tier: UserTier; graceHoursOverride: number | null },
  tierGrace: TierGraceHours,
  nowMs: number,
): boolean {
  return liveAssignments === 0 && isPastGrace(expiresAt, client, tierGrace, nowMs);
}

// ── Pre-renewal reminder cascade (owner decision 2026-08-22) ────────────────
// Effective hours = client override → plan value → global default — same shape
// as the grace cascade above. 0 at the winning level = reminders explicitly
// off; null = fall through to the next level.
export const REMINDER_DEFAULT_HOURS = 72;

export async function loadReminderDefaultHours(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'grace' } });
  const v = row && typeof row.value === 'object' && row.value !== null
    ? Number((row.value as Record<string, unknown>).preRenewalReminderHours)
    : NaN;
  return Number.isFinite(v) ? v : REMINDER_DEFAULT_HOURS;
}

export function effectiveReminderHours(
  clientOverride: number | null,
  planHours: number | null,
  globalDefault: number,
): number {
  return clientOverride ?? planHours ?? globalDefault;
}
