'use client';
import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as A from '@/lib/ui-actions/admin-actions';
import type { PlanInput } from '@/lib/transitions';

type CatalogOption = { value: string };
export type PlanFormProps = {
  mode: 'create' | 'edit';
  planId?: string;
  sku?: string;
  initial: Partial<PlanInput>;
  catalog: {
    carriers: CatalogOption[]; regions: CatalogOption[]; pools: CatalogOption[];
    protocols: CatalogOption[]; rotations: CatalogOption[]; traffic: CatalogOption[];
    durations: CatalogOption[]; currencies: CatalogOption[];
  };
  capacity?: { allocated: number; displayAvailable: number; state: string };
  canDelete?: boolean;
  notesSlot?: ReactNode;
  activitySlot?: ReactNode;
};

const DEFAULTS: PlanInput = {
  name: '', description: '', visibility: 'PUBLIC', carrier: 'Verizon', region: 'US East',
  pool: 'Verizon-East-A', durationDays: 30, price: 129, currency: 'USD', availableQuota: 50,
  protocols: 'HTTP, SOCKS5', rotation: 'Sticky', traffic: 'Unlimited', active: true,
  autoProvision: true, autoRenewDefault: true, renewalAllowed: true, preRenewalReminderHours: 72,
  gracePeriodHours: 48, renewalDiscountPct: 0, lowCapacityThresholdPct: null,
};

const CAP_LABEL: Record<string, string> = { 'sold-out': 'Sold out', low: 'Low availability', available: 'Available' };

