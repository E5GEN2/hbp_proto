// Single source of truth for the support contact + the sold-out dialog copy.
// The Telegram handle used to be hardcoded in four places (TelegramCta, the
// Support page, two checkout notices) — one constant keeps every surface on
// the same link. The sold-out copy is shared between the marketing <dialog>
// and the portal SoldOutModal so the two renderings can never drift.
export const TELEGRAM_SUPPORT_URL = 'https://t.me/USodatai';

// Shown when a client tries to buy a plan whose every location is at capacity
// (owner ask 2026-08-08): the CTA pushes them to Telegram so we can work out a
// solution instead of losing the sale to a dead end.
export const SOLD_OUT_COPY = {
  title: 'All locations are sold out',
  body: 'Every location for this plan is at capacity right now. Message us on Telegram — we’ll find a solution for you.',
  cta: 'Contact us on Telegram',
} as const;
