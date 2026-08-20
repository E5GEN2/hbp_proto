'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { createOrderAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

type ClientOpt = { id: string; name: string; email: string; balance: number };
type PlanOpt = { id: string; name: string; price: number; durationDays: number; carrier: string; region: string; available: number; autoProvision: boolean };

// Mirror of the server's cent-rounding (roundCents in lib/balance.ts) so the
// button/summary totals match what createOrderByAdmin will actually persist.
const round2 = (n: number) => Math.round(n * 100) / 100;

// The admin panel renders every absolute stamp in UTC (lib/date.ts), so the
// expiry field speaks UTC too — what the admin types here is exactly what the
// order tables will show. datetime-local strings are 'YYYY-MM-DDTHH:mm'.
function fmtUtcInput(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function parseUtcInput(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 16 ? `${s}:00Z` : `${s}Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function NewOrderModal({
  open, onClose, clients, plans, mockPayments,
}: { open: boolean; onClose: () => void; clients: ClientOpt[]; plans: PlanOpt[]; mockPayments: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const defaultMethod = mockPayments ? 'stripe' : 'invoice';
  const [clientId, setClientId] = useState('');
  const [planId, setPlanId] = useState('');
  const [qty, setQty] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'invoice' | 'crypto' | 'comp'>(defaultMethod);
  const [expiresAt, setExpiresAt] = useState(''); // UTC 'YYYY-MM-DDTHH:mm'; '' = plan term
  const [autoRenew, setAutoRenew] = useState(true);
  const [autoAssign, setAutoAssign] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setClientId(''); setPlanId(''); setQty(1); setDiscount(0);
      setPaymentMethod(defaultMethod); setExpiresAt('');
      setAutoRenew(true); setAutoAssign(true); setErr(null);
    }
  }, [open, defaultMethod]);

  const plan = plans.find(p => p.id === planId);
  const isComp = paymentMethod === 'comp';
  const isInstant = paymentMethod === 'stripe' || isComp;
  const unitPrice = plan ? (isComp ? 0 : round2(plan.price * (1 - discount / 100))) : 0;
  const total = round2(unitPrice * qty);
  const maxQty = plan ? Math.min(plan.available, 20) : 1;

  // Custom expiry bounds: strictly after now, strictly inside the plan term.
  const expiryMin = fmtUtcInput(Date.now() + 60_000);
  const expiryMax = plan ? fmtUtcInput(Date.now() + plan.durationDays * 86_400_000 - 60_000) : undefined;
  // A custom absolute expiry is only honoured when the order activates NOW —
  // it needs an instant method, an auto-provision plan, and auto-assign on
  // (pool depth is still the server's call). Otherwise the order would be born
  // PROVISIONING and the date couldn't apply, so the field is disabled.
  const expiryEnabled = !!plan && isInstant && plan.autoProvision && autoAssign;

  function setMethod(v: 'stripe' | 'invoice' | 'crypto' | 'comp') {
    setPaymentMethod(v);
    if (v === 'comp') {
      setDiscount(0); // comp is $0 — a discount is meaningless
      // A comped client never consented to any payment relationship — the
      // default-ON auto-renew would charge their real balance full price at
      // expiry (or dun them for a gift). Opt-in only for comp.
      setAutoRenew(false);
    }
    if (v === 'invoice' || v === 'crypto') {
      setExpiresAt(''); // term starts at payment confirmation
      // The auto-assign toggle greys out for non-instant methods — reset it so
      // a stale OFF from a previous instant selection can't silently ride
      // along and hold provisioning at payment confirmation (review find).
      setAutoAssign(true);
    }
  }

  function setAutoAssignChecked(next: boolean) {
    setAutoAssign(next);
    if (!next) setExpiresAt(''); // a held order activates later — no now-anchored date
  }

  function submit() {
    setErr(null);
    if (!clientId) return setErr('Pick a client');
    if (!planId || !plan) return setErr('Pick a plan');
    if (!isComp && !(total > 0)) return setErr('Total must be greater than $0 — use Comp for a free order');
    let expiresIso: string | null = null;
    if (expiryEnabled && expiresAt) {
      const parsed = parseUtcInput(expiresAt);
      if (!parsed) return setErr('Invalid expiry date');
      const nowMs = Date.now();
      if (parsed.getTime() <= nowMs) return setErr('Expiry must be in the future');
      if (parsed.getTime() >= nowMs + plan.durationDays * 86_400_000) {
        return setErr(`Expiry must be within the plan term (${plan.durationDays}d)`);
      }
      expiresIso = parsed.toISOString();
    }
    start(async () => {
      try {
        const r = await createOrderAction({
          clientId, planId, qty, discountPct: discount, paymentMethod,
          autoRenew, autoAssign, expiresAt: expiresIso,
        });
        toast('Order created', r.orderId, 'success');
        onClose();
        if (r.orderId) router.push(`/admin/orders/${r.orderId}`);
        else router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title="New order" size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending || !clientId || !planId || (!isComp && !(total > 0))}>
            {pending ? 'Creating…' : `Create order · ${money(total)}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" id="no-client-label">Client *</label>
          <FormSelect
            value={clientId}
            onChange={setClientId}
            placeholder="Select a client…"
            ariaLabelledby="no-client-label"
            options={clients.map(c => ({ value: c.id, label: `${c.id} · ${c.name} · ${c.email} · balance ${money(c.balance)}` }))}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" id="no-plan-label">Plan *</label>
          <FormSelect
            value={planId}
            onChange={v => { setPlanId(v); setQty(1); setExpiresAt(''); }}
            placeholder="Select a plan…"
            ariaLabelledby="no-plan-label"
            options={plans.map(p => ({
              value: p.id,
              label: `${p.name} · ${p.carrier} · ${p.region} · ${p.durationDays}d · ${money(p.price)} · avail ${p.available}`,
              disabled: p.available <= 0,
            }))}
          />
        </div>
        <div>
          <label className="form-label" id="no-qty-label">Quantity *</label>
          <div role="group" aria-labelledby="no-qty-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn sm" aria-label="Decrease quantity" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={!plan || qty <= 1}>−</button>
            <input className="form-input mono" value={qty} readOnly aria-labelledby="no-qty-label" style={{ width: 60, textAlign: 'center' }} />
            <button type="button" className="btn sm" aria-label="Increase quantity" onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={!plan || qty >= maxQty}>+</button>
            {plan && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>max {maxQty}</span>}
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="no-discount">Discount (%)</label>
          <input
            id="no-discount" className="form-input" type="number" min={0} max={100} step={1}
            value={discount} disabled={isComp}
            onChange={e => setDiscount(Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10) || 0)))}
          />
        </div>
        <div>
          <label className="form-label" id="no-method-label">Payment method *</label>
          <FormSelect
            value={paymentMethod}
            onChange={v => setMethod(v as any)}
            placeholder={null}
            ariaLabelledby="no-method-label"
            options={[
              mockPayments
                ? { value: 'stripe', label: 'Stripe — confirmed immediately (mock)' }
                : { value: 'stripe', label: 'Stripe — disabled (mock payments off)', disabled: true },
              { value: 'invoice', label: 'Bank transfer — awaiting (Mark paid)' },
              { value: 'crypto', label: 'Crypto — manual confirm (Mark paid)' },
              { value: 'comp', label: 'Comp — free' },
            ]}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="no-expires">Expires (UTC, optional)</label>
          <input
            id="no-expires" className="form-input" type="datetime-local"
            value={expiresAt} min={expiryMin} max={expiryMax} disabled={!expiryEnabled}
            style={{ colorScheme: 'dark' }}
            onChange={e => setExpiresAt(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {!plan ? 'Pick a plan first'
              : expiryEnabled ? `Defaults to the plan term (${plan.durationDays}d) — a custom date must fall inside it`
              : !isInstant ? 'Term starts when the payment confirms'
              : !plan.autoProvision ? 'Plan provisions manually — term starts when proxies are assigned'
              : 'Turn on auto-assign to set a custom expiry'}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button" role="switch" aria-checked={autoRenew} aria-label="Auto-renew enabled"
              className={`toggle-v2 ${autoRenew ? 'on' : ''}`}
              onClick={() => setAutoRenew(v => !v)}
              style={{ cursor: 'pointer', padding: 0 }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Auto-renew enabled</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button" role="switch" aria-checked={autoAssign} aria-label="Auto-assign proxies"
              className={`toggle-v2 ${autoAssign ? 'on' : ''}`}
              onClick={() => setAutoAssignChecked(!autoAssign)}
              disabled={!plan || !isInstant || !plan.autoProvision}
              style={{ cursor: !plan || !isInstant || !plan.autoProvision ? 'default' : 'pointer', padding: 0, opacity: !plan || !isInstant || !plan.autoProvision ? 0.45 : 1 }}
            />
            <span style={{ fontSize: 12.5, color: !plan || !isInstant || !plan.autoProvision ? 'var(--muted)' : 'var(--text)' }}>
              Auto-assign proxies{plan && !plan.autoProvision ? ' (plan is manual)' : ''}
            </span>
          </span>
        </div>
        {autoRenew && plan && (isComp || (expiryEnabled && expiresAt !== '')) && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--warning)', marginTop: -6 }}>
            Auto-renew will charge the client the full plan price ({money(round2(plan.price * qty))}) from their balance at expiry
            {isComp ? ' — they never paid for this comp order' : ' — the custom date brings that charge forward'}.
          </div>
        )}
        <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Subtotal</span>
            <span className="mono">{plan ? money(round2(plan.price * qty)) : '—'}</span>
          </div>
          {isComp && plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>Comp — free</span>
              <span className="mono" style={{ color: 'var(--success)' }}>−{money(round2(plan.price * qty))}</span>
            </div>
          )}
          {!isComp && discount > 0 && plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>Discount ({discount}%)</span>
              <span className="mono" style={{ color: 'var(--success)' }}>−{money(round2(plan.price * qty) - total)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Total</span>
            <span className="mono" style={{ color: 'var(--text)', fontWeight: 650 }}>{money(total)}</span>
          </div>
          {/* The footer button silently disables at $0 non-comp — say why here,
              or a $0-priced plan reads as a dead Create button (review find). */}
          {plan && !isComp && !(total > 0) && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--warning)' }}>
              Total is $0 — use the Comp method for a free order
            </div>
          )}
        </div>
        {err && <div style={{ gridColumn: '1 / -1', padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      </div>
    </Modal>
  );
}
