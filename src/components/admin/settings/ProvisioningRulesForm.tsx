'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { upsertProvisioningRuleAction, deleteProvisioningRuleAction } from '@/lib/settings-actions';

type Rule = {
  id: string; carrier: string; region: string;
  defaultPool: string; fallbackPools: string[];
  autoAssign: boolean; notes: string | null;
};

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
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }
  function del(id: string, label: string) {
    if (!confirm(`Delete rule ${label}?`)) return;
    start(async () => {
      try {
        await deleteProvisioningRuleAction(id);
        toast('Rule deleted', label, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn primary" onClick={openCreate}>+ Add rule</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>ID</th><th>Carrier</th><th>Region</th><th>Default pool</th><th>Fallback chain</th><th>Auto-assign</th><th></th></tr></thead>
          <tbody>
            {rules.length === 0
              ? <tr><td colSpan={7}><div className="empty"><div className="empty-desc">No rules yet.</div></div></td></tr>
              : rules.map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{r.carrier}</td>
                  <td>{r.region}</td>
                  <td>{r.defaultPool}</td>
                  <td>{r.fallbackPools.length > 0 ? r.fallbackPools.join(' → ') : '—'}</td>
                  <td><span className={`chip ${r.autoAssign ? 'success' : 'muted'}`}>{r.autoAssign ? 'On' : 'Off (manual picker)'}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => openEdit(r)}>Edit</button>
                    <button className="btn sm" onClick={() => del(r.id, `${r.carrier}/${r.region}`)}>Delete</button>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div>
            <label className="form-label">Carrier *</label>
            <select className="form-select" value={form.carrier ?? ''} onChange={e => setForm({ ...form, carrier: e.target.value })}>
              {carriers.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Region *</label>
            <select className="form-select" value={form.region ?? ''} onChange={e => setForm({ ...form, region: e.target.value })}>
              {regions.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Default pool *</label>
            <select className="form-select" value={form.defaultPool ?? ''} onChange={e => setForm({ ...form, defaultPool: e.target.value })}>
              {pools.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Fallback pools (comma-separated; ordered)</label>
            <input className="form-input" value={(form.fallbackPools ?? []).join(', ')}
              onChange={e => setForm({ ...form, fallbackPools: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>Auto-assign at checkout</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>OFF = client-portal checkout shows a pool dropdown</div>
            </div>
            <span className={`toggle ${form.autoAssign ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setForm({ ...form, autoAssign: !form.autoAssign })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-textarea" rows={2} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>
    </>
  );
}
