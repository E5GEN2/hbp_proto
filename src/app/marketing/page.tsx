import './marketing.css';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { money } from '@/lib/money';
import { durationLabel } from '@/lib/catalog';
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

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6"></polyline></svg>';

// The design's three tiers — copy/features ported verbatim; price + ribbon defaults.
// `price` is a fallback; a matching live Plan (by duration) overrides it.
type Tier = {
  days: number;
  eyebrow: string;     // pill markup included
  ribbon: string;      // '' when none
  cardClass: string;
  btnClass: string;
  price: number;
  features: string[];
};

const TIERS: Tier[] = [
  {
    days: 7,
    eyebrow: 'Starter <span class="pill">Mobile</span>',
    ribbon: '',
    cardClass: 'plan',
    btnClass: 'btn btn--ink',
    price: 19,
    features: ['5G mobile IPs', 'Unlimited bandwidth', 'Dedicated access', 'Auto‑rotation + URL rotation'],
  },
  {
    days: 30,
    eyebrow:
      'Best value <span class="pill" style="background:var(--gold-dim); border-color: rgba(181,138,74,.3); color: var(--gold-text)">Mobile</span>',
    ribbon: '<span class="plan__ribbon plan__ribbon--popular">Most popular</span>',
    cardClass: 'plan plan--popular',
    btnClass: 'btn btn--gold',
    price: 55,
    features: [
      '5G mobile IPs',
      'Unlimited bandwidth',
      'Dedicated access',
      'Auto‑rotation + URL rotation',
      'Priority Telegram support',
    ],
  },
  {
    days: 90,
    eyebrow: 'Pro <span class="pill">Mobile</span>',
    ribbon: '<span class="plan__ribbon plan__ribbon--promo">10% off</span>',
    cardClass: 'plan',
    btnClass: 'btn btn--ink',
    price: 149,
    features: [
      '5G mobile IPs',
      'Unlimited bandwidth',
      'Dedicated access',
      'Auto‑rotation + URL rotation',
      'Priority Telegram support',
    ],
  },
];

function renderCard(t: Tier, price: number): string {
  const items = t.features.map((f) => `<li>${CHECK}${f}</li>`).join('');
  return (
    `<article class="${t.cardClass}">` +
    t.ribbon +
    `<div class="plan__eyebrow">${t.eyebrow}</div>` +
    `<h3 class="plan__name">${durationLabel(t.days)}</h3>` +
    `<div class="plan__price"><span class="v">${money(price)}</span><span class="u">/ proxy</span></div>` +
    `<div class="plan__divider"></div>` +
    `<ul class="plan__list">${items}</ul>` +
    `<div class="plan__cta"><a class="${t.btnClass}" href="${buyHref(t.days)}">Buy now <span class="arr">→</span></a></div>` +
    `</article>`
  );
}

export default async function MarketingPage() {
  // Plan cards: design defaults, overridden by live Plan data per duration (catalog logic:
  // group sellable PUBLIC plans by durationDays, take max price within a duration).
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
  });
  const livePrice = new Map<number, number>();
  for (const p of plans) {
    if (p.capacityState === 'SOLD_OUT') continue;
    const v = Number(p.price);
    livePrice.set(p.durationDays, Math.max(livePrice.get(p.durationDays) ?? 0, v));
  }
  const planCards = TIERS.map((t) => renderCard(t, livePrice.get(t.days) ?? t.price)).join('\n');

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
