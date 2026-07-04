'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { createOrderAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

type ClientOpt = { id: string; name: string; email: string; balance: number };
type PlanOpt = { id: string; name: string; price: number; durationDays: number; carrier: string; region: string; available: number };

export function NewOrderModal({
  open, onClose, clients, plans,
}: { open: boolean; onClose: () => void; clients: ClientOpt[]; plans: PlanOpt[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState('');
  const [planId, setPlanId] = useState('');
  const [qty, setQty] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'invoice' | 'crypto' | 'comp'>('stripe');
  const [autoRenew, setAutoRenew] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setClientId(''); setPlanId(''); setQty(1); setDiscount(0);
      setPaymentMethod('stripe'); setAutoRenew(true); setErr(null);
    }
  }, [open]);

  const plan = plans.find(p => p.id === planId);
  const client = clients.find(c => c.id === clientId);
  const unitPrice = plan ? plan.price * (1 - discount / 100) : 0;
  const total = unitPrice * qty;
  const maxQty = plan ? Math.min(plan.available, 20) : 1;

  function submit() {
    setErr(null);
    if (!clientId) return setErr('Pick a client');
    if (!planId) return setErr('Pick a plan');
    start(async () => {
      try {
        const r = await createOrderAction({ clientId, planId, qty, discountPct: discount, paymentMethod, autoRenew });
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
          <button className="btn primary" onClick={submit} disabled={pending || !clientId || !planId}>
            {pending ? 'Creating…' : `Create order · ${money(total)}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Client *</label>
          <select className="form-select" value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.id} · {c.name} · {c.email} · balance {money(c.balance)}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Plan *</label>
          <select className="form-select" value={planId} onChange={e => { setPlanId(e.target.value); setQty(1); }}>
            <option value="">Select a plan…</option>
            {plans.map(p => (
              <option key={p.id} value={p.id} disabled={p.available <= 0}>
                {p.name} · {p.carrier} · {p.region} · {p.durationDays}d · {money(p.price)} · avail {p.available}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Quantity *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={!plan}>−</button>
            <input className="form-input mono" value={qty} readOnly style={{ width: 60, textAlign: 'center' }} />
            <button type="button" className="btn sm" onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={!plan}>+</button>
            {plan && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>max {maxQty}</span>}
          </div>
        </div>
        <div>
          <label className="form-label">Discount (%)</label>
          <input className="form-input" type="number" min={0} max={100} step={1} value={discount} onChange={e => setDiscount(parseInt(e.target.value || '0', 10))} />
        </div>
        <div>
          <label className="form-label">Payment method *</label>
          <select className="form-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as any)}>
            <option value="stripe">Stripe — confirmed immediately (mock)</option>
            <option value="invoice">Bank transfer — awaiting</option>
            <option value="crypto">Crypto — awaiting on-chain</option>
            <option value="comp">Comp — free</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 22 }}>
          <span className={`toggle-v2 ${autoRenew ? 'on' : ''}`} onClick={() => setAutoRenew(v => !v)} style={{ cursor: 'pointer' }} />
          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Auto-renew enabled</span>
        </div>
        <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Subtotal</span>
            <span className="mono">{plan ? money(plan.price * qty) : '—'}</span>
          </div>
          {discount > 0 && plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>Discount ({discount}%)</span>
              <span className="mono" style={{ color: 'var(--success)' }}>−{money((plan.price * discount / 100) * qty)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Total</span>
            <span className="mono" style={{ color: 'var(--text)', fontWeight: 650 }}>{money(total)}</span>
          </div>
        </div>
        {err && <div style={{ gridColumn: '1 / -1', padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      </div>
    </Modal>
  );
}
