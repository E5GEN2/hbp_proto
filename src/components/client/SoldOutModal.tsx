'use client';
import { TELEGRAM_SUPPORT_URL, SOLD_OUT_COPY } from '@/lib/support';

// "All locations are sold out" dialog — portal rendering (canon .modal).
// Opened when the client tries to buy a plan whose every location is at
// capacity (plan cards on catalog/dashboard, and checkout when it loads with
// nothing sellable). The marketing site renders the same copy through its own
// native <dialog> (see marketing/_body.ts) — copy shared via lib/support.
export function SoldOutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="soldout-title">
        <div className="modal-header">
          <span className="modal-title" id="soldout-title">{SOLD_OUT_COPY.title}</span>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="t-body" style={{ margin: 0 }}>{SOLD_OUT_COPY.body}</p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
          <a className="btn primary" href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            {SOLD_OUT_COPY.cta}
          </a>
        </div>
      </div>
    </div>
  );
}
