'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export type FilterDef =
  | { kind: 'search'; name: string; placeholder?: string; width?: number }
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[]; value?: string };

export function FilterBar({
  filters, action, rightSlot,
}: {
  filters: FilterDef[];
  action?: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
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
            <input
              key={f.name}
              className="form-input search"
              placeholder={f.placeholder ?? 'Search…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={f.width ? { maxWidth: f.width } : undefined}
            />
          );
        }
        const current = params.get(f.name) ?? '';
        return (
          <select
            key={f.name}
            className="form-select"
            value={current}
            onChange={e => setParam(f.name, e.target.value)}
          >
            <option value="">{f.label}</option>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      })}
      <button className="btn sm" onClick={resetAll}>Reset</button>
      <div className="spacer" />
      {rightSlot}
      {action}
    </div>
  );
}
