'use client';
import { useState, useTransition, Fragment, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { money } from '@/lib/money';
import { depositAction } from '@/lib/client-actions';

const PRESETS = [25, 50, 100, 250];
const WALLET = 'TRX9aB7eFmZxXk4mPzRq8nGdLcVtJwS6Hb';
const WALLET_SHORT = WALLET.slice(0, 8) + '…' + WALLET.slice(-6);

const IconCheck = () => <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>;
const IconBitcoin = () => <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 7v10M9 12h5a2 2 0 100-4H9M9 12h5.5a2 2 0 110 4H9" /></svg>;
const IconCard = () => <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>;
const IconQr = () => <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M14 20h3M20 14v7M17 17v4" /></svg>;

export function DepositFlow({ presetAmount, returnTo, allowCard = true }: { presetAmount?: number; returnTo?: string; allowCard?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState<number | ''>(presetAmount && PRESETS.includes(presetAmount) ? presetAmount : (presetAmount ?? 50));
  const [method, setMethod] = useState<'card' | 'crypto'>(allowCard ? 'card' : 'crypto');
  const [step, setStep] = useState<'details' | 'payment' | 'processing' | 'success'>(presetAmount ? 'payment' : 'details');
  const [pending, start] = useTransition();
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const amountNum = typeof amount === 'number' ? amount : parseFloat(amount);
  const ok = !isNaN(amountNum) && amountNum >= 1 && amountNum <= 10000;

  function pay() {
    if (!ok) return toast('Invalid amount', 'Must be between $1 and $10,000', 'warning');
    start(async () => {
      try {
        const r = await depositAction({ amount: amountNum, method });
        setPaymentId(r.paymentId);
        if (r.instant) {
          setStep('success');
          router.refresh();
        } else {
          setStep('processing');
        }
      } catch (e: any) { toast('Deposit failed', e.message, 'danger'); }
    });
  }

  async function copyWallet() {
    try { await navigator.clipboard.writeText(WALLET); toast('Copied', 'Wallet address', 'success'); }
    catch { toast('Copy failed', 'Clipboard unavailable', 'danger'); }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {(step === 'details' || step === 'payment' || step === 'processing') && (
        <Stepper active={step === 'details' ? 1 : 2} />
      )}

      {step === 'details' && (
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Add funds</span></div>
          <div className="panel-body">
            <label className="form-label">Amount</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {PRESETS.map(p => (
                <button key={p} onClick={() => setAmount(p)}
                  className={`pay-method-row ${amount === p ? 'selected' : ''}`}
                  style={{ flex: '1 1 0', minWidth: 92, justifyContent: 'center', marginBottom: 0, fontWeight: 600 }}>
                  {money(p)}
                </button>
              ))}
            </div>
            <input className="form-input mono" type="number" min={1} max={10000} step={1} value={amount}
              onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Custom amount" />
            <div className="help-text">Enter any amount between $1 and $10,000.</div>
          </div>
          <div className="panel-footer" style={{ justifyContent: 'space-between' }}>
            <Link href={returnTo ?? '/billing'} className="btn">← {returnTo ? 'Back' : 'Cancel'}</Link>
            <button className="btn primary" disabled={!ok} onClick={() => setStep('payment')}>Continue · {money(amountNum)} →</button>
          </div>
        </div>
      )}

      {step === 'payment' && (
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Payment method</span></div>
          <div className="panel-body">
            {allowCard && <PayRow icon={<IconCard />} selected={method === 'card'} onClick={() => setMethod('card')}
              title="Card · Visa •• 4242" caption="Mock card — instant top-up in this prototype." />}
            <PayRow icon={<IconBitcoin />} selected={method === 'crypto'} onClick={() => setMethod('crypto')}
              title="Crypto (USDT-TRC20, BTC, ETH)" caption="On-chain confirmation required." />
          </div>
          <div className="panel-footer payment-actions">
            <button className="btn" onClick={() => setStep('details')}>← Back</button>
            <button className="btn primary" disabled={pending} onClick={pay}>{pending ? 'Processing…' : `Pay ${money(amountNum)}`}</button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="checkout-processing">
          <div className="panel checkout-processing-card">
            <div className="processing-title">Awaiting payment</div>
            <div className="processing-amount">{money(amountNum)} <span className="muted">≈ {amountNum} USDT</span></div>
            <div className="processing-qr"><IconQr /></div>
            <div className="processing-wallet">
              <span className="wallet-label">Send USDT-TRC20 to</span>
              <div className="creds-row">
                <pre className="export-preview" title={WALLET}>{WALLET_SHORT}</pre>
                <div className="creds-actions"><button className="btn" onClick={copyWallet}>Copy</button></div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Crypto deposits await on-chain confirmation. Once confirmed, your balance updates automatically.</div>
            <Link href={returnTo ?? '/billing'} className="btn ghost">Back to {returnTo ? 'checkout' : 'billing'}</Link>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="checkout-success">
          <div className="success-icon"><IconCheck /></div>
          <div className="success-title">Deposit confirmed</div>
          <div className="success-summary">
            {paymentId && <div className="kv-row"><span className="kv-label">Payment ID</span><span className="kv-val mono">{paymentId}</span></div>}
            <div className="kv-row total"><span className="kv-label">Added to balance</span><span className="kv-val">{money(amountNum)}</span></div>
          </div>
          <div className="success-actions">
            <Link href={returnTo ?? '/billing'} className="btn primary">Back to {returnTo ? 'checkout' : 'billing'}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ active }: { active: 1 | 2 }) {
  const steps = [
    { num: 1, label: 'Amount' },
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

function PayRow({ icon, selected, onClick, title, caption }: {
  icon: ReactNode; selected: boolean; onClick: () => void; title: string; caption: ReactNode;
}) {
  return (
    <label className={`pay-method-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <input type="radio" name="depositMethod" checked={selected} readOnly />
      <div className="pay-method-icon">{icon}</div>
      <div className="pay-method-text">
        <div className="pay-method-title">{title}</div>
        <div className="pay-method-caption">{caption}</div>
      </div>
    </label>
  );
}
