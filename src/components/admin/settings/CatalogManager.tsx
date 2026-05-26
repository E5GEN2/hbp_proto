'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { addCatalogItemAction, removeCatalogItemAction } from '@/lib/settings-actions';

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
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  function remove(id: number, value: string) {
    if (!confirm(`Remove "${value}"?`)) return;
    start(async () => {
      try {
        await removeCatalogItemAction(id);
        toast('Removed', value, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {kinds.map(k => (
        <div key={k.kind} className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{k.label}</div>
          <ul style={{ margin: '0 0 10px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {(items[k.kind] ?? []).map(i => (
              <li key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{i.value}</span>
                <button className="btn sm" disabled={pending} onClick={() => remove(i.id, i.value)} style={{ padding: '2px 6px', fontSize: 10.5 }}>×</button>
              </li>
            ))}
            {(items[k.kind] ?? []).length === 0 && <li style={{ fontSize: 11.5, color: 'var(--muted)', padding: '4px 10px' }}>None yet</li>}
          </ul>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input" value={drafts[k.kind] ?? ''} onChange={e => setDrafts({ ...drafts, [k.kind]: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') add(k.kind); }}
              placeholder={`+ Add ${k.label.toLowerCase()}`} />
            <button className="btn sm primary" disabled={pending || !(drafts[k.kind] ?? '').trim()} onClick={() => add(k.kind)}>Add</button>
          </div>
        </div>
      ))}
    </div>
  );
}
