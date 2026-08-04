'use client';
import { useState, useMemo, Fragment, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/money';
import { useToast } from '@/components/ui/Toast';
import { durationLabel, tierFeatures, planDisplayName } from '@/lib/catalog';
import { FormSelect } from '@/components/ui/FormSelect';
import { CryptoPayPanel, CoinSelect, useCoinList, type PayPanelData } from '@/components/client/CryptoPayPanel';
import { CompletePaymentActions } from './CompletePaymentActions';
import { signalStructural } from '@/lib/nav-history';

type PlanSummary = { id: string; name: string; region: string; carrier: string; price: number; autoProvision: boolean; available: number };

const WALLET = 'TRX9aB7eFmZxXk4mPzRq8nGdLcVtJwS6Hb';
const WALLET_SHORT = WALLET.slice(0, 8) + '…' + WALLET.slice(-6);

const IconBitcoin = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 7v10M9 12h5a2 2 0 100-4H9M9 12h5.5a2 2 0 110 4H9" /></svg>;
const IconWallet = () => <svg viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a2 2 0 002 2h16a1 1 0 001-1V8a1 1 0 00-1-1zM3 7V6a2 2 0 012-2h13" /><circle cx="17" cy="13" r="1.5" fill="currentColor" /></svg>;
const IconCard = () => <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>;
const IconQr = () => <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M14 20h3M20 14v7M17 17v4" /></svg>;
const IconWarning = () => <svg viewBox="0 0 24 24"><path d="M12 2l11 19H1L12 2z" /><path d="M12 9v5M12 17.5h.01" /></svg>;

export function CheckoutFlow({
  duration, qty: qtyInit, autoExtend: autoExtendInit, location: locationInit, step: stepInit, balance, plans, allowCard = true, allowCrypto = true, renewOf, renewalDiscountPct = 0,
}: {
  duration: number;
  qty: number;
  autoExtend: boolean;
  location: string;
  step: 'details' | 'payment' | 'processing' | 'failed';
  balance: number;
  plans: PlanSummary[];
  allowCard?: boolean;
  allowCrypto?: boolean; // admin Payment Providers toggle (crypto)
  renewOf?: string; // renewal mode: paying extends this order — location/qty locked
  renewalDiscountPct?: number; // >0 in renewal mode when the plan grants a discount (price already discounted)
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

  // In-portal crypto (NP direct payments): coin picked in the payment step;
  // payData present → the processing step renders the in-portal pay panel
  // instead of the legacy dev-mock wallet. Empty coin list = NP not configured
  // → the legacy mock flow stays intact.
  const [payCoin, setPayCoin] = useState<string | null>(null);
  const [payData, setPayData] = useState<PayPanelData | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  // Duplicate-unpaid-order interstitial (409): resolve in place on the wizard
  // instead of a silent teleport to a back-less resume page (trace find #10).
  const [dupOrderId, setDupOrderId] = useState<string | null>(null);
  // Recent-identical-PAID-order confirm (accidental double-charge backstop).
  const [dupPaidId, setDupPaidId] = useState<string | null>(null);
  const coinList = useCoinList(step === 'payment' || step === 'processing');
  const directCrypto = (coinList.coins?.length ?? 0) > 0;

  const plan = useMemo(() => plans.find(p => p.region === location) ?? plans[0], [plans, location]);
  const total = plan.price * qty;
  const balanceOk = balance >= total;
  const label = durationLabel(duration);
  // Deposit round-trip must preserve the CONFIGURED cart (trace finds #6/#14/#16):
  // renewOf is load-bearing (its absence turns a renewal into a brand-new order);
  // qty/location/autoExtend live only in client state and would otherwise reset
  // on return. page.tsx already reads all of these back from searchParams.
  const returnTo = renewOf
    ? `/checkout?renewOf=${renewOf}&step=payment`
    : `/checkout?duration=${duration}&qty=${qty}&location=${encodeURIComponent(location)}&autoExtend=${autoExtend ? '1' : '0'}&step=payment`;
  const depositLink = `/checkout?kind=deposit&returnTo=${encodeURIComponent(returnTo)}`;

  // Addressable confirmation URL (trace find #3/#8): instant + settled crypto
  // land here instead of transient wizard state, so reload/Back shows the
  // confirmation, not a blank buy form.
  const successUrl = (id: string) => `/checkout?success=${id}${renewOf ? '&renewed=1' : ''}`;

  async function placeOrder(method: 'balance' | 'crypto' | 'card', opts?: { confirmDuplicate?: boolean }) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/checkout/place', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id, qty, autoExtend, paymentMethod: method,
          ...(method === 'crypto' && payCoin ? { payCoin } : {}),
          ...(opts?.confirmDuplicate ? { confirmDuplicate: true } : {}),
          ...(renewOf ? { renewOf } : {}),
        }),
      });
      // A crashed route returns non-JSON — surface the HTTP status instead of
      // the parser's cryptic message (Safari: "string did not match…").
      const j = await r.json().catch(() => ({} as any));
      // 409, two shapes: (a) an identical order was PAID moments ago → confirm
      // before charging again (accidental double-charge backstop); (b) an
      // UNPAID order for this plan exists → resolve it in the wizard rather than
      // silently teleporting to a back-less resume page (trace find #10).
      if (r.status === 409 && j.needsConfirm && j.recentOrderId) {
        setDupPaidId(j.recentOrderId);
        return;
      }
      if (r.status === 409 && j.orderId) {
        setDupOrderId(j.orderId);
        return;
      }
      if (!r.ok) throw new Error(j.error ?? `Order failed (HTTP ${r.status}) — please try again or contact support.`);
      setOrderId(j.orderId);
      // Real crypto: the response carries the in-portal payment (address /
      // amount / expiry) — pay right here, settlement arrives via webhook.
      if (j.payment) {
        setPayData(j.payment);
        setStep('processing');
        return;
      }
      // Legacy dev-mock crypto (no processor) stays in the wizard wallet step.
      if (method === 'crypto') { setStep('processing'); return; }
      // Instant balance/card → the addressable confirmation URL (not transient
      // wizard state). replace() drops the wizard from history so Back doesn't
      // return to a re-submittable form.
      router.replace(successUrl(j.orderId));
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
      if (orderId) router.replace(successUrl(orderId));
    } catch (e: any) { setErr(e.message); setStep('failed'); }
    finally { setBusy(false); }
  }

  async function copyWallet() {
    try { await navigator.clipboard.writeText(WALLET); toast('Copied', 'Wallet address', 'success'); }
    catch { toast('Copy failed', 'Clipboard unavailable', 'danger'); }
  }

  // Fixed-rate window expired mid-checkout: issue a fresh charge for the SAME
  // order (same coin) — /api/checkout/repay re-arms it without re-placing.
  async function regenerate() {
    if (!orderId) return;
    const coinCode = payData?.payCurrency ?? payCoin;
    if (!coinCode) return;
    setRegenBusy(true);
    try {
      const r = await fetch('/api/checkout/repay', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, payCoin: coinCode }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error ?? 'Could not create a new payment — please try again.');
      setPayData(j.payment);
    } catch (e: any) {
      toast('Failed', e.message, 'danger');
    } finally { setRegenBusy(false); }
  }

  const summaryRows = (
    <div className="panel-body flush">
      <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{planDisplayName(duration)}</span></div>
      <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{plan.region}</span></div>
      <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
      <div className="kv-row"><span className="kv-label">Price per proxy</span><span className="kv-val">{money(plan.price)}</span></div>
      <div className="kv-row total"><span className="kv-label">Total Price</span><span className="kv-val">{money(total)}</span></div>
    </div>
  );

  // Recent-identical-PAID confirm (accidental double-charge backstop): let the
  // buyer view the order they just placed, or deliberately place another.
  if (dupPaidId) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="checkout-processing">
          <div className="panel checkout-processing-card">
            <div className="processing-title">You just placed an identical order</div>
            <div className="t-note" style={{ maxWidth: 420 }}>
              Order <span className="mono">{dupPaidId}</span> (same plan, quantity and location) was placed less than 2 minutes ago. Did you mean to order again?
            </div>
            <div className="processing-actions">
              <Link href={`/orders/${dupPaidId}`} className="btn primary" onClick={signalStructural}>View that order</Link>
              <button className="btn" disabled={busy} onClick={() => { setDupPaidId(null); placeOrder(paymentMethod, { confirmDuplicate: true }); }}>
                {busy ? 'Processing…' : 'Place another anyway'}
              </button>
              <button className="btn ghost" onClick={() => setDupPaidId(null)}>← Back to checkout</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Duplicate-unpaid interstitial (409): resolve on the trusted checkout surface
  // instead of teleporting to a back-less resume page (trace find #10).
  if (dupOrderId) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="checkout-processing">
          <div className="panel checkout-processing-card">
            <div className="processing-title">A payment is already awaiting</div>
            <div className="t-note" style={{ maxWidth: 420 }}>
              Order <span className="mono">{dupOrderId}</span> has a payment awaiting confirmation. Finish it before placing another.
            </div>
            <div className="processing-actions">
              <Link href={`/checkout?resume=${dupOrderId}`} className="btn primary">Complete that payment</Link>
              <button className="btn ghost" onClick={() => setDupOrderId(null)}>← Back to checkout</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                <div className="panel-body flush">
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
                      {renewalDiscountPct > 0 && (
                        <div className="kv-row"><span className="kv-label">Renewal discount</span><span className="kv-val" style={{ color: 'var(--success)' }}>−{renewalDiscountPct}% applied</span></div>
                      )}
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
                    <FormSelect
                      value={location}
                      onChange={setLocation}
                      options={plans.map(p => ({
                        value: p.region,
                        label: `${p.region}${p.available > 0 && p.available <= 3 ? ' · limited' : ''}${p.available === 0 ? ' (sold out)' : ''}`,
                        disabled: p.available === 0,
                      }))}
                    />
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
                {allowCrypto && (
                  <>
                    <PayRow icon={<IconBitcoin />} selected={paymentMethod === 'crypto'} onClick={() => setPaymentMethod('crypto')}
                      title="Crypto" caption={<>Order activates after on-chain confirmation.</>} />
                    {paymentMethod === 'crypto' && (
                      <CoinSelect totalUsd={total} value={payCoin} onChange={setPayCoin}
                        coins={coinList.coins} loading={coinList.loading} error={coinList.error} onRetry={coinList.retry} />
                    )}
                  </>
                )}
                <PayRow icon={<IconWallet />} selected={paymentMethod === 'balance'} disabled={!balanceOk} onClick={() => setPaymentMethod('balance')}
                  title="Account balance" caption={<>Your balance: <strong>{money(balance)}</strong>{!balanceOk && <> · <Link href={depositLink}>Add funds</Link></>}</>} />
                {allowCard && <PayRow icon={<IconCard />} selected={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')}
                  title="Card · Visa •• 4242" caption={<>Mock card — instant activation in this prototype.</>} />}
                {err && <div className="t-note" style={{ color: 'var(--danger)', marginTop: 10 }}>{err}</div>}
              </div>
              <div className="panel-footer payment-actions">
                <button className="btn" onClick={() => setStep('details')}>← Edit order</button>
                <button className="btn primary"
                  /* coinList.error ≠ NP-off: a failed fetch must not arm the
                     button coin-less (the server would 400) — Retry first. */
                  disabled={busy || (paymentMethod === 'balance' && !balanceOk) || (paymentMethod === 'crypto' && (coinList.loading || coinList.error || (directCrypto && !payCoin)))}
                  onClick={() => placeOrder(paymentMethod)}>
                  {busy ? 'Processing…' : paymentMethod === 'crypto' && directCrypto && !payCoin ? 'Pick a coin to continue' : 'Buy now'}
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

      {step === 'processing' && payData && (
        <CryptoPayPanel
          key={payData.paymentId}
          pay={payData}
          amountUsd={total}
          title="Complete your payment"
          onSettled={() => orderId && router.replace(successUrl(orderId))}
          onRegenerate={regenerate}
          regenerating={regenBusy}
        >
          {/* Same info card as the resume interstitial (owner item 5): the
              order at a glance + cancel + a way back. */}
          {orderId && (
            <>
              <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', padding: '4px 0' }}>
                <div className="kv-row"><span className="kv-label">{renewOf ? 'Renews order' : 'Order'}</span><span className="kv-val mono">{orderId}</span></div>
                <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{planDisplayName(duration)}</span></div>
                <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{plan.region}</span></div>
                <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
              </div>
              {/* Cancelling is only meaningful for the unpaid NEW order — a
                  renewal charge must not offer to cancel the paid original. */}
              {!renewOf && <CompletePaymentActions orderId={orderId} payUrl={null} />}
              {/* Forward nav to an order the buyer hasn't visited — "View order",
                  not "← Back to" (trace find #5); structural so the order page
                  doesn't inherit a stale "← Back to Checkout" (trace find #4). */}
              <Link href={`/orders/${orderId}`} className="btn ghost" onClick={signalStructural}>View order</Link>
            </>
          )}
        </CryptoPayPanel>
      )}

      {step === 'processing' && !payData && (
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
            <div className="t-note">Production uses webhook confirmations.</div>
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
