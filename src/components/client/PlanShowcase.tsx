import { buildPlanCardsHtml, type LivePlanLite } from '@/lib/plan-tiers';
import './plan-showcase.css';

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
      </div>
    </>
  );
}
