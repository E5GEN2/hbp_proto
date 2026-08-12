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
