'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { createOrderAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';
import { renewalUnitPrice } from '@/lib/renewal';

type ClientOpt = { id: string; name: string; email: string; balance: number };
type PlanOpt = { id: string; name: string; price: number; durationDays: number; carrier: string; region: string; available: number; autoProvision: boolean; renewalDiscountPct: number | null };

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
  open, onClose, clients, plans,
}: { open: boolean; onClose: () => void; clients: ClientOpt[]; plans: PlanOpt[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState('');
  const [planId, setPlanId] = useState('');
  const [qty, setQty] = useState(1);
  // One discount, two units: % of the unit price, or a flat $ off the total.
  const [discount, setDiscount] = useState(0);
  const [discountUnit, setDiscountUnit] = useState<'pct' | 'usd'>('pct');
  // Owner decision 2026-08-22: admin-created orders are Crypto (client paid
  // off-site, admin confirms via Mark paid) or Comp — Stripe/bank removed.
  const [paymentMethod, setPaymentMethod] = useState<'crypto' | 'comp'>('crypto');
  const [expiresAt, setExpiresAt] = useState(''); // UTC 'YYYY-MM-DDTHH:mm'; '' = plan term
  // null = follow the method default: ON for paid methods, OFF for comp (a
  // comped client never consented to a payment relationship). An explicit
  // click survives method switches — a forced set in setMethod latched the
  // toggle one-way across a comp detour (review find).
  const [autoRenewChoice, setAutoRenewChoice] = useState<boolean | null>(null);
  const [autoAssign, setAutoAssign] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setClientId(''); setPlanId(''); setQty(1); setDiscount(0); setDiscountUnit('pct');
      setPaymentMethod('crypto'); setExpiresAt('');
      setAutoRenewChoice(null); setAutoAssign(true); setErr(null);
    }
  }, [open]);

  const plan = plans.find(p => p.id === planId);
  const isComp = paymentMethod === 'comp';
  const autoRenew = autoRenewChoice ?? !isComp;
  const isInstant = isComp;
  const subtotal = plan ? round2(plan.price * qty) : 0;
  // Mirrors newOrderMoney: % applies per unit; $ comes off the TOTAL. The
  // discount is recorded for EVERY method (owner 2026-08-22 — a recreated
  // paid order keeps its real terms); Comp then covers whatever is left.
  const discounted = !plan ? 0
    : discountUnit === 'usd' ? Math.max(0, round2(subtotal - discount))
    : round2(round2(plan.price * (1 - discount / 100)) * qty);
  const total = isComp ? 0 : discounted;
  const maxQty = plan ? Math.min(plan.available, 20) : 1;

  // Custom expiry bounds: strictly after now, strictly inside the plan term.
  const expiryMin = fmtUtcInput(Date.now() + 60_000);
  const expiryMax = plan ? fmtUtcInput(Date.now() + plan.durationDays * 86_400_000 - 60_000) : undefined;
  // Custom absolute expiry, any method (owner decision 2026-08-21): an order
  // born ACTIVE consumes it immediately; otherwise the server persists it and
  // applies it at first activation (Mark paid / crypto settle / manual Assign
  // / backfill). The primary use case is recreating a paid-then-deleted order
  // with its original end date.
  const expiryEnabled = !!plan;

  // Note: autoRenew's comp-OFF default and autoAssign's non-instant
  // irrelevance are handled where they belong — autoRenew via the null-choice
  // default above, autoAssign by the server ignoring the flag for non-instant
  // methods. Forcing either state here made a method round-trip silently wipe
  // a deliberate choice (review find).
  function setMethod(v: 'crypto' | 'comp') {
    setPaymentMethod(v);
  }

  function setAutoAssignChecked(next: boolean) {
    setAutoAssign(next);
  }

  function submit() {
    setErr(null);
    if (!clientId) return setErr('Pick a client');
    if (!planId || !plan) return setErr('Pick a plan');
    if (!isComp && !(total > 0)) return setErr('Total must be greater than $0 — use Comp for a free order');
    if (discountUnit === 'usd' && discount > subtotal) {
      return setErr('Discount amount cannot exceed the order total');
    }
    let expiresIso: string | null = null;
    if (expiresAt) {
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
          clientId, planId, qty,
          discountPct: discountUnit === 'pct' ? discount : 0,
          discountUsd: discountUnit === 'usd' ? discount : 0,
          paymentMethod, autoRenew, autoAssign, expiresAt: expiresIso,
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
          <label className="form-label" htmlFor="no-discount">Discount</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="no-discount" className="form-input"
              type="number" min={0} max={discountUnit === 'pct' ? 100 : undefined} step={discountUnit === 'pct' ? 1 : 0.01}
              value={discount}
              onChange={e => {
                if (discountUnit === 'pct') setDiscount(Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10) || 0)));
                else setDiscount(Math.max(0, round2(parseFloat(e.target.value || '0') || 0)));
              }}
              style={{ flex: 1 }}
            />
            <div style={{ width: 72 }}>
              <FormSelect
                value={discountUnit}
                onChange={v => { setDiscountUnit(v as 'pct' | 'usd'); setDiscount(0); }}
                placeholder={null}
                options={[{ value: 'pct', label: '%' }, { value: 'usd', label: '$' }]}
              />
            </div>
          </div>
        </div>
        <div>
          <label className="form-label" id="no-method-label">Payment method *</label>
          <FormSelect
            value={paymentMethod}
            onChange={v => setMethod(v as any)}
            placeholder={null}
            ariaLabelledby="no-method-label"
            options={[
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
              : expiresAt === '' ? `Defaults to the plan term (${plan.durationDays}d) — a custom date must fall inside it`
              : isInstant ? 'Applies immediately if the order activates now, else at activation'
              : 'Applies when the payment confirms and the order activates'}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button" role="switch" aria-checked={autoRenew} aria-label="Auto-renew enabled"
              className={`toggle-v2 ${autoRenew ? 'on' : ''}`}
              onClick={() => setAutoRenewChoice(!autoRenew)}
              style={{ cursor: 'pointer', padding: 0 }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Auto-renew enabled</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* When greyed out for a non-instant method the server follows the
                plan (auto) regardless of the kept OFF state — show what will
                actually happen, not the stale choice (review find). The OFF
                itself survives, so returning to an instant method restores it. */}
            <button
              type="button" role="switch" aria-label="Auto-assign proxies"
              aria-checked={plan?.autoProvision ? (isInstant ? autoAssign : true) : false}
              className={`toggle-v2 ${(plan?.autoProvision ? (isInstant ? autoAssign : true) : false) ? 'on' : ''}`}
              onClick={() => setAutoAssignChecked(!autoAssign)}
              disabled={!plan || !isInstant || !plan.autoProvision}
              style={{ cursor: !plan || !isInstant || !plan.autoProvision ? 'default' : 'pointer', padding: 0, opacity: !plan || !isInstant || !plan.autoProvision ? 0.45 : 1 }}
            />
            <span style={{ fontSize: 12.5, color: !plan || !isInstant || !plan.autoProvision ? 'var(--muted)' : 'var(--text)' }}>
              Auto-assign proxies{plan && !plan.autoProvision ? ' (plan is manual)' : ''}
            </span>
          </span>
        </div>
        {autoRenew && plan && (isComp || expiresAt !== '') && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--warning)', marginTop: -6 }}>
            {/* renewalUnitPrice × qty is exactly what attemptAutoRenew charges
                (auto-renew.ts) — full plan price overstated it on plans with a
                renewal discount (review find). */}
            Auto-renew will charge the client the renewal price ({money(round2(renewalUnitPrice(plan.price, plan.renewalDiscountPct) * qty))}) from their balance at expiry
            {isComp ? ' — they never paid for this comp order' : ' — the custom date brings that charge forward'}.
          </div>
        )}
        <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Subtotal</span>
            <span className="mono">{plan ? money(round2(plan.price * qty)) : '—'}</span>
          </div>
          {discount > 0 && plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>Discount ({discountUnit === 'pct' ? `${discount}%` : money(discount)})</span>
              <span className="mono" style={{ color: 'var(--success)' }}>−{money(round2(subtotal - discounted))}</span>
            </div>
          )}
          {isComp && plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>Comp — free</span>
              <span className="mono" style={{ color: 'var(--success)' }}>−{money(discounted)}</span>
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
              {discountUnit === 'usd' && discount > 0 && discount >= subtotal
                ? 'The $ discount covers the whole total — reduce it, or use the Comp method for a free order'
                : 'Total is $0 — use the Comp method for a free order'}
            </div>
          )}
        </div>
        {err && <div style={{ gridColumn: '1 / -1', padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      </div>
    </Modal>
  );
}
