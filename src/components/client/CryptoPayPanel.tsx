'use client';

// In-portal crypto payment surface (owner ask 2026-07-29: no redirect to
// NOWPayments). Three consumers: checkout wizard (new order + renewal),
// deposit wizard, and the /checkout?resume=… interstitial. The panel renders
// everything the hosted invoice page used to: QR + address (+ memo where the
// chain demands one), the EXACT crypto amount, the fixed-rate countdown and a
// live status line driven by polling OUR payment row (the IPN webhook is the
// only writer — the client never confirms anything itself).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { useToast } from '@/components/ui/Toast';
import { money } from '@/lib/money';
import { npCoin, npCoinDisplay } from '@/lib/np-coins';

export type PayPanelData = {
  paymentId: string;
  payCurrency: string;
  payAmount: string;       // exact string — never float-mangled
  payAddress: string;
  payinExtraId: string | null;
  payExpiresAt: number | null; // ms epoch
};

export type CoinInfo = { code: string; label: string; network: string; memo: boolean; minUsd: number | null };

// ── QR (SVG, no canvas): the address alone — deliberately NOT a payment URI.
//    15 coins span incompatible URI schemes; a wrong scheme misleads wallets,
//    a bare address never does. Amount is copied separately.
function QrSvg({ text }: { text: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [text]);
  return (
    <svg className="crypto-qr-svg" viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" aria-label="Payment address QR code">
      <path d={path.d} fill="#111" />
    </svg>
  );
}

