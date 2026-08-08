import './marketing.css';
import { prisma } from '@/lib/prisma';
import { buildPlanCardsHtml, collapseLiveByDuration } from '@/lib/plan-tiers';
import { fullySoldOutDurations } from '@/lib/plan-availability';
import { getAnnouncement, renderPromoHtml } from '@/lib/announcement';
import { renderMarketingBody } from './_body';
import { MarketingView } from './MarketingView';

// The public marketing landing. Rendered at the ROOT "/" for logged-out
// visitors (owner ask: the site opens at odatai.com, not /odatai.com/marketing);
// /marketing now redirects to "/". Extracted from the old marketing/page.tsx so
// both the root page and any legacy entry share one implementation.

// Sign in + Buy route through the existing return-aware auth flow.
// from=site lets the auth page show a "Back to site" link.
const SIGNIN_HREF = '/login?from=site';
const buyHref = (days: number) =>
  `/login?return=${encodeURIComponent(`/checkout?duration=${days}&qty=1&autoExtend=1&ref=site`)}`;

export async function MarketingLanding() {
  // Plan cards come entirely from live admin data: one card per DISTINCT
  // DURATION (same-duration location variants collapse — the Location choice
  // lives inside checkout), mapped to the locked template by position
  // (shared with the client portal — see src/lib/plan-tiers.ts). No hardcoded
  // prices/durations.
  const [plans, soldOutDurations] = await Promise.all([
    prisma.plan.findMany({
      where: { active: true, visibility: 'PUBLIC', deletedAt: null },
      orderBy: { durationDays: 'asc' },
    }),
    fullySoldOutDurations(),
  ]);
  // Cards whose duration has zero remaining quota in EVERY location keep the
  // locked design but their CTA opens the sold-out → Telegram dialog (wired in
  // MarketingView) instead of walking a guest through login into a dead end.
  const live = collapseLiveByDuration(plans
    .filter((p) => p.capacityState !== 'SOLD_OUT')
    .map((p) => ({ durationDays: p.durationDays, price: Number(p.price) })))
    .map((p) => (soldOutDurations.has(p.durationDays) ? { ...p, soldOut: true } : p));
  const planCards =
    buildPlanCardsHtml(live, {
      hrefFor: buyHref,
      ctaInner: 'Buy now <span class="arr">→</span>',
    }) ||
    '<p style="grid-column:1/-1; text-align:center; color:var(--slate); padding:24px 0">Plans are being updated — please check back soon.</p>';

  const announcement = await getAnnouncement();
  const html = renderMarketingBody({
    promo: renderPromoHtml(announcement),
    signInHref: SIGNIN_HREF,
    planCards,
  });

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <MarketingView html={html} />
    </>
  );
}
