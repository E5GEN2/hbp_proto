'use client';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

export type FormSelectOption = { value: string; label?: string; disabled?: boolean };

/* Custom dropdown replacing native <select> (product ask 2026-07-07): the
   macOS native popup opens over the control, shifted left, self-sized and
   always light. This menu keeps the field's exact width, opens below it and
   follows the theme. The closed control reuses .form-select so it stays
   pixel-identical to the native canon field (geometry, chevron, focus halo).
   `placeholder` is button text for the empty state ONLY — it is never
   rendered as a pickable option (product ask: Choose… must not be a choice). */
export function FormSelect({ value, onChange, options, placeholder = 'Choose…', disabled = false, wrapStyle, btnStyle, btnClassName = 'form-select' }: {
  value: string;
  onChange: (v: string) => void;
  options: FormSelectOption[];
  placeholder?: string | null;
  disabled?: boolean;
  wrapStyle?: CSSProperties;
  btnStyle?: CSSProperties;
  /** Class(es) for the closed control — defaults to the canon .form-select
      field look; pass e.g. "orders-filter-select" for compact variants. */
  btnClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };
  // Option lookup first: a filter select may carry a real '' option
  // ("All carriers") whose label must win over the placeholder.
  const current = options.find(o => o.value === value);
  const shown = current ? (current.label ?? current.value) : (value === '' ? (placeholder ?? '') : value);

  return (
    <div className="form-select-wrap" ref={rootRef} style={wrapStyle}>
      <button
        type="button" className={`${btnClassName} form-select-btn`} style={btnStyle} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
      >
        <span className="form-select-btn-text">{shown}</span>
      </button>
      {open && (
        <div className="form-select-menu" role="listbox">
          {options.map(o => (
            <div
              key={o.value}
              className={`form-select-opt ${o.value === value ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
              role="option" aria-selected={o.value === value}
              onClick={() => { if (!o.disabled) pick(o.value); }}
            >
              {o.label ?? o.value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
