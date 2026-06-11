'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { money } from '@/lib/money';
import { depositAction } from '@/lib/client-actions';

const PRESETS = [25, 50, 100, 250];

export function DepositFlow({
  presetAmount, returnTo,
}: { presetAmount?: number; returnTo?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState<number | ''>(presetAmount && PRESETS.includes(presetAmount) ? presetAmount : (presetAmount ?? 50));
  const [method, setMethod] = useState<'card' | 'crypto'>('card');
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
        // Crypto: redirect to the NOWPayments hosted invoice; the IPN webhook
        // credits the balance after on-chain confirmation.
        if (r.invoiceUrl) {
          window.location.href = r.invoiceUrl;
          return;
        }
        if (r.instant) {
          setStep('success');
          router.refresh();
        } else {
          setStep('processing');
        }
      } catch (e: any) { toast('Deposit failed', e.message, 'danger'); }
    });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
        {['Amount', 'Payment', 'Done'].map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: (step === 'details' ? 0 : step === 'payment' ? 1 : 2) >= i ? 'var(--cta)' : 'var(--surface-2)',
              color: (step === 'details' ? 0 : step === 'payment' ? 1 : 2) >= i ? 'white' : 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
            }}>{i + 1}</div>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
            {i < 2 && <div style={{ width: 24, height: 2, background: 'var(--surface-3)' }} />}
          </div>
        ))}
      </div>

      {step === 'details' && (
        <div className="panel" style={{ marginTop: 16, padding: 24 }}>
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Add funds</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button key={p}
                onClick={() => setAmount(p)}
                className="chip"
                style={{
                  padding: '8px 18px', fontSize: 14, cursor: 'pointer',
                  background: amount === p ? 'var(--cta-dim)' : 'var(--surface-2)',
                  color: amount === p ? 'var(--cta)' : 'var(--text)',
                  fontWeight: 600,
                  outline: amount === p ? '2px solid var(--cta)' : 'none',
                }}>{money(p)}</button>
            ))}
          </div>
          <label className="form-label">Custom amount</label>
          <input className="form-input mono" type="number" min={1} max={10000} step={1} value={amount}
            onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
            {returnTo
              ? <Link href={returnTo} className="btn">← Back</Link>
              : <Link href="/billing" className="btn">← Cancel</Link>}
            <button className="btn primary" disabled={!ok} onClick={() => setStep('payment')}>
              Continue · {money(amountNum)} →
            </button>
          </div>
        </div>
      )}

      {step === 'payment' && (
        <div className="panel" style={{ marginTop: 16, padding: 24 }}>
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Payment method</h2>
          <PayRow id="card"   selected={method === 'card'}   onClick={() => setMethod('card')}   title="Card · Visa •• 4242" caption="Mock card — instant top-up in this prototype" />
          <PayRow id="crypto" selected={method === 'crypto'} onClick={() => setMethod('crypto')} title="Cryptocurrency (USDT, USDC, BTC)" caption="On-chain confirmation required" />
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setStep('details')}>← Back</button>
            <button className="btn primary" disabled={pending} onClick={pay}>{pending ? 'Processing…' : `Pay ${money(amountNum)}`}</button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Awaiting payment</h2>
          <div style={{ fontSize: 22, color: 'var(--text)', fontWeight: 700, margin: '12px 0' }}>{money(amountNum)} ≈ {amountNum} USDT</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', padding: 12, background: 'var(--surface-2)', borderRadius: 8, marginTop: 12 }}>TRX…6Hb (mock wallet)</div>
          <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--muted)' }}>Crypto deposits await on-chain confirmation. Once confirmed, balance updates automatically.</div>
          <Link href="/billing" className="btn" style={{ marginTop: 18 }}>Back to billing</Link>
        </div>
      )}

      {step === 'success' && (
        <div className="panel" style={{ marginTop: 16, padding: 32, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-dim)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 28 }}>✓</div>
          <h2 style={{ marginTop: 16, color: 'var(--text)' }}>Deposit confirmed</h2>
          {paymentId && <div className="mono" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{paymentId}</div>}
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>{money(amountNum)} added to your balance</div>
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 8 }}>
            {returnTo
              ? <Link href={returnTo} className="btn primary">Back to checkout</Link>
              : <Link href="/billing" className="btn primary">Back to billing</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

function PayRow({ id, selected, onClick, title, caption }: { id: string; selected: boolean; onClick: () => void; title: string; caption: string }) {
  return (
    <div onClick={onClick}
      style={{
        padding: 14, marginBottom: 10, borderRadius: 'var(--radius-md)',
        border: `1px solid ${selected ? 'var(--cta)' : 'var(--border)'}`,
        background: selected ? 'var(--cta-dim)' : 'var(--surface-2)',
        cursor: 'pointer',
      }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{caption}</div>
    </div>
  );
}
