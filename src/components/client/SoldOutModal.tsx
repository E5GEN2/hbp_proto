'use client';
import { Modal } from '@/components/ui/Modal';
import { TELEGRAM_SUPPORT_URL, SOLD_OUT_COPY } from '@/lib/support';

// "All locations are sold out" dialog — portal rendering. Uses the canon
// ui/Modal for behaviour (Escape-to-close, focus trap, body scroll lock), but
// carries the `soldout-site` class so its chrome mirrors the marketing site's
// legal/sold-out modal (owner ask: match the site) — cream card, large title,
// circular close, gold CTA. Like the site, dismissal is the × / backdrop /
// Esc plus the single Telegram CTA (no separate Close button). Copy shared via
// lib/support; the site shows the same via its native <dialog> (marketing/_body.ts).
export function SoldOutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={SOLD_OUT_COPY.title}
      className="soldout-site"
      footer={
        <a className="btn soldout-site__cta" href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          {SOLD_OUT_COPY.cta} <span aria-hidden="true">→</span>
        </a>
      }
    >
      <p style={{ margin: 0 }}>{SOLD_OUT_COPY.body}</p>
    </Modal>
  );
}
