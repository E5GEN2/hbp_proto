// Client-side plan presentation helpers — shared by Catalog + Checkout.
// Canon: proxy-handoff/prototypes/client-panel.html (FEATURES_BY_DURATION,
// tierFeatures, durationLabel). Features are a duration-keyed template, NOT
// derived from the admin description (which renders as marketing copy).

export const FEATURES_BY_DURATION: Record<number, string[]> = {
  7: ['4G LTE mobile IPs', 'Unlimited bandwidth', '24h sticky sessions', 'Manual rotation'],
  30: ['4G LTE mobile IPs', 'Unlimited bandwidth', 'Sticky 24h sessions', 'Auto-rotation available'],
  90: ['4G LTE mobile IPs', 'Unlimited bandwidth', 'Sticky 24h sessions', 'Auto-rotation + URL rotation', 'Priority routing'],
};

export const tierFeatures = (d: number): string[] => FEATURES_BY_DURATION[d] || FEATURES_BY_DURATION[30];

export function durationLabel(days: number): string {
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days === 30) return '30 days';
  if (days === 60) return '60 days';
  if (days === 90) return '90 days';
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}
