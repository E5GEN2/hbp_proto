'use client';

// In-portal crypto payment surface (owner ask 2026-07-29: no redirect to
// NOWPayments). Three consumers: checkout wizard (new order + renewal),
// deposit wizard, and the /checkout?resume=… interstitial. The panel renders
// everything the hosted invoice page used to: QR + address (+ memo where the
// chain demands one), the EXACT crypto amount, the payment-window countdown
// and a live status line driven by polling OUR payment row (the webhook /
// reconciler are the writers — the client never confirms anything itself).
// Charges are floating-rate and live ~7 days (payExpiresAt); short windows
// (a countdown appears under 2h) only recur if the fixed-rate trap regresses
// (see nowpayments.ts). If a window DOES lapse the panel flips to a one-click
// fresh-address recovery; funds landing on a dead charge flip it to a "being
// verified" view (MANUAL_REVIEW) — both keep polling and hand off to success
// on their own.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { useToast } from '@/components/ui/Toast';
import { FormSelect } from '@/components/ui/FormSelect';
import { money } from '@/lib/money';
import { npCoin, npCoinDisplay, COIN_FAMILIES, familyCoins } from '@/lib/np-coins';
import { TOKEN_ICON, NETWORK_ICON } from '@/lib/coin-icons';
import { TELEGRAM_SUPPORT_URL } from '@/lib/support';
import { statusLine, serverWindowClosed, localWindowPassed, showWindowCountdown, fmtLeft } from '@/lib/crypto-window';

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

// ── Coin/network logos: real brand marks from web3icons (MIT), inlined as SVG
//    strings in coin-icons.ts. CoinGlyph renders one inside an 18px .coin-mark
//    box (dangerouslySetInnerHTML — the SVG is our own build-time asset, never
//    user input).
function CoinGlyph({ svg }: { svg: string | undefined }) {
  if (!svg) return <span className="coin-mark coin-mark-empty" aria-hidden="true" />;
  return <span className="coin-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function optLabel(svg: string | undefined, text: string, note?: string) {
  return (
    <span className="coin-opt">
      <CoinGlyph svg={svg} />
      <span className="coin-opt-text">{text}</span>
      {note && <span className="coin-opt-note">{note}</span>}
    </span>
  );
}

