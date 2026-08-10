'use client';
import Link from 'next/link';
import { money } from '@/lib/money';
import { signalStructural } from '@/lib/nav-history';

// Addressable deposit-confirmation surface — the deposit twin of
// CheckoutSuccess (owner 2026-08-10: settling a top-up must show a
// confirmation window, not silently redirect to Billing). Rendered by the
// server on /checkout?kind=deposit&resume=PAY-… once the payment row is
// CONFIRMED, so a reload or Back lands right back here, idempotent.
// When the deposit was started mid-checkout (returnTo), the primary CTA
// resumes that purchase — the whole point of the returnTo flow (PR #127).
export function DepositSuccess({ paymentId, amount, balance, returnTo }: {
  paymentId: string;
  amount: number;
  balance: number;  // current balance at render time (includes this credit)
  returnTo?: string; // safeReturn-validated checkout path, if the deposit funded a purchase
}) {
  return (
    <div className="checkout-success">
      <div className="success-icon"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg></div>
      <div className="success-title">Deposit confirmed</div>
      <div className="success-helper">The funds have been added to your account balance.</div>
      <div className="success-summary">
        <div className="kv-row"><span className="kv-label">Payment ID</span><span className="kv-val mono">{paymentId}</span></div>
        <div className="kv-row"><span className="kv-label">Amount</span><span className="kv-val">{money(amount)}</span></div>
        <div className="kv-row total"><span className="kv-label">Account balance</span><span className="kv-val">{money(balance)}</span></div>
      </div>
      <div className="success-actions">
        {returnTo ? (
          <>
            <Link href={returnTo} className="btn primary" onClick={signalStructural}>Continue checkout</Link>
            <Link href="/billing" className="btn" onClick={signalStructural}>Go to Billing</Link>
          </>
        ) : (
          <Link href="/billing" className="btn primary" onClick={signalStructural}>Go to Billing</Link>
        )}
      </div>
    </div>
  );
}
