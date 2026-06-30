// Single source of truth for the plan CARD design, shared by the marketing site
// and the client portal (catalog + dashboard) so all three look identical.
//
// Rule (locked with the user): only PRICE and DURATION are dynamic — everything
// else on a card (eyebrow, feature list, ribbon, button style) is a fixed template
// applied BY POSITION to the (≤3) active+public plans sorted by duration:
//   slot 0 → Starter, slot 1 → Best value / Most popular (gold), slot 2 → Pro.
// The 3-card cap is enforced upstream (MAX_ACTIVE_PUBLIC_PLANS in transitions).

import { money } from './money';
import { durationLabel } from './catalog';

export type PlanTierTemplate = {
  eyebrow: string;   // HTML — includes the "Mobile" pill
  ribbon: string;    // HTML — '' when none
  cardClass: string; // 'plan' | 'plan plan--popular'
  btnClass: string;  // 'btn btn--ink' | 'btn btn--gold'
  features: string[];
};

// Lifted verbatim from the marketing design (Comet Proxy) so the templates stay
// byte-identical across surfaces.
export const PLAN_TIER_TEMPLATES: PlanTierTemplate[] = [
  {
    eyebrow: 'Starter <span class="pill">Mobile</span>',
    ribbon: '',
    cardClass: 'plan',
    btnClass: 'btn btn--ink',
    features: ['5G mobile IPs', 'Unlimited bandwidth', 'Dedicated access', 'Auto‑rotation + URL rotation'],
  },
  {
    eyebrow:
      'Best value <span class="pill" style="background:var(--gold-dim); border-color: rgba(181,138,74,.3); color: var(--gold-text)">Mobile</span>',
    ribbon: '<span class="plan__ribbon plan__ribbon--popular">Most popular</span>',
    cardClass: 'plan plan--popular',
    btnClass: 'btn btn--gold',
    features: [
      '5G mobile IPs',
      'Unlimited bandwidth',
      'Dedicated access',
      'Auto‑rotation + URL rotation',
      'Priority Telegram support',
    ],
  },
  {
    eyebrow: 'Pro <span class="pill">Mobile</span>',
    ribbon: '<span class="plan__ribbon plan__ribbon--promo">10% off</span>',
    cardClass: 'plan',
    btnClass: 'btn btn--ink',
    features: [
      '5G mobile IPs',
      'Unlimited bandwidth',
      'Dedicated access',
      'Auto‑rotation + URL rotation',
      'Priority Telegram support',
    ],
  },
];

export type LivePlanLite = { durationDays: number; price: number };

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6"></polyline></svg>';

// One card's HTML — same markup the marketing site uses.
export function renderPlanCardHtml(
  t: PlanTierTemplate,
  durationDays: number,
  price: number,
  href: string,
  ctaInner: string,
): string {
  const items = t.features.map((f) => `<li>${CHECK}${f}</li>`).join('');
  return (
    `<article class="${t.cardClass}">` +
    t.ribbon +
    `<div class="plan__eyebrow">${t.eyebrow}</div>` +
    `<h3 class="plan__name">${durationLabel(durationDays)}</h3>` +
    `<div class="plan__price"><span class="v">${money(price)}</span><span class="u">/ proxy</span></div>` +
    `<div class="plan__divider"></div>` +
    `<ul class="plan__list">${items}</ul>` +
    `<div class="plan__cta"><a class="${t.btnClass}" href="${href}">${ctaInner}</a></div>` +
    `</article>`
  );
}

// Active+public plans → up to 3 cards, mapped to templates BY POSITION.
export function buildPlanCardsHtml(
  plans: LivePlanLite[],
  opts: { hrefFor: (durationDays: number) => string; ctaInner: string },
): string {
  const sorted = [...plans].sort((a, b) => a.durationDays - b.durationDays || a.price - b.price);
  return sorted
    .slice(0, PLAN_TIER_TEMPLATES.length)
    .map((p, i) => renderPlanCardHtml(PLAN_TIER_TEMPLATES[i], p.durationDays, p.price, opts.hrefFor(p.durationDays), opts.ctaInner))
    .join('\n');
}
