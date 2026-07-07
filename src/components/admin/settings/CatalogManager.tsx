'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { addCatalogItemAction, removeCatalogItemAction } from '@/lib/ui-actions/settings-actions';

type Item = { id: number; value: string };

export function CatalogManager({ kinds, items }: {
  kinds: { kind: string; label: string }[];
  items: Record<string, Item[]>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function add(kind: string) {
    const value = (drafts[kind] ?? '').trim();
    if (!value) return;
    start(async () => {
      try {
        await addCatalogItemAction(kind, value);
        toast('Added', `${kind}: ${value}`, 'success');
        setDrafts(d => ({ ...d, [kind]: '' }));
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }
  function remove(id: number, value: string) {
    if (!confirm(`Remove "${value}"?`)) return;
    start(async () => {
      try {
        await removeCatalogItemAction(id);
        toast('Removed', value, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }

  return (
    <>
      <div className="catalog-grid">
        {kinds.map(k => {
          const list = items[k.kind] ?? [];
          return (
            <div className="catalog-card" key={k.kind}>
              <div className="catalog-card-head">
                <span className="catalog-card-title">{k.label}</span>
                <span className="catalog-card-count">{list.length}</span>
              </div>
              <div className="catalog-list">
                {list.length === 0
                  ? <span className="catalog-empty">None yet</span>
                  : list.map(i => {
                    // "Default Pool" is the built-in plan-create default —
                    // no delete affordance (server guard mirrors this).
                    const builtIn = k.kind === 'POOL' && i.value === 'Default Pool';
                    return (
                      <span className="catalog-tag" key={i.id}>
                        {i.value}
                        {!builtIn && <button disabled={pending} onClick={() => remove(i.id, i.value)} aria-label={`Remove ${i.value}`}>×</button>}
                      </span>
                    );
                  })}
              </div>
              <div className="catalog-add">
                <input
                  value={drafts[k.kind] ?? ''}
                  placeholder={`Add ${k.label.toLowerCase()}…`}
                  onChange={e => setDrafts({ ...drafts, [k.kind]: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') add(k.kind); }}
                />
                <button disabled={pending || !(drafts[k.kind] ?? '').trim()} onClick={() => add(k.kind)}>Add</button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 20px 20px' }}>
        <span className="muted" style={{ fontSize: 11.5 }}>Catalog changes affect new plans only — existing plans keep their snapshotted values. Locations can’t be removed while active plans use them.</span>
      </div>
    </>
  );
}
