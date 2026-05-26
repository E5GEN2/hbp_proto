'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as A from '@/lib/admin-actions';
import type { PlanInput } from '@/lib/transitions';

type CatalogOption = { value: string };
export type PlanFormProps = {
  mode: 'create' | 'edit';
  planId?: string;
  initial: Partial<PlanInput>;
  catalog: {
    carriers: CatalogOption[];
    regions: CatalogOption[];
    pools: CatalogOption[];
    protocols: CatalogOption[];
    rotations: CatalogOption[];
    traffic: CatalogOption[];
    durations: CatalogOption[];
    currencies: CatalogOption[];
  };
  capacity?: { allocated: number; displayAvailable: number; state: string };
  canDelete?: boolean;
};

const DEFAULTS: PlanInput = {
  name: '',
  description: '',
  visibility: 'PUBLIC',
  carrier: 'Verizon',
  region: 'US East',
  pool: 'Verizon-East-A',
  durationDays: 30,
  price: 129,
  currency: 'USD',
  availableQuota: 50,
  protocols: 'HTTP, SOCKS5',
  rotation: 'Sticky',
  traffic: 'Unlimited',
  active: true,
  autoProvision: true,
  autoRenewDefault: true,
  renewalAllowed: true,
  preRenewalReminderHours: 72,
  gracePeriodHours: 48,
  renewalDiscountPct: 0,
  lowCapacityThresholdPct: null,
};

