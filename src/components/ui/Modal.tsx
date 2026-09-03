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
  /** Extra class on the .modal card — lets a caller restyle its own chrome
      (e.g. the sold-out modal mirrors the marketing site) without touching
      the shared modal used everywhere else. */
  className?: string;
};

export function Modal({ open, onClose, title, children, footer, size = 'md', closeOnBackdrop = true, className }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose can be a fresh closure every parent render (many callers inline it,
  // and some rerender on each keystroke). Read it through a ref so the focus/
  // scroll effect below depends only on `open` — keying it on onClose tore the
  // effect down and refocused the dialog root on every keystroke, breaking text
  // entry in modals with reason/phrase inputs (review find P1).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Capture the trigger to restore focus to on close. Read during the render
  // that flips open→true, BEFORE the dialog (and any autoFocus child) commits
  // — at that point document.activeElement is still the real opener, not the
  // autofocused field the post-commit effect would otherwise capture.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (typeof document !== 'undefined' && open && !wasOpen.current) {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    // Focus management (WCAG 2.4.3 / 2.1.2): move focus into the dialog on
    // open, keep Tab cycling inside it, hand focus back to the opener on
    // close. The FormSelect menu portals OUTSIDE the dialog but its options
    // are non-focusable divs, so the trap never needs to reach it.
    const t = setTimeout(() => {
      const root = ref.current;
      // Don't steal focus from content that autoFocused itself.
      if (root && !root.contains(document.activeElement)) root.focus();
    }, 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
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
      // Restore focus only to a trigger still in the document (after a
      // router.push the opener may be gone — don't yank focus/scroll then).
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const width = size === 'sm' ? 380 : size === 'lg' ? 720 : 520;

  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={ref}
        className={`modal ${size === 'lg' ? 'lg' : ''} ${className ?? ''}`}
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
