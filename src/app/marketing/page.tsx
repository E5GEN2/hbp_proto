import './marketing.css';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { buildPlanCardsHtml, collapseLiveByDuration } from '@/lib/plan-tiers';
import { getAnnouncement, renderPromoHtml } from '@/lib/announcement';
import { renderMarketingBody } from './_body';
import { MarketingView } from './MarketingView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Comet Proxy — Premium Mobile Proxies. Real 5G IPs from US Carriers.',
  description:
    'Premium mobile proxies on real US-carrier devices. Unlimited bandwidth, flexible rotation, transparent pricing.',
};

// Sign in + Buy route through the existing return-aware auth flow.
// from=site lets the auth page show a "Back to site" link.
const SIGNIN_HREF = '/login?from=site';
const buyHref = (days: number) =>
  `/login?return=${encodeURIComponent(`/checkout?duration=${days}&qty=1&autoExtend=1&ref=site`)}`;

export default async function MarketingPage() {
  // Plan cards come entirely from live admin data: one card per DISTINCT
  // DURATION (same-duration location variants collapse — the Location choice
  // lives inside checkout), mapped to the locked template by position
  // (shared with the client portal — see src/lib/plan-tiers.ts). No hardcoded
  // prices/durations.
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { durationDays: 'asc' },
  });
  const live = collapseLiveByDuration(plans
    .filter((p) => p.capacityState !== 'SOLD_OUT')
    .map((p) => ({ durationDays: p.durationDays, price: Number(p.price) })));
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