// ── Coin picker (owner revision 2026-07-29): two dropdowns — coin first,
//    then the network — with brand marks; a network whose live NP minimum
//    exceeds the total is disabled with the minimum shown, and a family whose
//    EVERY network is below minimum is disabled at the first step.
export function CoinSelect({ totalUsd, value, onChange, coins, loading, error, onRetry }: {
  totalUsd: number;
  value: string | null;
  onChange: (code: string | null) => void;
  coins: CoinInfo[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  // Family derives from the picked ticker; before a network is chosen it
  // lives in local state.
  const [familyState, setFamilyState] = useState<string | null>(null);
  const family = value ? (npCoin(value)?.family ?? null) : familyState;

  // Min-gating must survive a total change (review find A): if the client goes
  // back and lowers the amount, a previously-viable coin can drop below its
  // live minimum — clear the now-invalid selection (disarms Buy now via the
  // parent's !payCoin gate) so we never POST a below-minimum charge that NP
  // would reject with a raw crypto-units error. Effect (not render-time) —
  // onChange is a parent setState. onChange from useState setters is stable.
  useEffect(() => {
    if (!coins) return;
    const by = new Map(coins.map(c => [c.code, c]));
    if (value) {
      const c = by.get(value);
      if (!c || (c.minUsd != null && totalUsd < c.minUsd)) onChange(null);
    }
    if (familyState) {
      const fnets = familyCoins(familyState).filter(x => by.has(x.code)).map(x => by.get(x.code)!);
      if (fnets.length && fnets.every(n => n.minUsd != null && totalUsd < n.minUsd)) setFamilyState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins, value, totalUsd, familyState]);

  if (loading) return <div className="help-text crypto-method-extra">Loading coins…</div>;
  if (error) return (
    <div className="help-text crypto-method-extra">
      Couldn&rsquo;t load the coin list.{' '}
      <span className="td-link" style={{ cursor: 'pointer' }} onClick={onRetry}>Retry</span>
    </div>
  );
  if (!coins || coins.length === 0) return null;

  const byCode = new Map(coins.map(c => [c.code, c]));
  // Only families/networks the server actually offers; minUsd gates each.
  const netsOf = (fam: string) =>
    familyCoins(fam)
      .filter(c => byCode.has(c.code))
      .map(c => ({ ...c, minUsd: byCode.get(c.code)!.minUsd }));
  const netBelow = (n: { minUsd: number | null }) => n.minUsd != null && totalUsd < n.minUsd;

  const familyOptions = COIN_FAMILIES
    .filter(f => netsOf(f.key).length > 0)
    .map(f => {
      const nets = netsOf(f.key);
      const allBelow = nets.every(netBelow);
      const minOfFam = Math.min(...nets.map(n => n.minUsd ?? Infinity));
      return {
        value: f.key,
        disabled: allBelow,
        label: optLabel(TOKEN_ICON[f.key], f.label, allBelow && Number.isFinite(minOfFam) ? `min ${money(minOfFam)}` : undefined),
      };
    });

  const nets = family ? netsOf(family) : [];
  const networkOptions = nets.map(n => ({
    value: n.code,
    disabled: netBelow(n),
    label: optLabel(NETWORK_ICON[n.network] ?? TOKEN_ICON[family!], n.network, netBelow(n) ? `min ${money(n.minUsd!)}` : undefined),
  }));

  function pickFamily(fam: string) {
    // Re-picking the already-active family with a network chosen is a no-op —
    // don't wipe the network (review find C). A genuine switch (fam !== family)
    // still resets; picking before any network (value null) still auto-picks.
    if (fam === family && value != null) return;
    setFamilyState(fam);
    const enabled = netsOf(fam).filter(n => !netBelow(n));
    // Single-network coin (or one viable network) → picked implicitly.
    onChange(enabled.length === 1 ? enabled[0].code : null);
  }

  // Both dropdowns always render side by side (owner item 1): Coin | Network.
  // The Network select is disabled until a coin is chosen; a single-network
  // coin shows that network preselected (still disabled — nothing to pick).
  const networkDisabled = !family || nets.length <= 1;
  const networkPlaceholder = !family ? 'Choose a coin first' : nets.length <= 1 ? undefined : 'Choose network…';

  return (
    <div className="crypto-method-extra">
      <div className="crypto-select">
        <label className="form-label">Coin</label>
        <FormSelect value={family ?? ''} onChange={pickFamily} options={familyOptions} placeholder="Choose coin…" />
      </div>
      <div className="crypto-select">
        <label className="form-label">Network</label>
        <FormSelect
          value={value ?? ''}
          onChange={v => onChange(v || null)}
          options={networkOptions}
          placeholder={networkPlaceholder}
          disabled={networkDisabled}
        />
      </div>
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

export function CryptoPayPanel({ pay, amountUsd, title = 'Complete your payment', onSettled, onRegenerate, regenerating, children }: {
  pay: PayPanelData;
  amountUsd: number;
  title?: string;
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
  // Local payment.status phases beyond the live panel:
  //   review — MANUAL_REVIEW: funds detected on a dead charge, human queued;
  //   dead   — FAILED/CANCELLED/REFUNDED: charge is locally terminal.
  const [review, setReview] = useState(false);
  const [dead, setDead] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const settledRef = useRef(false);

  // Countdown ticker (1s) — cosmetic; expiry is enforced by NP + IPN.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Status poll — OUR db only. Keeps polling through review/dead states: a
  // MANUAL_REVIEW charge auto-settles when NP reports it finished (or an admin
  // confirms it), and a FAILED charge is resurrectable — in both cases the
  // next poll sees CONFIRMED and the success handoff still happens.
  useEffect(() => {
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/checkout/payment-status?id=${encodeURIComponent(pay.paymentId)}`);
        if (!r.ok) return; // transient — keep polling
        const j = await r.json();
        if (stop) return;
        setNpStatus(j.npStatus ?? null);
        if (j.status === 'CONFIRMED' && !settledRef.current) {
          settledRef.current = true;
          clearInterval(t);
          onSettled();
          return;
        }
        setReview(j.status === 'MANUAL_REVIEW');
        setDead(j.status ? j.status !== 'AWAITING' && j.status !== 'CONFIRMED' && j.status !== 'MANUAL_REVIEW' : false);
      } catch { /* network blip — keep polling */ }
    }, POLL_MS);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay.paymentId]);

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast('Copied', what, 'success'); }
    catch { toast('Copy failed', 'Clipboard unavailable', 'danger'); }
  }

  const msLeft = pay.payExpiresAt != null ? pay.payExpiresAt - now : null;
  const line = statusLine(npStatus);
  const supportLink = (
    <a href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>support on Telegram</a>
  );

  // Funds detected on a dead charge — a human is on it. No regenerate here:
  // the client's money is attached to THIS charge; a fresh address would
  // invite paying twice.
  if (review) {
    return (
      <div className="checkout-processing">
        <div className="panel checkout-processing-card">
          <div className="processing-title">Payment received — being verified</div>
          <div className="t-note" style={{ maxWidth: 420 }}>
            We&rsquo;ve detected your payment and it&rsquo;s being verified. Support is already
            notified — everything updates automatically once it&rsquo;s confirmed, and this
            page will move on by itself. Nothing else is needed from you. Questions? Message {supportLink}.
          </div>
          {children}
        </div>
      </div>
    );
  }

  // Window-closed / dead-charge recovery — the full REPLACEMENT view. Reached
  // only on a SERVER-corroborated signal:
  //   • the charge is locally terminal (FAILED/CANCELLED/REFUNDED via poll), or
  //   • the server mirrored npStatus 'expired'/'failed' (serverWindowClosed).
  // Deliberately NOT the local clock alone — a client clock set fast would
  // otherwise open the panel already-closed and hide the address (audit C15).
  // A merely-lapsed local countdown keeps the address up with an inline
  // affordance (below). Late funds are safe: the webhook/reconciler park them
  // for review, and this panel keeps polling — it flips to the review view (or
  // straight to success) on its own.
  if (dead || serverWindowClosed(npStatus)) {
    return (
      <div className="checkout-processing">
        <div className="panel checkout-processing-card">
          <div className="processing-title">Payment window closed</div>
          <div className="t-note" style={{ maxWidth: 420 }}>
            The payment window for this address has closed and no transfer was detected.
            {onRegenerate ? ' Get a fresh address to pay at the current rate — the price in USD stays the same.' : ''}
            {' '}Already sent the funds? Don&rsquo;t send again — they&rsquo;re detected automatically
            and this page will update. If anything feels off, message {supportLink}.
          </div>
          {onRegenerate && (
            <div className="processing-actions">
              <button className="btn primary" disabled={regenerating} onClick={onRegenerate}>
                {regenerating ? 'Generating…' : 'Get a fresh address'}
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  // Local countdown reached zero but the server hasn't confirmed death — keep
  // the address visible (the charge may still be live) and offer a fresh one.
  const localPassed = localWindowPassed(npStatus, msLeft);

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

        {/* Payment-window countdown — every coin (the processor kills the
            whole charge at the window, not just the rate). One honest line;
            the status line above stays the narrator for detection stages. */}
        {showWindowCountdown(npStatus, msLeft) && (
          <div className="t-note">
            Payment window: <span className="mono">{fmtLeft(msLeft!)}</span> — if it closes before you pay, a fresh address is one click away.
          </div>
        )}
        {/* Local countdown passed but the charge isn't server-confirmed dead —
            keep the address up, offer a fresh one inline (never hide it). */}
        {localPassed && (
          <div className="t-note">
            The payment window may have closed. If your wallet hasn&rsquo;t sent yet,{' '}
            {onRegenerate
              ? <button className="td-link" style={{ cursor: 'pointer', background: 'none', border: 0, padding: 0, font: 'inherit' }} disabled={regenerating} onClick={onRegenerate}>{regenerating ? 'generating…' : 'get a fresh address'}</button>
              : 'start a new payment'}
            . Already sent? It&rsquo;s detected automatically — don&rsquo;t resend.
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
