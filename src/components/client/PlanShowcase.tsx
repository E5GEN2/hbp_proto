import { buildPlanCardsHtml, type LivePlanLite } from '@/lib/plan-tiers';
import './plan-showcase.css';

// The first three "What sets us apart" items from the marketing site (icon +
// title only), stacked in the gutter that opens up to the right of the cards on
// wide viewports. Icons lifted verbatim from src/app/marketing/_body.ts.
const ASIDE_HTML = `
  <div class="diff__item">
    <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="15" y="6" width="20" height="36" rx="3"></rect>
      <line x1="21" y1="38" x2="29" y2="38"></line>
      <g stroke="#B58A4A" stroke-width="1.6">
        <line x1="6" y1="22" x2="6" y2="26"></line>
        <line x1="9" y1="20" x2="9" y2="26"></line>
        <line x1="12" y1="17" x2="12" y2="26"></line>
      </g>
    </svg>
    <h3 class="diff__title">Physical devices</h3>
  </div>
  <div class="diff__item">
    <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="16" width="38" height="16" rx="8"></rect>
      <path d="M 14 20 L 18 24 L 14 28"></path>
      <path d="M 22 20 L 26 24 L 22 28"></path>
      <path d="M 30 20 L 34 24 L 30 28" stroke="#B58A4A"></path>
    </svg>
    <h3 class="diff__title">Unmetered bandwidth</h3>
  </div>
  <div class="diff__item">
    <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="12" y="22" width="24" height="18" rx="2.5"></rect>
      <path d="M17 22 V 16 a 7 7 0 0 1 14 0 V 22"></path>
      <circle cx="24" cy="30" r="2" fill="#B58A4A" stroke="none"></circle>
      <line x1="24" y1="32" x2="24" y2="35"></line>
    </svg>
    <h3 class="diff__title">No complex signups or KYC</h3>
  </div>`;

// The marketing plan cards, rendered inside the client portal (catalog + dashboard)
// so the plan-selection design is identical to the website. Only price + duration
// vary; the rest is the locked template (see src/lib/plan-tiers.ts). Source Sans 3
// is loaded here because the cards are set in it (same as the marketing page).
export function PlanShowcase({
  plans,
  ctaLabel = 'Select plan',
  hrefFor,
}: {
  plans: LivePlanLite[];
  ctaLabel?: string;
  hrefFor: (durationDays: number) => string;
}) {
  if (plans.length === 0) {
    return (
      <div className="empty">
        <div className="empty-title">No plans available</div>
        <div className="empty-desc">All plans are currently sold out. Please check back soon or contact support.</div>
      </div>
    );
  }
  const html = buildPlanCardsHtml(plans, {
    hrefFor,
    ctaInner: `${ctaLabel} <span class="arr">→</span>`,
  });
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <div className="plan-showcase">
        <div className="plans" dangerouslySetInnerHTML={{ __html: html }} />
        <aside className="plan-aside" dangerouslySetInnerHTML={{ __html: ASIDE_HTML }} />
      </div>
    </>
  );
}
