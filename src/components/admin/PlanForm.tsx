'use client';
import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as A from '@/lib/ui-actions/admin-actions';
import type { PlanInput } from '@/lib/transitions';
import { FormSelect, type FormSelectOption } from '@/components/ui/FormSelect';

type CatalogOption = { value: string };

// Hardlocked (product ask 2026-07-07) — not catalog-driven, managed in code.
const CURRENCIES: CatalogOption[] = [{ value: 'USD' }, { value: 'RUB' }, { value: 'CNY' }];
const DEFAULT_POOL = 'Default Pool'; // seeded catalog row; create-mode default

export type PlanFormProps = {
  mode: 'create' | 'edit';
  planId?: string;
  sku?: string;
  initial: Partial<PlanInput>;
  catalog: {
    carriers: CatalogOption[]; regions: CatalogOption[]; pools: CatalogOption[];
    protocols: CatalogOption[]; rotations: CatalogOption[]; traffic: CatalogOption[];
    durations: CatalogOption[];
  };
  capacity?: { allocated: number; displayAvailable: number; state: string };
  canDelete?: boolean;
  notesSlot?: ReactNode;
  activitySlot?: ReactNode;
};

// Edit-mode fallback values. Create starts blank so every select shows the
// canon "Choose…" placeholder rather than a pre-filled default.
const DEFAULTS: PlanInput = {
  name: '', description: '', visibility: 'PUBLIC', carrier: 'Verizon', region: 'US East',
  pool: 'Verizon-East-A', durationDays: 30, price: 129, currency: 'USD', availableQuota: 50,
  protocols: 'HTTP, SOCKS5', rotation: 'Sticky', traffic: 'Unlimited', active: true,
  autoProvision: true, autoRenewDefault: true, renewalAllowed: true, preRenewalReminderHours: 72,
  gracePeriodHours: 48, renewalDiscountPct: 0, lowCapacityThresholdPct: null,
};

// Create-mode initial: text/number/select fields empty (Choose… / placeholder),
// behaviour switches ON — matching prototype.html plan-create exactly.
const CREATE_BLANK: Record<string, unknown> = {
  name: '', description: '', visibility: '', carrier: '', region: '', pool: DEFAULT_POOL,
  durationDays: '', price: '', currency: 'USD', availableQuota: '', protocols: '', rotation: '', traffic: '',
  active: true, autoProvision: true, autoRenewDefault: true, renewalAllowed: true,
  preRenewalReminderHours: '', gracePeriodHours: '', renewalDiscountPct: '', lowCapacityThresholdPct: null,
};

const CAP_LABEL: Record<string, string> = { 'sold-out': 'Sold out', low: 'Low availability', available: 'Available' };

