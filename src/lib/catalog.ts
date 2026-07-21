// Client-side plan presentation helpers — shared by Catalog + Checkout.
// Canon: proxy-handoff/prototypes/client-panel.html (FEATURES_BY_DURATION,
// tierFeatures, durationLabel). Features are a duration-keyed template, NOT
// derived from the admin description (which renders as marketing copy).

// Feature copy = the locked 5G marketing template (plan-tiers.ts
// PLAN_TIER_TEMPLATES, slots 0/1/2 by duration) — keep the two lists in sync.
// Copied rather than imported: plan-tiers already imports durationLabel from
// this module, and a two-way cycle isn't worth the dedupe.
export const FEATURES_BY_DURATION: Record<number, string[]> = {
  7: ['5G mobile IPs', 'Unlimited bandwidth', 'Dedicated access', 'Auto‑rotation + URL rotation'],
  30: ['5G mobile IPs', 'Unlimited bandwidth', 'Dedicated access', 'Auto‑rotation + URL rotation', 'Priority Telegram support'],
  90: ['5G mobile IPs', 'Unlimited bandwidth', 'Dedicated access', 'Auto‑rotation + URL rotation', 'Priority Telegram support'],
};

export const tierFeatures = (d: number): string[] => FEATURES_BY_DURATION[d] || FEATURES_BY_DURATION[30];

// Client-facing plan name — THE one canon (owner decision 2026-07-21, P2-2 /
// S15-6): "30 days · Mobile". The internal Plan.name is admin-only and must
// never reach the client portal; compact widget rows append `· region`
// themselves. Derived, not stored — cannot go stale when a plan is edited.
export function planDisplayName(durationDays: number): string {
  return `${durationLabel(durationDays)} · Mobile`;
}

export function durationLabel(days: number): string {
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days === 30) return '30 days';
  if (days === 60) return '60 days';
  if (days === 90) return '90 days';
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}
