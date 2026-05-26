'use client';
import { useState, useRef, useEffect } from 'react';

export function HelpTip({ children, label = 'i' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        className="help-tip"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
      >
        {label}
      </span>
      {open && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--surface-2)', color: 'var(--text)',
          padding: '8px 10px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          fontSize: 11.5, lineHeight: 1.5,
          width: 'max-content', maxWidth: 320,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 200,
          pointerEvents: 'none',
          fontWeight: 400,
          letterSpacing: 0,
          textTransform: 'none',
          whiteSpace: 'normal',
        }}>
          {children}
        </span>
      )}
    </span>
  );
}
