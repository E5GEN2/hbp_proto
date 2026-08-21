'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormSelect } from '@/components/ui/FormSelect';
import { useToast } from '@/components/ui/Toast';
import { setOrderRenewalDiscountAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

// Per-order renewal discount (owner decision 2026-08-21): grants a discount on
// this order's future PAID renewals (auto-renew, one-click, checkout renewal).
// While active it REPLACES the plan's renewalDiscountPct. Scope: one cycle /
// N cycles / indefinite; each successful paid renewal consumes one cycle.
export function RenewalDiscountPanel({
  orderId, active, planRenewalPct, current,
}: {
  orderId: string;
  active: boolean; // order not CANCELLED
  planRenewalPct: number;
  current: { value: number; isPercent: boolean; cyclesLeft: number | null } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [unit, setUnit] = useState<'pct' | 'usd'>(current?.isPercent === false ? 'usd' : 'pct');
  const [value, setValue] = useState(current ? String(current.value) : '');
  const [scope, setScope] = useState<'once' | 'cycles' | 'forever'>(
    current ? (current.cyclesLeft === null ? 'forever' : current.cyclesLeft === 1 ? 'once' : 'cycles') : 'once');
  const [cycles, setCycles] = useState(current && current.cyclesLeft !== null && current.cyclesLeft > 1 ? current.cyclesLeft : 2);
  const [err, setErr] = useState<string | null>(null);

  const exhausted = current !== null && current.cyclesLeft === 0;
  const running = current !== null && !exhausted;

  async function save() {
    setErr(null);
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0) return setErr('Enter a discount value > 0');
    if (unit === 'pct' && (!Number.isInteger(v) || v > 100)) return setErr('Percent must be an integer 1..100');
    setPending(true);
    try {
      await setOrderRenewalDiscountAction(orderId, {
        value: v, isPercent: unit === 'pct',
        cycles: scope === 'forever' ? null : scope === 'once' ? 1 : cycles,
      });
      toast('Renewal discount saved', unit === 'pct' ? `−${v}%` : `−${money(v)}`, 'success');
      setEditing(false);
      router.refresh();
    } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    finally { setPending(false); }
  }

  async function clear() {
    setPending(true);
    try {
      await setOrderRenewalDiscountAction(orderId, null);
      toast('Renewal discount cleared', undefined, 'success');
      setEditing(false);
      router.refresh();
    } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    finally { setPending(false); }
  }

  const scopeLabel = current
    ? current.cyclesLeft === null ? 'indefinite'
      : current.cyclesLeft === 0 ? 'exhausted'
      : `${current.cyclesLeft} ${current.cyclesLeft === 1 ? 'renewal' : 'renewals'} left`
    : '';

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Renewal discount</span></div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!editing && (
          <>
            <div className="kv">
              <div className="kv-row">
                <span className="kv-key">This order</span>
                <span className="kv-val">
                  {current
                    ? <>{current.isPercent ? `−${current.value}%` : `−${money(current.value)}`} · {scopeLabel}</>
                    : '—'}
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Plan default</span>
                <span className="kv-val">{planRenewalPct > 0 ? `−${planRenewalPct}%` : '—'}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {running
                ? 'Applies to future paid renewals instead of the plan discount; each successful renewal uses one cycle.'
                : exhausted
                ? 'Exhausted — the plan discount applies again. Set a new one to grant more.'
                : 'A per-order discount replaces the plan discount on future paid renewals.'}
            </div>
            {active && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm" type="button" onClick={() => setEditing(true)}>{running ? 'Change' : 'Set discount'}</button>
                {current && <button className="btn sm" type="button" onClick={clear} disabled={pending}>Clear</button>}
              </div>
            )}
          </>
        )}
        {editing && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input" type="number" min={unit === 'pct' ? 1 : 0.01} step={unit === 'pct' ? 1 : 0.01}
                value={value} onChange={e => setValue(e.target.value)}
                placeholder={unit === 'pct' ? 'e.g. 15' : 'e.g. 5.00'}
                aria-label="Discount value" style={{ flex: 1 }}
              />
              <div style={{ width: 88 }}>
                <FormSelect
                  value={unit} onChange={v => setUnit(v as 'pct' | 'usd')} placeholder={null}
                  options={[{ value: 'pct', label: '%' }, { value: 'usd', label: '$' }]}
                />
              </div>
            </div>
            <FormSelect
              value={scope} onChange={v => setScope(v as 'once' | 'cycles' | 'forever')} placeholder={null}
              options={[
                { value: 'once', label: 'One renewal only' },
                { value: 'cycles', label: 'Several renewals…' },
                { value: 'forever', label: 'Every renewal (indefinite)' },
              ]}
            />
            {scope === 'cycles' && (
              <input
                className="form-input" type="number" min={2} max={120} step={1}
                value={cycles} onChange={e => setCycles(Math.max(2, Math.min(120, parseInt(e.target.value || '2', 10) || 2)))}
                aria-label="Number of renewals"
              />
            )}
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
