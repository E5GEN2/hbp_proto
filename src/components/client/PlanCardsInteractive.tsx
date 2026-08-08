'use client';
import { useState } from 'react';
import { SoldOutModal } from './SoldOutModal';

// Thin client shell around the server-rendered plan-card HTML. Kept separate
// from PlanShowcase so that stays a Server Component: its `hrefFor` is a
// function, and functions can't cross the RSC→client boundary (Next 14 throws
// at request time). Only the pre-rendered HTML string — serializable — crosses.
// A card whose duration is fully sold out carries data-soldout-duration on its
// CTA (see lib/plan-tiers); clicking it opens the sold-out → Telegram dialog
// instead of navigating into a checkout where nothing can be bought.
export function PlanCardsInteractive({ html }: { html: string }) {
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  return (
    <>
      <div
        className="plans"
        onClickCapture={e => {
          const a = (e.target as HTMLElement).closest?.('a[data-soldout-duration]');
          if (a) {
            e.preventDefault();
            e.stopPropagation();
            setSoldOutOpen(true);
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {soldOutOpen && <SoldOutModal onClose={() => setSoldOutOpen(false)} />}
    </>
  );
}
