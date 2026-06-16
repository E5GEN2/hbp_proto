'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/money';

type PlanSummary = { id: string; name: string; region: string; carrier: string; price: number; autoProvision: boolean; description: string; available: number };

export function CheckoutFlow({
  duration, qty: qtyInit, autoExtend: autoExtendInit, location: locationInit, step: stepInit, balance, plans,
}: {
  duration: number;
  qty: number;
  autoExtend: boolean;
  location: string;
  step: 'details' | 'payment' | 'processing' | 'success' | 'failed';
  balance: number;
  plans: PlanSummary[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(stepInit);
  const [qty, setQty] = useState(Math.max(1, qtyInit));
  const [autoExtend, setAutoExtend] = useState(autoExtendInit);
  const [location, setLocation] = useState(locationInit);
  const [paymentMethod, setPaymentMethod] = useState<'crypto' | 'balance' | 'card'>('balance');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const plan = useMemo(() => plans.find(p => p.region === location) ?? plans[0], [plans, location]);
  const total = plan.price * qty;
  const balanceOk = balance >= total;

  async function placeOrder(method: 'balance' | 'crypto' | 'card') {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/checkout/place', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, qty, autoExtend, paymentMethod: method }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Order failed');
      setOrderId(j.orderId);
      setStep(method === 'crypto' ? 'processing' : 'success');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
      setStep('failed');
    } finally { setBusy(false); }
  }

  async function confirmCrypto() {
    if (!orderId) return;
    setBusy(true);
    try {
      const r = await fetch('/api/checkout/confirm-crypto', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!r.ok) throw new Error('Confirmation failed');
      setStep('success');
      router.refresh();
    } catch (e: any) { setErr(e.message); setStep('failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <Stepper step={step} />
      {step === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">{duration}-day Mobile</span></div>
            <div className="panel-body">
              <p style={{ color: 'var(--text-secondary)' }}>{plan.description}</p>
              <div style={{ marginTop: 14 }}>
                <label className="form-label">Location</label>
                <select className="form-select" value={location} onChange={e => setLocation(e.target.value)}>
                  {plans.map(p => <option key={p.id} value={p.region}>{p.region}{p.available <= 3 ? ' (limited)' : ''}{p.available === 0 ? ' (sold out)' : ''}</option>)}
                </select>
              </div>
              <div style={{ marginTop: 14 }}>
                <label className="form-label">Quantity</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button className="btn sm" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                  <input className="form-input mono" value={qty} readOnly style={{ width: 60, textAlign: 'center' }} />
                  <button className="btn sm" onClick={() => setQty(q => Math.min(plan.available, q + 1))}>+</button>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 8 }}>up to {plan.available}</span>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Auto-extend this order when it expires</span>
                <span onClick={() => setAutoExtend(v => !v)} className={`toggle ${autoExtend ? 'on' : ''}`} style={{ cursor: 'pointer' }} />
              </div>
            </div>
          </div>
          <OrderSummary plan={plan} qty={qty} total={total} cta="Continue to Checkout" onClick={() => setStep('payment')} />
        </div>
      )}
      {step === 'payment' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Payment method</span></div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PaymentRow id="balance" selected={paymentMethod === 'balance'} disabled={!balanceOk} onClick={() => setPaymentMethod('balance')} title={`Account balance · ${money(balance)}`} caption={balanceOk ? 'Instant activation. No fees.' : `Insufficient — add ${money(total - balance)} via deposit.`} />
              <PaymentRow id="crypto"  selected={paymentMethod === 'crypto'}  onClick={() => setPaymentMethod('crypto')}  title="Cryptocurrency (USDT, USDC, BTC)" caption="Order activates after on-chain confirmation." />
              <PaymentRow id="card"    selected={paymentMethod === 'card'}    onClick={() => setPaymentMethod('card')}    title="Card · Visa •• 4242"                caption="Mock card — instant activation in this prototype." />
              {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <button className="btn" onClick={() => setStep('details')}>← Edit order</button>
                <button className="btn primary" disabled={busy || (paymentMethod === 'balance' && !balanceOk)} onClick={() => placeOrder(paymentMethod)}>
                  {busy ? 'Processing…' : `Pay ${money(total)}`}
                </button>
              </div>
            </div>
          </div>
          <OrderSummary plan={plan} qty={qty} total={total} />
        </div>
      )}
      {step === 'processing' && (
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: 'center', maxWidth: 560, marginInline: 'auto' }}>
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Awaiting payment</h2>
          <div style={{ fontSize: 22, color: 'var(--text)', fontWeight: 700, margin: '12px 0' }}>{money(total)} ≈ {total} USDT</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', padding: 12, background: 'var(--surface-2)', borderRadius: 8, marginTop: 12 }}>TRX…6Hb (mock wallet address)</div>
          <div style={{ marginTop: 18 }}>
            <button className="btn primary" disabled={busy} onClick={confirmCrypto}>{busy ? 'Confirming…' : "I've sent the payment"}</button>
            <button className="btn" style={{ marginLeft: 8 }} onClick={() => setStep('payment')}>Back to payment method</button>
          </div>
          <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--muted)' }}>(Production uses webhook confirmations.)</div>
        </div>
      )}
      {step === 'success' && (
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: 'center', maxWidth: 560, marginInline: 'auto' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-dim)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 28 }}>✓</div>
          <h2 style={{ marginTop: 16, color: 'var(--text)' }}>{plan.autoProvision ? 'Order confirmed' : 'Order received'}</h2>
          {orderId && <div className="mono" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{orderId}</div>}
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>{plan.name} · qty {qty} · {money(total)}</div>
          {!plan.autoProvision && <div className="chip warning" style={{ marginTop: 14 }}>Typical delivery within 24h</div>}
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 8 }}>
            {orderId && <Link href={`/orders/${orderId}`} className="btn primary">{plan.autoProvision ? 'Order details' : 'Track this order'}</Link>}
            <Link href="/proxies" className="btn">View my proxies</Link>
          </div>
        </div>
      )}
      {step === 'failed' && (
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: 'center', maxWidth: 560, marginInline: 'auto' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--danger-dim)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 28 }}>!</div>
          <h2 style={{ marginTop: 16, color: 'var(--text)' }}>Payment failed</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{err ?? 'Something went wrong.'}</div>
          <button className="btn primary" style={{ marginTop: 18 }} onClick={() => setStep('payment')}>Retry payment</button>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: string }) {
  const steps = ['details', 'payment', step === 'success' ? 'success' : step === 'processing' ? 'processing' : 'done'];
  const idx = step === 'details' ? 0 : step === 'payment' ? 1 : 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
      {['Details', 'Payment', 'Done'].map((label, i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: i <= idx ? 'var(--cta)' : 'var(--surface-2)',
            color: i <= idx ? 'white' : 'var(--muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
          }}>{i + 1}</div>
          <span style={{ fontSize: 12.5, color: i <= idx ? 'var(--text)' : 'var(--muted)', fontWeight: 500 }}>{label}</span>
          {i < 2 && <div style={{ width: 24, height: 2, background: 'var(--surface-3)' }} />}
        </div>
      ))}
    </div>
  );
}

