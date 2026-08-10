// The in-portal crypto coin whitelist. Owner revision 2026-07-29 (post
// hand-test): the picker is two dropdowns — coin FAMILY first, then the
// network — so the data is family-shaped. Networks for USDT/USDC unified to
// BSC / ERC-20 / TRC-20 / Solana (owner item 4) — EXCEPT USDC on Tron, which
// NOWPayments does not carry at all (Circle discontinued USDC-TRC20; verified
// live: "Currency USDCTRC20 is not available"), so USDC offers BSC/ERC/SOL.
// Pure data — safe to import from BOTH server code and client components
// (nowpayments.ts pulls in node:crypto and must stay server-only). Codes are
// NP tickers — the ONLY values ever forwarded to the NP API (client input is
// validated against this list, never passed through raw). All tickers were
// verified enabled + fixed-rate-capable on the live merchant account.
// Flat minimum USD for any crypto payment/top-up. NOWPayments' real
// create-payment floor is ~$7 (≈$9 for USDT-TRC20), and its /v1/min-amount
// endpoint reports unreliable per-coin figures ($0.12–$11.78) that don't match
// create behaviour — so we gate on ONE predictable floor above the real one
// and the rate float, instead of the flaky per-coin minimum. Owner: $10.
export const CRYPTO_MIN_USD = 10;

export type NpCoin = {
  code: string;    // NP ticker (lowercased in API calls)
  family: string;  // COIN_FAMILIES key
  label: string;   // display name
  network: string; // display network/chain (== label for native coins)
  memo?: boolean;  // chain needs a memo/tag (payin_extra_id) — warn the client
};

export const NP_COINS: NpCoin[] = [
  { code: 'BTC', family: 'BTC', label: 'Bitcoin', network: 'Bitcoin' },
  { code: 'ETH', family: 'ETH', label: 'Ethereum', network: 'Ethereum' },
  { code: 'LTC', family: 'LTC', label: 'Litecoin', network: 'Litecoin' },
  { code: 'TRX', family: 'TRX', label: 'Tron', network: 'Tron' },
  { code: 'SOL', family: 'SOL', label: 'Solana', network: 'Solana' },
  { code: 'USDTBSC', family: 'USDT', label: 'USDT', network: 'BSC (BEP-20)' },
  { code: 'USDTERC20', family: 'USDT', label: 'USDT', network: 'ERC-20' },
  { code: 'USDTTRC20', family: 'USDT', label: 'USDT', network: 'TRC-20' },
  { code: 'USDTSOL', family: 'USDT', label: 'USDT', network: 'Solana' },
  { code: 'USDCBSC', family: 'USDC', label: 'USDC', network: 'BSC (BEP-20)' },
  { code: 'USDC', family: 'USDC', label: 'USDC', network: 'ERC-20' },
  { code: 'USDCSOL', family: 'USDC', label: 'USDC', network: 'Solana' },
];

// Tickers dropped from the picker in the 2026-07-29 revision but still enabled
// at NOWPayments (verified live). A charge created BEFORE the revision can
// carry one of these — npCoin/npCoinDisplay must still resolve it so the pay
// panel shows a clean label and `repay` can re-issue the SAME coin (review
// find B). They are NOT in NP_COINS/COIN_FAMILIES, so the picker never OFFERS
// them for new charges.
export const LEGACY_NP_COINS: NpCoin[] = [
  { code: 'USDTTON', family: 'USDT', label: 'USDT', network: 'TON', memo: true },
  { code: 'USDCBASE', family: 'USDC', label: 'USDC', network: 'Base' },
  { code: 'USDCARB', family: 'USDC', label: 'USDC', network: 'Arbitrum' },
  { code: 'USDCMATIC', family: 'USDC', label: 'USDC', network: 'Polygon' },
];

// Picker step 1: the coin family. `icon` keys resolve to inline SVG marks in
// the client component (data stays render-free here).
export type CoinFamily = { key: string; label: string };
export const COIN_FAMILIES: CoinFamily[] = [
  { key: 'BTC', label: 'Bitcoin' },
  { key: 'ETH', label: 'Ethereum' },
  { key: 'LTC', label: 'Litecoin' },
  { key: 'TRX', label: 'Tron' },
  { key: 'SOL', label: 'Solana' },
  { key: 'USDT', label: 'USDT' },
  { key: 'USDC', label: 'USDC' },
];

export function familyCoins(familyKey: string): NpCoin[] {
  return NP_COINS.filter(c => c.family === familyKey);
}

export function npCoin(code: string | null | undefined): NpCoin | null {
  if (!code) return null;
  const up = code.toUpperCase();
  // Legacy tickers resolve for display + repay, but only NP_COINS feeds the
  // picker (familyCoins/COIN_FAMILIES), so they can't be picked anew.
  return NP_COINS.find(c => c.code === up) ?? LEGACY_NP_COINS.find(c => c.code === up) ?? null;
}

// "USDT · TRC-20" for tokens, plain "Bitcoin" for native coins.
export function npCoinDisplay(code: string): string {
  const c = npCoin(code);
  if (!c) return code;
  return c.label === c.network ? c.label : `${c.label} · ${c.network}`;
}

// USD-pegged coins don't drift against a USD price, so the pay panel skips the
// rate-window countdown for them (owner decision 2026-08-10: timer only where
// it's financially meaningful — BTC/ETH/LTC/TRX/SOL). Unknown tickers count as
// volatile: showing a timer needlessly is harmless, hiding a real one isn't.
export function isStableCoin(code: string | null | undefined): boolean {
  const family = npCoin(code)?.family;
  return family === 'USDT' || family === 'USDC';
}