// ── Coin picker: whitelist grid annotated with live USD minimums. A coin
//    whose minimum exceeds the total is disabled with an honest note.
export function CoinPicker({ totalUsd, value, onChange, coins, loading, error, onRetry }: {
  totalUsd: number;
  value: string | null;
  onChange: (code: string) => void;
  coins: CoinInfo[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) return <div className="help-text" style={{ marginTop: 10 }}>Loading coins…</div>;
  if (error) return (
    <div className="help-text" style={{ marginTop: 10 }}>
      Couldn&rsquo;t load the coin list.{' '}
      <span className="td-link" style={{ cursor: 'pointer' }} onClick={onRetry}>Retry</span>
    </div>
  );
  if (!coins || coins.length === 0) return null;
  return (
    <div className="coin-grid">
      {coins.map(c => {
        const below = c.minUsd != null && totalUsd < c.minUsd;
        return (
          <button
            key={c.code}
            type="button"
            className={`coin-tile ${value === c.code ? 'selected' : ''}`}
            disabled={below}
            title={below ? `Minimum for ${c.label} · ${c.network} is ${money(c.minUsd!)}` : ''}
            onClick={() => onChange(c.code)}
          >
            <span className="coin-tile-label">{c.label}</span>
            <span className="coin-tile-net">{c.network}</span>
            {below && <span className="coin-tile-min">min {money(c.minUsd!)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Shared fetch hook so both wizards load the list the same way.
export function useCoinList(active: boolean) {
  const [coins, setCoins] = useState<CoinInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || coins !== null) return;
    let dead = false;
    setLoading(true); setError(false);
    fetch('/api/checkout/crypto-coins')
      .then(r => r.json())
      .then(j => { if (!dead) setCoins(Array.isArray(j.coins) ? j.coins : []); })
      .catch(() => { if (!dead) setError(true); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [active, coins, tick]);
  return { coins, loading, error, retry: () => { setCoins(null); setError(false); setTick(t => t + 1); } };
}

const POLL_MS = 5000;

function fmtLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function statusLine(npStatus: string | null): { text: string; warn?: boolean } {
  switch (npStatus) {
    case 'confirming': return { text: 'Transaction detected — waiting for network confirmations…' };
    case 'confirmed':
    case 'sending': return { text: 'Confirmed — finalizing your payment…' };
    case 'partially_paid': return { text: 'Partial amount received — send the remaining balance from the same wallet, or contact support.', warn: true };
    default: return { text: 'Waiting for your transfer…' };
  }
}

export function CryptoPayPanel({ pay, amountUsd, title = 'Complete your payment', settleNote = 'the order confirms either way', onSettled, onRegenerate, regenerating, children }: {
  pay: PayPanelData;
  amountUsd: number;
  title?: string;
  settleNote?: string; // what settles: order copy by default, deposits override
  onSettled: () => void;
  // Present → the expired/failed state offers a one-click fresh address for
  // the SAME charge (checkout wizard + resume page). Absent → the consumer
  // renders its own recovery below (deposit: just start a new one).
  onRegenerate?: () => void;
  regenerating?: boolean;
  children?: ReactNode;
}) {
  const toast = useToast();
  const coin = npCoin(pay.payCurrency);
  const display = npCoinDisplay(pay.payCurrency);
  const [npStatus, setNpStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const settledRef = useRef(false);

  // Countdown ticker (1s) — purely cosmetic; expiry is enforced by NP + IPN.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Status poll — OUR db only. Stops on terminal states.
  useEffect(() => {
    let dead = false;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/checkout/payment-status?id=${encodeURIComponent(pay.paymentId)}`);
        if (!r.ok) return; // transient — keep polling
        const j = await r.json();
        if (dead) return;
        setNpStatus(j.npStatus ?? null);
        if (j.status === 'CONFIRMED' && !settledRef.current) {
          settledRef.current = true;
          clearInterval(t);
          onSettled();
        } else if (j.status && j.status !== 'AWAITING') {
          // FAILED, CANCELLED, REFUNDED, … — any terminal non-success ends the
          // wait; "keep waiting" on a dead charge misleads the client.
          clearInterval(t);
          setFailed(true);
        }
      } catch { /* network blip — keep polling */ }
    }, POLL_MS);
    return () => { dead = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay.paymentId]);

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast('Copied', what, 'success'); }
    catch { toast('Copy failed', 'Clipboard unavailable', 'danger'); }
  }

  const msLeft = pay.payExpiresAt != null ? pay.payExpiresAt - now : null;
  const expired = msLeft != null && msLeft <= 0;
  const line = statusLine(npStatus);

  // Terminal: the charge died (IPN expired/failed). Offer recovery.
  if (failed) {
    return (
      <div className="checkout-processing">
        <div className="panel checkout-processing-card">
          <div className="processing-title">Payment window closed</div>
          <div className="t-note" style={{ maxWidth: 420 }}>
            This charge is no longer active — the exchange-rate window closed (or the charge was cancelled) before a payment was received.
            {onRegenerate ? ' Generate a fresh address to try again — the price stays the same.' : ''}
            {' '}If you already sent the funds, contact support — nothing is lost.
          </div>
          {onRegenerate && (
            <div className="processing-actions">
              <button className="btn primary" disabled={regenerating} onClick={onRegenerate}>
                {regenerating ? 'Generating…' : 'Generate new address'}
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-processing">
      <div className="panel checkout-processing-card">
        <div className="processing-title">{title}</div>
        <div className="processing-amount">{money(amountUsd)}</div>

        <div className="crypto-qr"><QrSvg text={pay.payAddress} /></div>

        <div className="crypto-fields">
          <div className="crypto-field">
            <span className="wallet-label">Send exactly · {display}</span>
            <div className="creds-row">
              <pre className="export-preview crypto-value" title={`${pay.payAmount} ${display}`}>{pay.payAmount} {coin ? coin.label : pay.payCurrency}</pre>
              <div className="creds-actions"><button className="btn" onClick={() => copy(pay.payAmount, 'Amount')}>Copy</button></div>
            </div>
          </div>
          <div className="crypto-field">
            <span className="wallet-label">To this {coin ? `${coin.network} ` : ''}address</span>
            <div className="creds-row">
              <pre className="export-preview crypto-value" title={pay.payAddress}>{pay.payAddress}</pre>
              <div className="creds-actions"><button className="btn" onClick={() => copy(pay.payAddress, 'Address')}>Copy</button></div>
            </div>
          </div>
          {pay.payinExtraId && (
            <div className="crypto-field">
              <span className="wallet-label crypto-memo-label">Memo / tag — required</span>
              <div className="creds-row">
                <pre className="export-preview crypto-value" title={pay.payinExtraId}>{pay.payinExtraId}</pre>
                <div className="creds-actions"><button className="btn" onClick={() => copy(pay.payinExtraId!, 'Memo')}>Copy</button></div>
              </div>
              <div className="crypto-memo-warn">Transfers without this memo cannot be credited automatically.</div>
            </div>
          )}
        </div>

        <div className={`crypto-status ${line.warn ? 'warn' : ''}`}>
          <span className="crypto-status-dot" />
          {line.text}
        </div>

        {msLeft != null && !expired && (
          <div className="t-note">
            Rate locked for <span className="mono">{fmtLeft(msLeft)}</span> — send the exact amount before the window closes.
          </div>
        )}
        {expired && (
          <div className="t-note" style={{ color: 'var(--warning)' }}>
            The rate window is closing — a transfer sent now may not be credited automatically.
            {onRegenerate && (
              <> <span className="td-link" style={{ cursor: 'pointer' }} onClick={regenerating ? undefined : onRegenerate}>{regenerating ? 'Generating…' : 'Generate a fresh address'}</span> if you haven&rsquo;t sent it yet.</>
            )}
          </div>
        )}
        <div className="t-note">This page updates automatically once the transaction is detected — keep the tab open or come back later; {settleNote}.</div>
        {children}
      </div>
    </div>
  );
}