export function PlanForm({ mode, planId, sku, initial, catalog, capacity, canDelete, notesSlot, activitySlot }: PlanFormProps) {
  const router = useRouter();
  const isCreate = mode === 'create';
  const [form, setForm] = useState<Record<string, any>>(
    isCreate ? { ...CREATE_BLANK, ...initial } : { ...DEFAULTS, ...initial },
  );
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })); }

  // Store '' while a numeric field is empty so its placeholder shows and the
  // required-check can see it as unset; coerce on submit.
  const setNum = (k: string, raw: string) => set(k, raw === '' ? '' : parseFloat(raw));

  function onSubmit() {
    setErr(null);

    if (isCreate) {
      const required: Array<[unknown, string]> = [
        [typeof form.name === 'string' ? form.name.trim() : form.name, 'Plan name'],
        [form.visibility, 'Visibility'], [form.durationDays, 'Duration'], [form.price, 'Price'],
        [form.currency, 'Currency'], [form.availableQuota, 'Available quota'],
        [form.carrier, 'Carrier'], [form.region, 'Location'], [form.pool, 'Proxy pool'],
      ];
      const missing = required.filter(([v]) => v === '' || v == null).map(([, label]) => label);
      if (missing.length) { setErr(`Please fill in the required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`); return; }
    }

    const num = (v: unknown, fallback = 0) => (v === '' || v == null ? fallback : Number(v));
    const payload: PlanInput = {
      ...(form as PlanInput),
      durationDays: num(form.durationDays),
      price: num(form.price),
      availableQuota: num(form.availableQuota),
      preRenewalReminderHours: num(form.preRenewalReminderHours, 72),
      gracePeriodHours: num(form.gracePeriodHours, 48),
      renewalDiscountPct: num(form.renewalDiscountPct, 0),
      lowCapacityThresholdPct:
        form.lowCapacityThresholdPct === '' || form.lowCapacityThresholdPct == null ? null : Number(form.lowCapacityThresholdPct),
    };
    start(async () => {
      try {
        if (isCreate) {
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

  const Sel = (k: string, label: string, opts: CatalogOption[], required = false, tip?: string, blank = true) => {
    // A plan can hold a value that was since removed from the catalog (values
    // are denormalized strings). A controlled <select> with no matching
    // <option> LOOKS like the first option while the state still holds the
    // stale value — show the truth as a disabled option instead.
    // `blank=false` drops the Choose… placeholder for hardlocked selects that
    // always carry a default (Currency).
    const cur = String(form[k] ?? '');
    const stale = cur !== '' && !opts.some(o => o.value === cur);
    const options: FormSelectOption[] = stale
      ? [{ value: cur, label: `${cur} (removed from catalog)`, disabled: true }, ...opts]
      : opts;
    return (
      <div className="form-field">
        <div className="form-label">{label}{required && <span className="req"> *</span>}{tip && <span className="help-tip" data-tip={tip}>i</span>}</div>
        <FormSelect value={cur} onChange={v => set(k, v)} options={options} placeholder={blank ? 'Choose…' : null} />
      </div>
    );
  };

  const Toggle = (k: 'active' | 'autoProvision' | 'autoRenewDefault' | 'renewalAllowed', label: string) => (
    <div className="toggle-row" key={k}>
      <label onClick={() => set(k, !form[k])}>
        <span className={`toggle-v2 ${form[k] ? 'on' : ''}`} />
        <span className="toggle-label">{label}</span>
      </label>
    </div>
  );

  // Canon plan-create shows 3 switches (a fresh plan is published/active by
  // default, so no Active toggle). Edit keeps the Active switch. Switches
  // carry no help-tips in either mode (product ask 2026-07-07 — tips live
  // only on dropdown fields).
  const toggles = isCreate
    ? [
        Toggle('autoRenewDefault', 'Auto-renew default'),
        Toggle('autoProvision', 'Auto-provision on payment confirm'),
        Toggle('renewalAllowed', 'Renewal allowed'),
      ]
    : [
        Toggle('active', 'Active (sellable in client catalog)'),
        Toggle('autoProvision', 'Auto-provision on payment confirm'),
        Toggle('autoRenewDefault', 'Auto-renew default'),
        Toggle('renewalAllowed', 'Renewal allowed'),
      ];

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
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="e.g. Verizon 1m NY" />
            </div>
            {/* Internal SKU dropped from create (product ask 2026-07-07):
                it's auto-generated on save, nothing to input. Edit keeps it
                as a read-only reference. */}
            {!isCreate && (
              <div className="form-field">
                <div className="form-label">Internal SKU</div>
                <input className="form-input" value={sku ?? '—'} disabled />
              </div>
            )}
            <div className="form-field">
              <div className="form-label">Visibility <span className="req">*</span><span className="help-tip" data-tip="Public appears in client checkout. Internal is admin-only and not shown to clients.">i</span></div>
              <FormSelect
                value={String(form.visibility ?? '')}
                onChange={v => set('visibility', v)}
                options={[{ value: 'PUBLIC', label: 'Public' }, { value: 'INTERNAL', label: 'Internal' }]}
                placeholder={isCreate ? 'Choose…' : null}
              />
            </div>
          </div>
          <div className="identity-desc">
            {/* Non-dropdown fields carry NO help-tips anywhere (product ask
                2026-07-07, both modes) — placeholders carry the hints. The one
                exception is Low-capacity threshold (explicit ask). */}
            <div className="form-label">Description</div>
            <textarea className="form-textarea" value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Internal notes for staff — not shown to clients." />
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Commercial Setup</div>
        <div className="commercial-grid">
          {Sel('durationDays', 'Duration', catalog.durations, true)}
          <div className="form-field">
            <div className="form-label">Price <span className="req">*</span></div>
            <input className="form-input" type="number" min={0} max={99999} step={0.01} value={form.price} placeholder="e.g. 50" onChange={e => setNum('price', e.target.value)} />
          </div>
          {/* Hardlocked trio, default USD — no blank placeholder needed; Sel's
              stale-value guard still covers a legacy plan on another currency. */}
          {Sel('currency', 'Currency', CURRENCIES, true, undefined, false)}
          {/* Canon create-plan carries the capacity pair INSIDE Commercial
              Setup (prototype.html plan-create); the edit page moves them to
              the Selling Capacity aside, so render here for create only. */}
          {isCreate && (
            <>
              <div className="form-field">
                <div className="form-label">Available quota <span className="req">*</span></div>
                <input className="form-input" type="number" min={0} max={9999} step={1} value={form.availableQuota} placeholder="e.g. 50" onChange={e => setNum('availableQuota', e.target.value)} />
              </div>
              <div className="form-field">
                {/* The one non-dropdown field that keeps its tip (explicit
                    product ask 2026-07-07) — "inherit" semantics aren't
                    self-evident from the placeholder alone. */}
                <div className="form-label">Low-capacity threshold (%)<span className="help-tip" data-tip="Per-plan override of the global default in Settings → Notifications. Leave blank to inherit the global value (85%).">i</span></div>
                <input className="form-input" type="number" min={0} max={100} step={1} value={form.lowCapacityThresholdPct ?? ''} placeholder="Inherit global" onChange={e => set('lowCapacityThresholdPct', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
              </div>
            </>
          )}
          <div className="form-field">
            <div className="form-label">Renewal discount</div>
            <input className="form-input" type="number" min={0} max={100} step={1} value={form.renewalDiscountPct} placeholder="0%" onChange={e => setNum('renewalDiscountPct', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Infrastructure<span className="help-tip" data-tip="Technical settings. Snapshotted onto each order at purchase time — they don't retroactively change orders that were already sold.">i</span></div>
        <div className="infra-grid">
          {Sel('carrier', 'Carrier', catalog.carriers, true)}
          {Sel('region', 'Location', catalog.regions, true, 'Country, region, state, or city — whichever level the plan targets. Drives which Proxy pools are eligible.')}
          {Sel('pool', 'Proxy pool', catalog.pools, true, 'Named pool this plan draws from when auto-assigning. Pool format: {carrier} | {region}[ | {city}].')}
          {/* Protocols / Rotation / Traffic dropped from create (product ask
              2026-07-07) — optional policies, set later on the edit page. */}
          {!isCreate && Sel('protocols', 'Protocols', catalog.protocols, false, 'Wire protocols the proxy will accept.')}
          {!isCreate && Sel('rotation', 'Rotation policy', catalog.rotations, false, 'Whether the IP stays sticky for the full order duration or rotates per request / on a schedule.')}
          {!isCreate && Sel('traffic', 'Traffic policy', catalog.traffic, false, 'Bandwidth cap. Unlimited = no accounting. A cap throttles or blocks once threshold is hit.')}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Lifecycle &amp; Automation</div>
        <div className="lifecycle-grid">
          <div className="lifecycle-col">
            {toggles}
          </div>
          {/* Reminder/grace timing dropped from create (product ask
              2026-07-07): those rules are managed in Settings → Grace Rules;
              a fresh plan takes the defaults (72h / 48h). Edit keeps the
              per-plan override fields. */}
          {!isCreate && (
            <div className="lifecycle-col">
              <div className="lifecycle-fields">
                <div className="form-field">
                  <div className="form-label">Pre-renewal reminder (hours)</div>
                  <input className="form-input" type="number" min={0} max={720} step={1} value={form.preRenewalReminderHours} placeholder="e.g. 72" onChange={e => setNum('preRenewalReminderHours', e.target.value)} />
                </div>
                <div className="form-field">
                  <div className="form-label">Grace period (hours)</div>
                  <input className="form-input" type="number" min={0} max={720} step={1} value={form.gracePeriodHours} placeholder="e.g. 48" onChange={e => setNum('gracePeriodHours', e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const capState = capacity?.state ?? 'available';

  // ── Create: single-column page-shell + compact status header (canon). The
  //    "New plan" title is kept per product ask, rendered in the sans
  //    `.plan-create-title` (not the mono `.detail-id` used by entity pages).
  if (isCreate) {
    return (
      <div className="page-shell">
        <div className="detail-header compact">
          <div className="detail-header-status">
            <div className="plan-create-title">New plan</div>
            <span className="badge-soft">Draft · not yet published</span>
          </div>
          <div className="detail-header-actions">
            <Link href="/admin/plans" className="btn">Cancel</Link>
            <button type="button" className="btn primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Create plan'}</button>
          </div>
        </div>
        {err && <div className="exc-banner danger" style={{ marginBottom: 0 }}><div className="exc-banner-body"><div className="exc-banner-desc">{err}</div></div></div>}
        {formPanel}
      </div>
    );
  }

  return (
    <div className="plan-edit-page">
      <div className="detail-header">
        <div className="detail-header-left">
          <div className="detail-id">{form.name}</div>
          <div className="detail-chips">
            <span className={`chip ${form.active ? 'active' : 'expired'}`}>{form.active ? 'Active' : 'Disabled'}</span>
            <span className="badge-soft">{sku ?? planId}</span>
          </div>
        </div>
        <div className="detail-header-actions">
          <Link href="/admin/plans" className="btn">Cancel</Link>
          {canDelete && <button type="button" className="btn danger" onClick={onDelete} disabled={pending}>Delete</button>}
          <button type="button" className="btn primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      {err && <div className="exc-banner danger" style={{ marginBottom: 0 }}><div className="exc-banner-body"><div className="exc-banner-desc">{err}</div></div></div>}

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
                  <div className="form-label">Available quota <span className="req">*</span></div>
                  <input className="form-input" type="number" min={0} max={9999} step={1} value={form.availableQuota} onChange={e => setNum('availableQuota', e.target.value)} />
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
    </div>
  );
}
