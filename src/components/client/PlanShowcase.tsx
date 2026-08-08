'use client';
import { useState } from 'react';
import { buildPlanCardsHtml, type LivePlanLite } from '@/lib/plan-tiers';
import { SoldOutModal } from './SoldOutModal';
import { TELEGRAM_SUPPORT_URL, SOLD_OUT_COPY } from '@/lib/support';
import './plan-showcase.css';

// The marketing plan cards, rendered inside the client portal (catalog + dashboard)
// so the plan-selection design is identical to the website. Only price + duration
// vary; the rest is the locked template (see src/lib/plan-tiers.ts). Source Sans 3
// is loaded here because the cards are set in it (same as the marketing page).
// Client component since 2026-08-08: a card whose duration is fully sold out
// (plan.soldOut — every location at capacity) opens the sold-out → Telegram
// dialog on click instead of navigating into a dead-end checkout.
export function PlanShowcase({
  plans,
  ctaLabel = 'Select plan',
  hrefFor,
}: {
  plans: LivePlanLite[];
  ctaLabel?: string;
  hrefFor: (durationDays: number) => string;
}) {
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  if (plans.length === 0) {
    return (
      <div className="empty">
        <div className="empty-title">No plans available</div>
        <div className="empty-desc">{SOLD_OUT_COPY.body}</div>
        <div style={{ marginTop: 14 }}>
          <a className="btn primary" href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            {SOLD_OUT_COPY.cta}
          </a>
        </div>
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
        <div
          className="plans"
          onClickCapture={e => {
            // Sold-out CTA: swallow the navigation, open the Telegram dialog.
            const a = (e.target as HTMLElement).closest?.('a[data-soldout-duration]');
            if (a) {
              e.preventDefault();
              e.stopPropagation();
              setSoldOutOpen(true);
            }
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {soldOutOpen && <SoldOutModal onClose={() => setSoldOutOpen(false)} />}
    </>
  );
}
