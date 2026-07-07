'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { upsertProvisioningRuleAction, deleteProvisioningRuleAction } from '@/lib/ui-actions/settings-actions';

type Rule = {
  id: string; carrier: string; region: string;
  defaultPool: string; fallbackPools: string[];
  autoAssign: boolean; notes: string | null;
};

const W = (w: number) => `calc(100% * ${w} / 20)`;

export function ProvisioningRulesForm({ rules, carriers, regions, pools }: {
  rules: Rule[];
  carriers: string[]; regions: string[]; pools: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<Partial<Rule>>({});
  const [pending, start] = useTransition();

  function openCreate() {
    setEditing(null);
    setForm({ carrier: carriers[0], region: regions[0], defaultPool: pools[0], fallbackPools: [], autoAssign: true, notes: '' });
    setOpen(true);
  }
  function openEdit(r: Rule) {
    setEditing(r);
    setForm({ id: r.id, carrier: r.carrier, region: r.region, defaultPool: r.defaultPool, fallbackPools: r.fallbackPools, autoAssign: r.autoAssign, notes: r.notes });
    setOpen(true);
  }
  function save() {
    start(async () => {
      try {
        await upsertProvisioningRuleAction({
          id: editing?.id, carrier: form.carrier!, region: form.region!,
          defaultPool: form.defaultPool!, fallbackPools: form.fallbackPools ?? [],
          autoAssign: !!form.autoAssign, notes: form.notes ?? undefined,
        });
        toast(editing ? 'Rule updated' : 'Rule created', `${form.carrier}/${form.region}`, 'success');
        setOpen(false);
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }
  function del(id: string, label: string) {
    if (!confirm(`Delete rule ${label}?`)) return;
    start(async () => {
      try {
        await deleteProvisioningRuleAction(id);
        toast('Rule deleted', label, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }

  return (
    <div className="panel-section">
      <div className="panel-title-row">
        <div className="vstack">
          <span className="subsection-title">Provisioning rules · {rules.length} mapped</span>
          <span className="muted">Order checkout uses these to pre-pick a pool. Auto-assign OFF = client sees a pool dropdown at checkout.</span>
        </div>
        <button className="btn primary sm" onClick={openCreate}>+ Add rule</button>
      </div>

      <div className="table-wrap">
        <table className="dt">
          <colgroup>
            <col style={{ width: W(4) }} />
            <col style={{ width: W(4) }} />
            <col style={{ width: W(4) }} />
            <col style={{ width: W(3) }} />
            <col style={{ width: W(3) }} />
            <col style={{ width: W(2) }} />
          </colgroup>
          <thead><tr>
            <th className="col-text">Carrier · Region</th>
            <th className="col-text">Default pool</th>
            <th className="col-text"><span className="th-label">Fallback chain<span className="help-tip" data-tip="Ordered list of pools tried when the default pool is at allocation capacity. Empty = no automatic fallback; provisioning falls into manual queue.">i</span></span></th>
            <th className="col-text"><span className="th-label">Auto-assign<span className="help-tip" data-tip="ON = system silently picks the default pool at checkout. OFF = client-portal checkout shows a pool dropdown so the client picks.">i</span></span></th>
            <th className="col-text">Notes</th>
            <th className="col-action"></th>
          </tr></thead>
          <tbody>
            {rules.length === 0 ? (
              <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No provisioning rules yet. All plans fall into the manual queue at checkout.</div></div></td></tr>
            ) : rules.map(r => (
              <tr key={r.id}>
                <td className="col-text td-primary">{r.carrier} · {r.region}</td>
                <td className="col-text">{r.defaultPool}</td>
                <td className="col-text muted">{r.fallbackPools.length > 0 ? r.fallbackPools.join(' → ') : '—'}</td>
                <td className="col-text"><span className={`chip ${r.autoAssign ? 'active' : 'muted'}`}>{r.autoAssign ? 'ON' : 'OFF · manual picker'}</span></td>
                <td className="col-text muted">{r.notes || '—'}</td>
                <td className="col-action">
                  <span className="hstack" style={{ justifyContent: 'flex-end' }}>
                    <a className="td-link" onClick={() => openEdit(r)}>Edit</a>
                    <a className="td-link" onClick={() => del(r.id, `${r.carrier}/${r.region}`)}>Delete</a>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.id}` : 'Add provisioning rule'} size="lg"
        footer={<>
          <button className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}</button>
        </>}>
        <div className="form-grid cols-3" style={{ padding: 0 }}>
          <div className="form-field">
            <div className="form-label">Carrier <span className="req">*</span></div>
            <select className="form-select" value={form.carrier ?? ''} onChange={e => setForm({ ...form, carrier: e.target.value })}>
              {carriers.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-field">
            <div className="form-label">Region <span className="req">*</span></div>
            <select className="form-select" value={form.region ?? ''} onChange={e => setForm({ ...form, region: e.target.value })}>
              {regions.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-field">
            <div className="form-label">Default pool <span className="req">*</span></div>
            <select className="form-select" value={form.defaultPool ?? ''} onChange={e => setForm({ ...form, defaultPool: e.target.value })}>
              {pools.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-field full">
            <div className="form-label">Fallback pools (comma-separated; ordered)</div>
            <input className="form-input" value={(form.fallbackPools ?? []).join(', ')}
              onChange={e => setForm({ ...form, fallbackPools: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          </div>
          <div className="form-field full">
            <label className="hstack between" style={{ alignItems: 'flex-start' }}>
              <span className="vstack">
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Auto-assign at checkout</span>
                <span className="muted" style={{ fontSize: 11.5 }}>OFF = client-portal checkout shows a pool dropdown</span>
              </span>
              <span className={`toggle-v2 ${form.autoAssign ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setForm({ ...form, autoAssign: !form.autoAssign })} />
            </label>
          </div>
          <div className="form-field full">
            <div className="form-label">Notes (optional)</div>
            <textarea className="form-textarea" rows={2} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