export function PlanForm({ mode, planId, sku, initial, catalog, capacity, canDelete, notesSlot, activitySlot }: PlanFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<PlanInput>({ ...DEFAULTS, ...initial } as PlanInput);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof PlanInput>(k: K, v: PlanInput[K]) { setForm(f => ({ ...f, [k]: v })); }

  function onSubmit() {
    setErr(null);
    const payload: PlanInput = {
      ...form,
      durationDays: Number(form.durationDays), price: Number(form.price), availableQuota: Number(form.availableQuota),
      preRenewalReminderHours: Number(form.preRenewalReminderHours), gracePeriodHours: Number(form.gracePeriodHours),
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
      try { await A.deletePlanAction(planId); router.push('/admin/plans'); }
      catch (e: any) { setErr(e.message ?? 'Failed'); }
    });
  }

  const Sel = (k: keyof PlanInput, label: string, opts: CatalogOption[], required = false, tip?: string) => {
    // A plan can hold a value that was since removed from the catalog (values
    // are denormalized strings). A controlled <select> with no matching
    // <option> LOOKS like the first option while the state still holds the
    // stale value — show the truth as a disabled option instead.
    const cur = String((form as any)[k] ?? '');
    const stale = cur !== '' && !opts.some(o => o.value === cur);
    return (
      <div className="form-field">
        <div className="form-label">{label}{required && <span className="req"> *</span>}{tip && <span className="help-tip" data-tip={tip}>i</span>}</div>
        <select className="form-select" value={cur} onChange={e => set(k, e.target.value as any)} required={required}>
          {stale && <option value={cur} disabled>{cur} (removed from catalog)</option>}
          {opts.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
        </select>
      </div>
    );
  };

  const Toggle = (k: 'active' | 'autoProvision' | 'autoRenewDefault' | 'renewalAllowed', label: string, tip?: string) => (
    <div className="toggle-row">
      <label onClick={() => set(k, !form[k] as any)}>
        <span className={`toggle-v2 ${form[k] ? 'on' : ''}`} />
        <span className="toggle-label">{label}{tip && <span className="help-tip" data-tip={tip}>i</span>}</span>
      </label>
    </div>
  );

  const formPanel = (
    <div className="panel">
      <div className="panel-section">
        <div className="panel-title-row">
          <div className="panel-title">Identity</div>
          <span className="form-required-note"><span className="req">*</span>Required fields</span>
        </div>
        <div className="identity-grid">
          <div className="identity-col">
            <div className="form-field">
              <div className="form-label">Plan name <span className="req">*</span></div>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="e.g. Verizon 30-day East" />
            </div>
            {mode === 'edit' && (
              <div className="form-field">
                <div className="form-label">Internal SKU<span className="help-tip" data-tip="Auto-generated using the SKU rule configured in Settings. Default rule includes Duration; optional components may include Carrier and Region. Never shown to clients.">i</span></div>
                <input className="form-input" value={sku ?? '—'} disabled />
              </div>
            )}
            <div className="form-field">
              <div className="form-label">Visibility <span className="req">*</span><span className="help-tip" data-tip="Public appears in client checkout. Internal is admin-only and not shown to clients.">i</span></div>
              <select className="form-select" value={form.visibility} onChange={e => set('visibility', e.target.value as any)}>
                <option value="PUBLIC">Public</option>
                <option value="INTERNAL">Internal</option>
              </select>
            </div>
          </div>
          <div className="identity-desc">
            <div className="form-label">Description<span className="help-tip" data-tip="Plain text. Shown at client-portal checkout and on the public website's plan card. Keep it 1–2 lines.">i</span></div>
            <textarea className="form-textarea" value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Shown at client-portal checkout and on the public plan card. Keep it 1–2 lines." />
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Commercial Setup</div>
        <div className="commercial-grid">
          {Sel('durationDays', 'Duration', catalog.durations, true)}
          <div className="form-field">
            <div className="form-label">Price <span className="req">*</span><span className="help-tip" data-tip="Per-plan price in the selected Currency. Each plan carries its own price — there is no flat fallback.">i</span></div>
            <input className="form-input" type="number" min={0} max={99999} step={0.01} value={form.price} onChange={e => set('price', parseFloat(e.target.value || '0'))} />
          </div>
          {Sel('currency', 'Currency', catalog.currencies, true)}
          {/* Canon create-plan carries the capacity pair INSIDE Commercial
              Setup (prototype.html plan-create); the edit page moves them to
              the Selling Capacity aside, so render here for create only. */}
          {mode === 'create' && (
            <>
              <div className="form-field">
                <div className="form-label">Available quota <span className="req">*</span><span className="help-tip" data-tip="Total concurrent orders this plan can have live at once. The hard ceiling for sales — sales stop at the cap.">i</span></div>
                <input className="form-input" type="number" min={0} max={9999} step={1} value={form.availableQuota} onChange={e => set('availableQuota', parseInt(e.target.value || '0', 10))} />
              </div>
              <div className="form-field">
                <div className="form-label">Low-capacity threshold (%)<span className="help-tip" data-tip="Per-plan override of the global default in Settings → Notifications. Leave blank to inherit the global value (85%).">i</span></div>
                <input className="form-input" type="number" min={0} max={100} step={1} value={form.lowCapacityThresholdPct ?? ''} placeholder="inherits 15%" onChange={e => set('lowCapacityThresholdPct', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
              </div>
            </>
          )}
          <div className="form-field">
            <div className="form-label">Renewal discount (%)<span className="help-tip" data-tip="Applied to every renewal payment for this plan. 0% = full price.">i</span></div>
            <input className="form-input" type="number" min={0} max={100} step={1} value={form.renewalDiscountPct} onChange={e => set('renewalDiscountPct', parseInt(e.target.value || '0', 10))} />
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Infrastructure<span className="help-tip" data-tip="Technical settings. Snapshotted onto each order at purchase time — they don't retroactively change orders that were already sold.">i</span></div>
        <div className="infra-grid">
          {Sel('carrier', 'Carrier', catalog.carriers, true)}
          {Sel('region', 'Region / Location', catalog.regions, true, 'Country, region, state, or city — whichever level the plan targets. Drives which Proxy pools are eligible.')}
          {Sel('pool', 'Proxy pool', catalog.pools, true, 'Named pool this plan draws from when auto-assigning. Pool format: {carrier} | {region}[ | {city}].')}
          {Sel('protocols', 'Protocols', catalog.protocols, false, 'Wire protocols the proxy will accept.')}
          {Sel('rotation', 'Rotation policy', catalog.rotations, false, 'Whether the IP stays sticky for the full order duration or rotates per request / on a schedule.')}
          {Sel('traffic', 'Traffic policy', catalog.traffic, false, 'Bandwidth cap. Unlimited = no accounting. A cap throttles or blocks once threshold is hit.')}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Lifecycle &amp; Automation</div>
        <div className="lifecycle-grid">
          <div className="lifecycle-col">
            {Toggle('active', 'Active (sellable in client catalog)')}
            {Toggle('autoProvision', 'Auto-provision on payment confirm', 'Controls fulfilment automation AFTER payment confirmation. If ON, the system may assign a proxy from the pool and send credentials automatically. If OFF, an admin assigns the proxy and sends credentials manually. Does NOT control whether payment itself is automatic — payment confirmation may be manual (invoice / crypto) or automatic (Stripe webhook) regardless of this setting.')}
            {Toggle('autoRenewDefault', 'Auto-renew default', 'Default state on new orders. Activation requires a saved card or sufficient portal balance.')}
            {Toggle('renewalAllowed', 'Renewal allowed', 'If OFF, the plan can still be sold but cannot be renewed. Used when retiring a plan while honoring existing orders.')}
          </div>
          <div className="lifecycle-col">
            <div className="lifecycle-fields">
              <div className="form-field">
                <div className="form-label">Pre-renewal reminder (hours)<span className="help-tip" data-tip="When to send the first renewal reminder, in hours before expiry. Additional reminders are scheduled in Settings → Grace Rules.">i</span></div>
                <input className="form-input" type="number" min={0} max={720} step={1} value={form.preRenewalReminderHours} onChange={e => set('preRenewalReminderHours', parseInt(e.target.value || '0', 10))} />
              </div>
              <div className="form-field">
                <div className="form-label">Grace period (hours)<span className="help-tip" data-tip="Time after expiry before the proxy is released back to pool. Set 0 to release the moment the order expires.">i</span></div>
                <input className="form-input" type="number" min={0} max={720} step={1} value={form.gracePeriodHours} onChange={e => set('gracePeriodHours', parseInt(e.target.value || '0', 10))} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const capState = capacity?.state ?? 'available';

  return (
    <div className="plan-edit-page" style={mode === 'create' ? { maxWidth: 1080 } : undefined}>
      <div className="detail-header">
        <div className="detail-header-left">
          <div className="detail-id">{mode === 'create' ? (form.name || 'New plan') : form.name}</div>
          <div className="detail-chips">
            {mode === 'edit' ? (
              <>
                <span className={`chip ${form.active ? 'active' : 'expired'}`}>{form.active ? 'Active' : 'Disabled'}</span>
                <span className="badge-soft">{sku ?? planId}</span>
              </>
            ) : (
              <span className="chip expired">Draft · not yet published</span>
            )}
          </div>
        </div>
        <div className="detail-header-actions">
          <Link href="/admin/plans" className="btn">Cancel</Link>
          {mode === 'edit' && canDelete && <button type="button" className="btn danger" onClick={onDelete} disabled={pending}>Delete</button>}
          <button type="button" className="btn primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : mode === 'create' ? 'Create plan' : 'Save changes'}</button>
        </div>
      </div>

      {err && <div className="exc-banner danger" style={{ marginBottom: 0 }}><div className="exc-banner-body"><div className="exc-banner-desc">{err}</div></div></div>}

      {mode === 'edit' ? (
        <div className="plan-edit-shell">
          <div className="grid-left">
            {formPanel}
            {notesSlot}
          </div>
          <aside className="form-aside">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Selling Capacity<span className="help-tip" data-tip="What the client portal is allowed to sell for this plan. Set manually — independent of the physical pool size. The Capacity State below is a derived condition, separate from the plan's primary Status.">i</span></span></div>
              <div className="panel-section">
                <div className="form-grid">
                  <div className="form-field">
                    <div className="form-label">Available quota <span className="req">*</span><span className="help-tip" data-tip="Total concurrent orders this plan can have live at once. The hard ceiling for sales.">i</span></div>
                    <input className="form-input" type="number" min={0} max={9999} step={1} value={form.availableQuota} onChange={e => set('availableQuota', parseInt(e.target.value || '0', 10))} />
                  </div>
                  <div className="form-field">
                    <div className="form-label">Low-capacity threshold (%)<span className="help-tip" data-tip="Per-plan override for the global default in Settings → Notifications → 'Plan capacity > X% full'. Leave blank to inherit (85%).">i</span></div>
                    <input className="form-input" type="number" min={0} max={100} step={1} value={form.lowCapacityThresholdPct ?? ''} placeholder="inherits 15%" onChange={e => set('lowCapacityThresholdPct', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
                  </div>
                </div>
              </div>
              <div className="panel-section">
                <div className="kv">
                  <div className="kv-row"><span className="kv-key">Allocated</span><span className="kv-val">{capacity?.allocated ?? 0}</span></div>
                  <div className="kv-row"><span className="kv-key">Display available</span><span className="kv-val">{capacity?.displayAvailable ?? 0}</span></div>
                  <div className="kv-row"><span className="kv-key">Capacity State</span><span className="kv-val"><span className={`cap-label ${capState}`}>{CAP_LABEL[capState] ?? 'Available'}</span></span></div>
                </div>
              </div>
            </div>
            {activitySlot}
          </aside>
        </div>
      ) : (
        formPanel
      )}
    </div>
  );
}
