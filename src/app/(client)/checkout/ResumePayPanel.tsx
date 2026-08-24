'use client';

// Client half of the /checkout?resume=… interstitial for DIRECT (in-portal)
// crypto payments, plus the deposit twin (/checkout?kind=deposit&resume=PAY-…).
// Hard-nav on settle (window.location.assign) — the PR #111 lesson: after a
// server-side state change, a clean full request beats router.push+refresh on
// this owner's flaky network path.

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { CryptoPayPanel, CoinSelect, useCoinList, type PayPanelData } from '@/components/client/CryptoPayPanel';

export function ResumePayPanel({ orderId, amountUsd, initial, expiredMode, renewal = false, children }: {
  orderId: string;
  amountUsd: number;
  initial: PayPanelData | null;
  // No AWAITING charge left (the fixed-rate window expired and IPN failed it):
  // offer a coin re-pick + a fresh charge for the same order.
  expiredMode: boolean;
  renewal?: boolean; // renewal charge → the success screen shows renewal copy/price
  children?: React.ReactNode; // cancel-order actions rendered inside the card
}) {
  const toast = useToast();
  const [payData, setPayData] = useState<PayPanelData | null>(initial);
  const [payCoin, setPayCoin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Displayed USD — state, not the prop: on a priceChanged 409 the server
  // sends the current total and this card updates in place, so the client
  // regenerates AT the shown price instead of looping on the stale one.
  const [amount, setAmount] = useState(amountUsd);
  const coinList = useCoinList(expiredMode && !payData);

  async function repay(coinCode: string) {
    setBusy(true);
    try {
      const r = await fetch('/api/checkout/repay', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // expectedTotal = the USD figure this card is showing. The server 409s
        // if pricing moved since render, instead of re-issuing at an amount
        // the "price stays the same" copy never showed (audit B-6).
        body: JSON.stringify({ orderId, payCoin: coinCode, expectedTotal: amount }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (r.status === 409 && j.priceChanged && typeof j.total === 'number') {
        setAmount(j.total);
        toast('Price updated', j.error, 'danger');
        return;
      }
      if (!r.ok) throw new Error(j.error ?? 'Could not create a new payment — please try again.');
      setPayData(j.payment);
    } catch (e: any) {
      toast('Failed', e.message, 'danger');
    } finally { setBusy(false); }
  }

  if (payData) {
    return (
      <CryptoPayPanel
        key={payData.paymentId}
        pay={payData}
        amountUsd={amount}
        /* Settle lands on the same confirmation screen the in-flow wizard uses
           (/checkout?success=… — "payment confirmed" + View order button), NOT
           straight on the order page (owner 2026-08-10: no silent redirect
           after payment). Hard-nav kept (PR #111); the server branch validates
           ownership + ACTIVE/PROVISIONING and falls back to the order page. */
        onSettled={() => window.location.assign(`/checkout?success=${orderId}${renewal ? '&renewed=1' : ''}`)}
        onRegenerate={() => repay(payData.payCurrency)}
        regenerating={busy}
      >
        {children}
      </CryptoPayPanel>
    );
  }

  // Expired recovery: pick a coin (rates moved — minimums may differ now) and
  // issue a fresh charge for the same order.
  return (
    <div className="checkout-processing">
      <div className="panel checkout-processing-card">
        <div className="processing-title">Payment window closed</div>
        <div className="t-note" style={{ maxWidth: 420 }}>
          The payment window for this order&rsquo;s charge has closed and no transfer was detected.
          Pick a coin to generate a fresh address — the price stays the same.
          Already sent the funds? Don&rsquo;t send again — they&rsquo;re detected automatically and support is notified.
        </div>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <CoinSelect totalUsd={amount} value={payCoin} onChange={setPayCoin}
            coins={coinList.coins} loading={coinList.loading} error={coinList.error} onRetry={coinList.retry} />
        </div>
        <div className="processing-actions">
          <button className="btn primary" disabled={busy || !payCoin} onClick={() => payCoin && repay(payCoin)}>
            {busy ? 'Generating…' : payCoin ? 'Generate payment address' : 'Pick a coin to continue'}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DepositResumePanel({ amountUsd, initial, returnTo }: { amountUsd: number; initial: PayPanelData; returnTo?: string }) {
  const toast = useToast();
  const back = returnTo ?? '/billing';
  const [payData, setPayData] = useState<PayPanelData>(initial);
  const [busy, setBusy] = useState(false);
  // Settle reloads the CURRENT charge's addressable url — the server sees the
  // CONFIRMED row and renders the DepositSuccess confirmation (owner
  // 2026-08-10: no silent redirect to Billing after a top-up). returnTo rides
  // along so the confirmation can offer "Continue checkout". Hard-nav kept
  // (PR #111). Derived from payData — a regenerated charge has a NEW id.
  const settledUrl = `/checkout?kind=deposit&resume=${payData.paymentId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`;

  // Deposit regenerate — the repay endpoint's TOPUP branch (same recovery
  // orders always had; deposits used to dead-end on a lapsed window).
  async function regenerate() {
    setBusy(true);
    try {
      const r = await fetch('/api/checkout/repay', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId: payData.paymentId, payCoin: payData.payCurrency }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error ?? 'Could not create a new payment — please try again.');
      setPayData(j.payment);
    } catch (e: any) {
      toast('Failed', e.message, 'danger');
    } finally { setBusy(false); }
  }

  return (
    <CryptoPayPanel
      key={payData.paymentId}
      pay={payData}
      amountUsd={amountUsd}
      onSettled={() => window.location.assign(settledUrl)}
      onRegenerate={regenerate}
      regenerating={busy}
    >
      <Link href="/checkout?kind=deposit" className="btn ghost">Start a new deposit</Link>
      <Link href={back} className="btn ghost">← Back to {returnTo ? 'checkout' : 'billing'}</Link>
    </CryptoPayPanel>
  );
}
