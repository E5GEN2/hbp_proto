// Floating "Need help? Chat on Telegram" CTA — canon `.telegram-cta`.
// Rendered from (client)/layout.tsx so it appears on EVERY client-portal
// page (owner request; was checkout-only in the prototype).
// Same support handle as the Support page (lib/support).
import { TELEGRAM_SUPPORT_URL } from '@/lib/support';

export function TelegramCta() {
  return (
    <a
      className="telegram-cta"
      href={TELEGRAM_SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with support on Telegram"
    >
      <span className="telegram-cta-icon">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M21.7 3.2L2.5 10.5c-1 .4-1 1.7 0 2.1l4.9 1.7L9.3 21c.2.7 1.1.9 1.5.3l3-4.1 4.6 3.4c.8.6 1.9.1 2-.9l2.6-15c.2-1.1-.9-2-1.9-1.5zM9 14.4l-.4 4.6-1.5-5.2 11-7.1L9 14.4z" />
        </svg>
      </span>
      <span className="telegram-cta-label">Need help? Chat on Telegram</span>
    </a>
  );
}