function OrderSummary({ plan, qty, total, cta, onClick }: { plan: PlanSummary; qty: number; total: number; cta?: string; onClick?: () => void }) {
  return (
    <div className="panel" style={{ alignSelf: 'start' }}>
      <div className="panel-header"><span className="panel-title">Order summary</span></div>
      <div className="panel-body">
        <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{plan.name}</span></div>
        <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{plan.region}</span></div>
        <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
        <div className="kv-row"><span className="kv-label">Price / proxy</span><span className="kv-val">{money(plan.price)}</span></div>
        <div className="kv-row total"><span className="kv-label">Total</span><span className="kv-val">{money(total)}</span></div>
      </div>
      {cta && <div style={{ padding: '0 16px 16px' }}><button onClick={onClick} className="btn primary" style={{ width: '100%' }}>{cta} →</button></div>}
    </div>
  );
}

function PaymentRow({ id, selected, disabled, onClick, title, caption }: { id: string; selected: boolean; disabled?: boolean; onClick: () => void; title: string; caption: string }) {
  return (
    <div onClick={disabled ? undefined : onClick}
      style={{
        padding: 14, borderRadius: 'var(--radius-md)',
        border: `1px solid ${selected ? 'var(--cta)' : 'var(--border)'}`,
        background: selected ? 'var(--cta-dim)' : 'var(--surface-2)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{caption}</div>
    </div>
  );
}
