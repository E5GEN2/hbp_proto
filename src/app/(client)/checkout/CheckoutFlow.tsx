'use client';
import { useState, useMemo, Fragment, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/money';
import { useToast } from '@/components/ui/Toast';
import { durationLabel, tierFeatures } from '@/lib/catalog';

type PlanSummary = { id: string; name: string; region: string; carrier: string; price: number; autoProvision: boolean; description: string; available: number };

const WALLET = 'TRX9aB7eFmZxXk4mPzRq8nGdLcVtJwS6Hb';
const WALLET_SHORT = WALLET.slice(0, 8) + '…' + WALLET.slice(-6);

const IconCheck = () => <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>;
const IconBitcoin = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 7v10M9 12h5a2 2 0 100-4H9M9 12h5.5a2 2 0 110 4H9" /></svg>;
const IconWallet = () => <svg viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a2 2 0 002 2h16a1 1 0 001-1V8a1 1 0 00-1-1zM3 7V6a2 2 0 012-2h13" /><circle cx="17" cy="13" r="1.5" fill="currentColor" /></svg>;
const IconCard = () => <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>;
const IconQr = () => <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M14 20h3M20 14v7M17 17v4" /></svg>;
const IconWarning = () => <svg viewBox="0 0 24 24"><path d="M12 2l11 19H1L12 2z" /><path d="M12 9v5M12 17.5h.01" /></svg>;

export function CheckoutFlow({
  duration, qty: qtyInit, autoExtend: autoExtendInit, location: locationInit, step: stepInit, balance, plans, allowCard = true, renewOf,
}: {
  duration: number;
  qty: number;
  autoExtend: boolean;
  location: string;
  step: 'details' | 'payment' | 'processing' | 'success' | 'failed';
  balance: number;
  plans: PlanSummary[];
  allowCard?: boolean;
  renewOf?: string; // renewal mode: paying extends this order — location/qty locked
}) {
  const router = useRouter();
  const toast = useToast();
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
  const label = durationLabel(duration);
  const depositLink = `/checkout?kind=deposit&returnTo=${encodeURIComponent(`/checkout?duration=${duration}&step=payment`)}`;

  async function placeOrder(method: 'balance' | 'crypto' | 'card') {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/checkout/place', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, qty, autoExtend, paymentMethod: method, ...(renewOf ? { renewOf } : {}) }),
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

  async function copyWallet() {
    try { await navigator.clipboard.writeText(WALLET); toast('Copied', 'Wallet address', 'success'); }
    catch { toast('Copy failed', 'Clipboard unavailable', 'danger'); }
  }

  const summaryRows = (
    <div className="panel-body flush">
      <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{label} · Mobile</span></div>
      <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{plan.region}</span></div>
      <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
      <div className="kv-row"><span className="kv-label">Price per proxy</span><span className="kv-val">{money(plan.price)}</span></div>
      <div className="kv-row total"><span className="kv-label">Total Price</span><span className="kv-val">{money(total)}</span></div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      {(step === 'details' || step === 'payment' || step === 'processing') && (
        <Stepper active={step === 'details' ? 1 : 2} />
      )}

      {step === 'details' && (
        <div className="grid-detail checkout-details">
          <div className="grid-left">
            <div className="checkout-details-row">
              <div className="panel">
                <div className="panel-header"><span className="panel-title">{label} · Mobile proxies</span></div>
                <div className="panel-body">
                  <div className="duration-meta">
                    <div>
                      <div className="duration-price">{money(plan.price)}</div>
                      <div className="duration-price-suffix">per proxy</div>
                    </div>
                  </div>
                  <ul className="plan-card-features">
                    {tierFeatures(duration).map(f => <li key={f}>{f}</li>)}
                  </ul>
                </div>
                <div className="panel-footer">
                  <span className="toggle-row-title" style={{ flex: 1 }}>Auto-extend this order when it expires</span>
                  <span className={`toggle ${autoExtend ? 'on' : ''}`} onClick={() => setAutoExtend(v => !v)} style={{ cursor: 'pointer' }} role="switch" aria-checked={autoExtend} />
                </div>
              </div>

              {renewOf ? (
                <div className="checkout-side-stack">
                  <div className="panel">
                    <div className="panel-header"><span className="panel-title">Renewal</span></div>
                    <div className="panel-body">
                      <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val">{renewOf}</span></div>
                      <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{plan.region}</span></div>
                      <div className="kv-row"><span className="kv-label">Proxies</span><span className="kv-val">{qty}</span></div>
                      <div className="help-text" style={{ marginTop: 10 }}>
                        Same proxies and location — the new {label} term starts when the current one ends.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="checkout-side-stack">
                <div className="panel">
                  <div className="panel-header"><span className="panel-title">Location</span></div>
                  <div className="panel-body">
                    <select className="form-select" value={location} onChange={e => setLocation(e.target.value)}>
                      {plans.map(p => (
                        <option key={p.id} value={p.region} disabled={p.available === 0}>
                          {p.region}{p.available > 0 && p.available <= 3 ? ' · limited' : ''}{p.available === 0 ? ' (sold out)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="help-text">Choose where your proxies are based.</div>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-header"><span className="panel-title">Quantity</span></div>
                  <div className="panel-body">
                    <div className="qty-stepper">
                      <button className="qty-btn" aria-label="Decrease" disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                      <input className="qty-input" type="text" value={qty} readOnly />
                      <button className="qty-btn" aria-label="Increase" disabled={qty >= plan.available} onClick={() => setQty(q => Math.min(plan.available, q + 1))}>+</button>
                    </div>
                    <div className="help-text">Up to {plan.available} {plan.available === 1 ? 'proxy' : 'proxies'} available at this location.</div>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>

          <div className="grid-right">
            <div className="panel order-summary">
              <div className="panel-header"><span className="panel-title">Order Summary</span></div>
              {summaryRows}
              <div className="panel-footer">
                <button className="btn primary block" disabled={plan.available === 0} onClick={() => setStep('payment')}>Continue to Checkout →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'payment' && (
        <div className="grid-detail">
          <div className="grid-left">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Payment method</span></div>
              <div className="panel-body">
                <PayRow icon={<IconBitcoin />} selected={paymentMethod === 'crypto'} onClick={() => setPaymentMethod('crypto')}
                  title="Crypto (USDT-TRC20, BTC, ETH)" caption={<>Order activates after on-chain confirmation.</>} />
                <PayRow icon={<IconWallet />} selected={paymentMethod === 'balance'} disabled={!balanceOk} onClick={() => setPaymentMethod('balance')}
                  title="Account balance" caption={<>Your balance: <strong>{money(balance)}</strong>{!balanceOk && <> · <Link href={depositLink}>Add funds</Link></>}</>} />
                {allowCard && <PayRow icon={<IconCard />} selected={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')}
                  title="Card · Visa •• 4242" caption={<>Mock card — instant activation in this prototype.</>} />}
                {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{err}</div>}
              </div>
              <div className="panel-footer payment-actions">
                <button className="btn" onClick={() => setStep('details')}>← Edit order</button>
                <button className="btn primary" disabled={busy || (paymentMethod === 'balance' && !balanceOk)} onClick={() => placeOrder(paymentMethod)}>
                  {busy ? 'Processing…' : 'Buy now'}
                </button>
              </div>
            </div>
          </div>
          <div className="grid-right">
            <div className="panel order-summary">
              <div className="panel-header"><span className="panel-title">Order Summary</span></div>
              {summaryRows}
            </div>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="checkout-processing">
          <div className="panel checkout-processing-card">
            <div className="processing-title">Awaiting payment</div>
            <div className="processing-amount">{money(total)} <span className="muted">≈ {total} USDT</span></div>
            <div className="processing-qr"><IconQr /></div>
            <div className="processing-wallet">
              <span className="wallet-label">Send USDT-TRC20 to</span>
              <div className="creds-row">
                <pre className="export-preview" title={WALLET}>{WALLET_SHORT}</pre>
                <div className="creds-actions"><button className="btn" onClick={copyWallet}>Copy</button></div>
              </div>
            </div>
            <div className="processing-actions">
              <button className="btn primary" disabled={busy} onClick={confirmCrypto}>{busy ? 'Confirming…' : "I've sent the payment"}</button>
              <button className="btn ghost" onClick={() => setStep('payment')}>← Back to payment method</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Production uses webhook confirmations.</div>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="checkout-success">
          <div className="success-icon"><IconCheck /></div>
          <div className="success-title">{renewOf ? 'Order renewed' : plan.autoProvision ? 'Order confirmed' : 'Order received'}</div>
          {!renewOf && !plan.autoProvision && (
            <div className="success-helper">Our team is preparing your proxies. Typical delivery within 24 hours — we&rsquo;ll notify you the moment they&rsquo;re live.</div>
          )}
          <div className="success-summary">
            {orderId && <div className="kv-row"><span className="kv-label">Order ID</span><span className="kv-val"><Link className="td-link" href={`/orders/${orderId}`}>{orderId}</Link></span></div>}
            <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{label} · {plan.region}</span></div>
            <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
            <div className="kv-row total"><span className="kv-label">Total Price</span><span className="kv-val">{money(total)}</span></div>
          </div>
          <div className="success-actions">
            {orderId && <Link href={`/orders/${orderId}`} className="btn primary">{plan.autoProvision ? 'Order details' : 'Track this order'}</Link>}
            <Link href="/proxies" className="btn">View my proxies</Link>
          </div>
        </div>
      )}

      {step === 'failed' && (
        <div className="checkout-failed">
          <div className="failed-icon"><IconWarning /></div>
          <div className="failed-title">Payment failed</div>
          <div className="failed-message">{err ?? 'We were unable to complete your payment. Please try again or contact support.'}</div>
          <div className="failed-actions">
            <button className="btn primary" onClick={() => setStep('payment')}>Retry payment</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ active }: { active: 1 | 2 }) {
  const steps = [
    { num: 1, label: 'Details' },
    { num: 2, label: 'Payment' },
    { num: 3, label: 'Done' },
  ];
  return (
    <div className="checkout-stepper">
      <div className="wizard-stepper">
        {steps.map((s, i) => (
          <Fragment key={s.num}>
            {i > 0 && <div className="wizard-sep" />}
            <div className={`wizard-step ${s.num < active ? 'done' : s.num === active ? 'active' : ''}`}>
              <div className="wizard-step-num">{s.num < active ? <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg> : s.num}</div>
              <div className="wizard-step-label">{s.label}</div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PayRow({ icon, selected, disabled, onClick, title, caption }: {
  icon: ReactNode; selected: boolean; disabled?: boolean; onClick: () => void; title: string; caption: ReactNode;
}) {
  return (
    <label className={`pay-method-row ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`} onClick={disabled ? undefined : onClick}>
      <input type="radio" name="payMethod" checked={selected} disabled={disabled} readOnly />
      <div className="pay-method-icon">{icon}</div>
      <div className="pay-method-text">
        <div className="pay-method-title">{title}</div>
        <div className="pay-method-caption">{caption}</div>
      </div>
    </label>
  );
}
