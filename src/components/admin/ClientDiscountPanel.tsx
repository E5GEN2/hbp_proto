'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { setClientDiscountAction } from '@/lib/ui-actions/admin-actions';

// Client-level discount (owner decision 2026-08-22): a special price for this
// client — percent off ALL their orders, new purchases and renewals. Never
// stacks with a plan renewal discount (the LARGER of the two applies); an
// active per-order grant beats both. Indefinite until cleared here.
export function ClientDiscountPanel({
  userId, current,
}: {
  userId: string;
  current: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [value, setValue] = useState(current != null ? String(current) : '');
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const v = parseFloat(value);
    // 99 cap (owner decision 2026-08-26): 100% meant free-everything-forever —
    // that's what per-order Comp / renewal grants are for.
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1 || v > 99) {
      return setErr('Percent must be an integer 1..99');
    }
    setPending(true);
    try {
      await setClientDiscountAction(userId, v);
      toast('Client discount saved', `−${v}% on all orders`, 'success');
      setEditing(false);
      router.refresh();
    } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    finally { setPending(false); }
  }

  async function clear() {
    setPending(true);
    try {
      await setClientDiscountAction(userId, null);
      toast('Client discount cleared', undefined, 'success');
      setEditing(false);
      router.refresh();
    } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    finally { setPending(false); }
  }

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Client discount</span></div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!editing && (
          <>
            <div className="kv">
              <div className="kv-row">
                <span className="kv-key">All orders</span>
                <span className="kv-val">{current != null ? `−${current}%` : '—'}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Special price for this client — applies to new purchases and renewals until cleared.
              If a plan renewal discount also applies, the larger one wins (never both);
              a per-order renewal grant overrides both.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" type="button" onClick={() => setEditing(true)}>{current != null ? 'Change' : 'Set discount'}</button>
              {current != null && <button className="btn sm" type="button" onClick={clear} disabled={pending}>Clear</button>}
            </div>
          </>
        )}
        {editing && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="form-input" type="number" min={1} max={99} step={1}
                value={value} onChange={e => setValue(e.target.value)}
                placeholder="e.g. 10"
                aria-label="Discount percent" style={{ flex: 1 }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>%</span>
            </div>
            {err && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm primary" type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
              <button className="btn sm" type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={pending}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