export function PlanForm({ mode, planId, initial, catalog, capacity, canDelete }: PlanFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<PlanInput>({ ...DEFAULTS, ...initial } as PlanInput);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof PlanInput>(k: K, v: PlanInput[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Coerce numeric fields (selects return strings)
    const payload: PlanInput = {
      ...form,
      durationDays: Number(form.durationDays),
      price: Number(form.price),
      availableQuota: Number(form.availableQuota),
      preRenewalReminderHours: Number(form.preRenewalReminderHours),
      gracePeriodHours: Number(form.gracePeriodHours),
      renewalDiscountPct: Number(form.renewalDiscountPct),
      lowCapacityThresholdPct: form.lowCapacityThresholdPct == null ? null : Number(form.lowCapacityThresholdPct),
    };
    start(async () => {
      try {
        if (mode === 'create') {
          const r = await A.createPlanAction(payload);
          if (r.ok && r.planId) router.push(`/admin/plans/${r.planId}`);
        } else if (planId) {
          await A.updatePlanAction(planId, payload);
          router.refresh();
        }
      } catch (e: any) { setErr(e.message ?? 'Failed'); }
    });
  }

  function onDelete() {
    if (!planId) return;
    if (!confirm(`Delete ${planId}? This removes it from the client catalog.`)) return;
    setErr(null);
    start(async () => {
      try {
        await A.deletePlanAction(planId);
        router.push('/admin/plans');
      } catch (e: any) { setErr(e.message ?? 'Failed'); }
    });
  }

  const Sel = (k: keyof PlanInput, label: string, opts: CatalogOption[], required = false) => (
    <div>
      <label className="form-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
      <select className="form-select" value={(form as any)[k] ?? ''} onChange={e => set(k, e.target.value as any)} required={required}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
      </select>
    </div>
  );

  return (
    <form onSubmit={onSubmit}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Link href="/admin/plans" className="btn">Cancel</Link>
        <div style={{ flex: 1 }} />
        {mode === 'edit' && canDelete && <button type="button" className="btn danger" onClick={onDelete} disabled={pending}>Delete</button>}
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create plan' : 'Save changes'}
        </button>
      </div>
      {err && <div className="panel" style={{ padding: 12, marginBottom: 16, background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: mode === 'edit' ? '1fr 320px' : '1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 1. Identity */}
          <section className="panel">
            <div className="panel-header"><span className="panel-title">1 · Identity</span></div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <div>
                <label className="form-label">Plan name<span style={{ color: 'var(--danger)' }}> *</span></label>
                <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} required maxLength={80} placeholder="e.g. Verizon 30-day East" />
              </div>
              <div>
                <label className="form-label">Visibility<span style={{ color: 'var(--danger)' }}> *</span></label>
                <select className="form-select" value={form.visibility} onChange={e => set('visibility', e.target.value as any)}>
                  <option value="PUBLIC">Public</option>
                  <option value="INTERNAL">Internal</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={form.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} placeholder="Shown on the public marketing page and at client-portal checkout. Keep it 1–2 lines." />
              </div>
            </div>
          </section>

          {/* 2. Commercial */}
          <section className="panel">
            <div className="panel-header"><span className="panel-title">2 · Commercial setup</span></div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {Sel('durationDays', 'Duration (days)', catalog.durations.map(d => ({ value: d.value })), true)}
              <div>
                <label className="form-label">Price (per proxy)<span style={{ color: 'var(--danger)' }}> *</span></label>
                <input className="form-input" type="number" min={0} max={99999} step={0.01} value={form.price} onChange={e => set('price', parseFloat(e.target.value || '0'))} required />
              </div>
              {Sel('currency', 'Currency', catalog.currencies, true)}
              <div>
                <label className="form-label">Available quota<span style={{ color: 'var(--danger)' }}> *</span></label>
                <input className="form-input" type="number" min={0} max={9999} step={1} value={form.availableQuota} onChange={e => set('availableQuota', parseInt(e.target.value || '0', 10))} required />
              </div>
              <div>
                <label className="form-label">Low-capacity threshold (%)</label>
                <input className="form-input" type="number" min={0} max={100} step={1} value={form.lowCapacityThresholdPct ?? ''} placeholder="inherits 15%" onChange={e => set('lowCapacityThresholdPct', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
              </div>
              <div>
                <label className="form-label">Renewal discount (%)</label>
                <input className="form-input" type="number" min={0} max={100} step={1} value={form.renewalDiscountPct} onChange={e => set('renewalDiscountPct', parseInt(e.target.value || '0', 10))} />
              </div>
            </div>
          </section>

          {/* 3. Infrastructure */}
          <section className="panel">
            <div className="panel-header"><span className="panel-title">3 · Infrastructure</span></div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {Sel('carrier', 'Carrier', catalog.carriers, true)}
              {Sel('region', 'Region / Location', catalog.regions, true)}
              {Sel('pool', 'Proxy pool', catalog.pools, true)}
              {Sel('protocols', 'Protocols', catalog.protocols)}
              {Sel('rotation', 'Rotation policy', catalog.rotations)}
              {Sel('traffic', 'Traffic policy', catalog.traffic)}
            </div>
          </section>

          {/* 4. Lifecycle */}
          <section className="panel">
            <div className="panel-header"><span className="panel-title">4 · Lifecycle &amp; automation</span></div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ToggleRow label="Active (sellable in client catalog)" value={form.active} onChange={v => set('active', v)} />
              <ToggleRow label="Auto-provision on payment confirm" value={form.autoProvision} onChange={v => set('autoProvision', v)} />
              <ToggleRow label="Auto-renew default" value={form.autoRenewDefault} onChange={v => set('autoRenewDefault', v)} />
              <ToggleRow label="Renewal allowed" value={form.renewalAllowed} onChange={v => set('renewalAllowed', v)} />
              <div>
                <label className="form-label">Pre-renewal reminder (hours)</label>
                <input className="form-input" type="number" min={0} max={720} step={1} value={form.preRenewalReminderHours} onChange={e => set('preRenewalReminderHours', parseInt(e.target.value || '0', 10))} />
              </div>
              <div>
                <label className="form-label">Grace period (hours)</label>
                <input className="form-input" type="number" min={0} max={720} step={1} value={form.gracePeriodHours} onChange={e => set('gracePeriodHours', parseInt(e.target.value || '0', 10))} />
              </div>
            </div>
          </section>
        </div>

        {/* Right aside on edit */}
        {mode === 'edit' && capacity && (
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel">
              <div className="panel-header"><span className="panel-title">Selling capacity</span></div>
              <div className="panel-body">
                <div className="kv-row"><span className="kv-label">Quota</span><span className="kv-val mono">{form.availableQuota}</span></div>
                <div className="kv-row"><span className="kv-label">Allocated</span><span className="kv-val mono">{capacity.allocated}</span></div>
                <div className="kv-row total"><span className="kv-label">Available</span><span className="kv-val mono">{capacity.displayAvailable}</span></div>
                <div className="kv-row"><span className="kv-label">State</span>
                  <span className={`chip ${capacity.state === 'low' || capacity.state === 'sold-out' ? capacity.state.replace('-','') : 'muted'}`}>{capacity.state}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                  {capacity.displayAvailable === 0 ? 'Plan is hidden from client checkout (sold out).' : 'Visible in client catalog while available &gt; 0 and active.'}
                </div>
              </div>
            </section>
          </aside>
        )}
      </div>
    </form>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} style={{ cursor: 'pointer' }} />
    </div>
  );
}
