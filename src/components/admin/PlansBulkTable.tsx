'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { togglePlanActiveAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

type Row = {
  id: string;
  name: string;
  carrier: string;
  region: string;
  pool: string;
  durationDays: number;
  price: number;
  quota: number;
  allocated: number;
  available: number;
  capacityState: 'sold-out' | 'low' | 'available';
  active: boolean;
};

const STATE_LABEL: Record<Row['capacityState'], string> = { 'sold-out': 'Sold out', low: 'Low availability', available: 'Available' };
// Canon Plans .dt: 64 chk + 168 Plan + 168 Capacity State = 400 fixed; --col-total 22.
const FLEX = (w: number) => `calc(100% * ${w} / 22)`;

export function PlansBulkTable({ plans }: { plans: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function clear() { setSelected(new Set()); }

  const sel = plans.filter(p => selected.has(p.id));
  const canDisable = sel.length > 0 && sel.every(p => p.active);

  function disableSelected() {
    start(async () => {
      let ok = 0, failed = 0;
      for (const p of sel) {
        try { await togglePlanActiveAction(p.id, false, 'bulk-disable'); ok++; } catch { failed++; }
      }
      toast(`Disabled · ${ok}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`, '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  return (
    <>
      <div className={`bulk-bar ${selected.size > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{selected.size} selected</span>
        <div className="bulk-actions">
          {canDisable && <button className="btn sm danger" disabled={pending} onClick={disableSelected}>Disable</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt">
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 'var(--anchor-text)' }} />
            <col style={{ width: FLEX(5) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: 'var(--anchor-text)' }} />
          </colgroup>
          <thead><tr>
            <th className="col-chk"></th>
            <th className="col-text">Plan</th>
            <th className="col-text">Carrier · Region</th>
            <th className="col-text"><span className="th-label">Pool<span className="help-tip" data-tip="Named proxy group this plan draws from. One pool can feed multiple plans.">i</span></span></th>
            <th className="col-duration">Duration</th>
            <th className="col-money">Price</th>
            <th className="col-num"><span className="th-label">Quota<span className="help-tip" data-tip="Configured maximum for this plan. Hard ceiling; set manually.">i</span></span></th>
            <th className="col-num"><span className="th-label">Allocated<span className="help-tip" data-tip="Capacity currently occupied by orders or assignments not yet released.">i</span></span></th>
            <th className="col-num"><span className="th-label">Available<span className="help-tip" data-tip="What the client portal shows as sellable right now. Quota − Allocated. Zero = plan hides from checkout.">i</span></span></th>
            <th className="col-status"><span className="th-label">Status<span className="help-tip" data-tip="Primary plan lifecycle status: Active (sellable) or Disabled (hidden from checkout). One per plan.">i</span></span></th>
            <th className="col-status"><span className="th-label">Capacity State<span className="help-tip" data-tip="Derived selling condition — one label per plan, priority: Sold out → Blocked by grace → Waiting release → Low availability → Available. Contextual, separate from primary Status.">i</span></span></th>
          </tr></thead>
          <tbody>
            {plans.length === 0 ? (
              <tr><td colSpan={11}><div className="empty"><div className="empty-desc">No plans match these filters.</div></div></td></tr>
            ) : plans.map(p => (
              <tr key={p.id} style={selected.has(p.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                <td className="col-chk"><span className={`chk ${selected.has(p.id) ? 'checked' : ''}`} onClick={() => toggle(p.id)} /></td>
                <td className="col-text"><span className="cell-tip" data-tip={p.name}><Link href={`/admin/plans/${p.id}`} className="td-link">{p.name}</Link></span></td>
                <td className="col-text muted"><span className="cell-tip" data-tip={`${p.carrier} · ${p.region}`}>{p.carrier} · {p.region}</span></td>
                <td className="col-text muted"><span className="cell-tip" data-tip={p.pool}>{p.pool}</span></td>
                <td className="col-duration">{p.durationDays} days</td>
                <td className="col-money">{money(p.price)}</td>
                <td className="col-num">{p.quota}</td>
                <td className="col-num">{p.allocated}</td>
                <td className="col-num">{p.available}</td>
                <td className="col-status"><span className={`chip ${p.active ? 'active' : 'expired'}`}>{p.active ? 'Active' : 'Disabled'}</span></td>
                <td className="col-status">{p.capacityState === 'available'
                  /* canon: chip only for special states, dash for normal (D-8) */
                  ? <span className="muted">—</span>
                  : <span className={`cap-label ${p.capacityState}`}>{STATE_LABEL[p.capacityState]}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
