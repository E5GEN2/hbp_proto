'use client';
import { useEffect, useRef } from 'react';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
};

export function Modal({ open, onClose, title, children, footer, size = 'md', closeOnBackdrop = true }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus management (WCAG 2.4.3 / 2.1.2): move focus into the dialog on
    // open, keep Tab cycling inside it, hand focus back to the opener on
    // close. The FormSelect menu portals OUTSIDE the dialog but its options
    // are non-focusable divs, so the trap never needs to reach it.
    const opener = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === 'sm' ? 380 : size === 'lg' ? 720 : 520;

  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={ref}
        className={`modal ${size === 'lg' ? 'lg' : ''}`}
        style={{ width: `min(92vw, ${width}px)`, outline: 'none' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div id="modal-title" className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
