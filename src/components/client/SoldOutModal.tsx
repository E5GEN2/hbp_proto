'use client';
import { Modal } from '@/components/ui/Modal';
import { TELEGRAM_SUPPORT_URL, SOLD_OUT_COPY } from '@/lib/support';

// "All locations are sold out" dialog — portal rendering. Uses the canon
// ui/Modal (Escape-to-close + body scroll lock + shared chrome) so it behaves
// like every other portal modal; the marketing site shows the same copy via
// its native <dialog> (see marketing/_body.ts). Copy is shared via lib/support.
export function SoldOutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={SOLD_OUT_COPY.title}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <a className="btn primary" href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            {SOLD_OUT_COPY.cta}
          </a>
        </>
      }
    >
      <p className="t-body" style={{ margin: 0 }}>{SOLD_OUT_COPY.body}</p>
    </Modal>
  );
}
