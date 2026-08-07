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
import { FormSelect } from '@/components/ui/FormSelect';
import { money } from '@/lib/money';
import { npCoin, npCoinDisplay, COIN_FAMILIES, familyCoins } from '@/lib/np-coins';
import { TOKEN_ICON, NETWORK_ICON } from '@/lib/coin-icons';

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
  const line = statusLine(npStatus);

  // Recovery view — shown ONLY when the IPN reports the charge terminally dead
  // (`failed`/expired after the 7-day deposit window). We deliberately do NOT
  // collapse the panel when the on-screen rate countdown hits zero (owner
  // 2026-08-07, "Layer 1"): the deposit address stays valid for days, so a
  // late payer must keep seeing it — telling them it's "no longer valid" was
  // exactly what pushed funds to a supposedly-dead address. A late payment is
  // reconciled by the IPN (small drift auto-covered; larger → admin confirms).
  if (failed) {
    return (
      <div className="checkout-processing">
        <div className="panel checkout-processing-card">
          <div className="processing-title">Payment window closed</div>
          <div className="t-note" style={{ maxWidth: 420 }}>
            This charge is no longer active — it was cancelled or timed out before a payment cleared.
            {onRegenerate ? ' Get a fresh address to pay at the current rate — the price in USD stays the same.' : ''}
            {' '}If you already sent the funds, don’t resend — contact support and nothing is lost.
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

        {msLeft != null && msLeft > 0 && !npStatus && (
          <div className="t-note">
            Best rate held for <span className="mono">{fmtLeft(msLeft)}</span>. You can still pay after that — the address stays valid; send the amount shown and we’ll confirm your payment (support sorts out any difference).
          </div>
        )}
        <div className="t-note">This page updates automatically once the transaction is detected — keep the tab open or come back later; {settleNote}.</div>
        {children}
      </div>
    </div>
  );
}
