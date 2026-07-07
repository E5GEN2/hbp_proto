'use client';
import { useEffect, useRef, useState } from 'react';

export type FormSelectOption = { value: string; label?: string; disabled?: boolean };

/* Custom dropdown replacing native <select> (product ask 2026-07-07): the
   macOS native popup opens over the control, shifted left and sized to its
   own content. This menu keeps the field's exact width and opens below it.
   The closed control reuses .form-select so it stays pixel-identical to the
   native canon field (geometry, chevron, focus halo). */
export function FormSelect({ value, onChange, options, placeholder = 'Choose…' }: {
  value: string;
  onChange: (v: string) => void;
  options: FormSelectOption[];
  /** null = hardlocked select that always carries a value — no blank row */
  placeholder?: string | null;
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
  const shown = value === '' ? (placeholder ?? '') : (options.find(o => o.value === value)?.label ?? value);

  return (
    <div className="form-select-wrap" ref={rootRef}>
      <button type="button" className="form-select form-select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="form-select-btn-text">{shown}</span>
      </button>
      {open && (
        <div className="form-select-menu" role="listbox">
          {placeholder !== null && (
            <div className={`form-select-opt ${value === '' ? 'selected' : ''}`} role="option" aria-selected={value === ''} onClick={() => pick('')}>
              {placeholder}
            </div>
          )}
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
