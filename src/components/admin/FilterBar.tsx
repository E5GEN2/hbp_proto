'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

export type FilterDef =
  | { kind: 'search'; name: string; placeholder?: string; width?: number }
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[]; value?: string; size?: 'sm' | 'md' | 'lg' };

export function FilterBar({
  filters, action, rightSlot, exportLabel,
}: {
  filters: FilterDef[];
  action?: React.ReactNode;
  rightSlot?: React.ReactNode;
  exportLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [, start] = useTransition();
  const [search, setSearch] = useState(params.get('q') ?? '');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      if (search) sp.set('q', search); else sp.delete('q');
      sp.delete('page');
      start(() => router.replace(`${pathname}?${sp.toString()}`));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function setParam(name: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(name, value); else sp.delete(name);
    sp.delete('page');
    start(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  function resetAll() {
    setSearch('');
    const sp = new URLSearchParams();
    // preserve `view` (tab) but drop filters
    const view = params.get('view');
    if (view) sp.set('view', view);
    start(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  return (
    <div className="filter-bar">
      {filters.map(f => {
        if (f.kind === 'search') {
          return (
            <div className="search-box" key={f.name} style={f.width ? { flex: `0 0 ${f.width}px` } : undefined}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10 10 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {/* Canon search fields ship with an EMPTY placeholder (prototype.html
                  placeholder="") — the magnifier icon is the affordance. */}
              <input
                placeholder={f.placeholder ?? ''}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          );
        }
        const current = params.get(f.name) ?? '';
        return (
          <FormSelect
            key={f.name}
            value={current}
            onChange={v => setParam(f.name, v)}
            options={[{ value: '', label: f.label }, ...f.options]}
            btnClassName={`form-select ${f.size ? `filter-select-${f.size}` : ''}`}
          />
        );
      })}
      <div className="filter-divider" />
      <button className="btn" onClick={resetAll}>Reset filters</button>
      <div className="spacer" style={{ flex: 1 }} />
      {rightSlot}
      {exportLabel && (
        <button className="btn" onClick={() => toast('Export started', 'CSV will be emailed to you when ready', 'success')}>
          {exportLabel}
        </button>
      )}
      {action}
    </div>
  );
}
