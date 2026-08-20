'use client';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// label widened to ReactNode (2026-07-29) so option rows can carry an icon +
// text (crypto coin picker) — plain-string callers are unaffected.
export type FormSelectOption = { value: string; label?: ReactNode; disabled?: boolean };

/* Custom dropdown replacing native <select> (product ask 2026-07-07): the
   macOS native popup opens over the control, shifted left, self-sized and
   always light. This menu keeps the field's exact width, opens below it and
   follows the theme. The closed control reuses .form-select so it stays
   pixel-identical to the native canon field (geometry, chevron, focus halo).
   `placeholder` is button text for the empty state ONLY — it is never
   rendered as a pickable option (product ask: Choose… must not be a choice).

   The OPEN menu renders in a body-level portal with position:fixed (owner find
   №2, 2026-07-29): panels carry `overflow:hidden` for their rounded corners,
   which clipped an absolutely-positioned menu. A fixed portal escapes every
   ancestor's clip; z-index sits above modals so in-modal selects still open
   over the dialog. Position is re-measured on scroll/resize while open. */
export function FormSelect({ value, onChange, options, placeholder = 'Choose…', disabled = false, wrapStyle, btnStyle, btnClassName = 'form-select', ariaLabelledby }: {
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
  /** id of the visible label element — gives the trigger an accessible name
      (screen readers otherwise announce only the current value). */
  ariaLabelledby?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ placement: 'below' | 'above'; top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);

  const measure = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    // Prefer opening downward; flip up only when there's clearly more room.
    const placement: 'below' | 'above' = below >= 200 || below >= above ? 'below' : 'above';
    const room = (placement === 'below' ? below : above) - 16;
    setPos({
      placement,
      left: r.left,
      width: r.width,
      top: placement === 'below' ? r.bottom + 4 : undefined,
      bottom: placement === 'above' ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.min(280, Math.max(140, room)),
    });
  }, []);

  // Measure synchronously on open so the menu never paints at a stale spot.
  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    // Menu is portaled OUTSIDE rootRef — the outside-click check must also
    // spare the menu, or clicking an option would close before its onClick.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    // Escape while the menu is open dismisses ONLY the menu. Registered in the
    // capture phase with stopPropagation so Modal's bubble-phase document
    // listener never sees it — one Escape used to close the dropdown AND the
    // whole modal, throwing away the half-filled form (audit find).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    // capture=true catches scrolling ANCESTORS (the page, a modal body), not
    // just window — keep the menu pinned to the button.
    const onScroll = () => measure();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, measure]);

  const pick = (v: string) => { onChange(v); setOpen(false); };
  // Option lookup first: a filter select may carry a real '' option
  // ("All carriers") whose label must win over the placeholder.
  const current = options.find(o => o.value === value);
  const shown = current ? (current.label ?? current.value) : (value === '' ? (placeholder ?? '') : value);

  // Portal into the nearest theme shell (not document.body): position:fixed
  // still escapes the panel's overflow-clip, while staying inside .theme-admin/
  // .theme-client keeps the menu's CSS-variable palette correct. Those shells
  // don't clip or transform, so fixed positioning stays viewport-relative.
  const portalTarget = typeof document !== 'undefined'
    ? (rootRef.current?.closest('.theme-admin, .theme-client') ?? document.body)
    : null;
  const menu = open && pos && portalTarget
    ? createPortal(
        <div
          ref={menuRef}
          className="form-select-menu form-select-menu-portal"
          role="listbox"
          style={{
            position: 'fixed', left: pos.left, width: pos.width, right: 'auto',
            // Coalesce to explicit 'auto' — a bare `undefined` lets the base
            // .form-select-menu `top: calc(100% + 4px)` leak onto the fixed
            // portal, throwing an 'above'-placed menu off the bottom edge
            // (review find). 'below' sets top, 'above' sets bottom.
            top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', maxHeight: pos.maxHeight,
          }}
        >
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
        </div>,
        portalTarget,
      )
    : null;

  return (
    <div className="form-select-wrap" ref={rootRef} style={wrapStyle}>
      <button
        ref={btnRef}
        type="button" className={`${btnClassName} form-select-btn`} style={btnStyle} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-labelledby={ariaLabelledby} onClick={() => setOpen(o => !o)}
      >
        <span className="form-select-btn-text">{shown}</span>
      </button>
      {menu}
    </div>
  );
}
