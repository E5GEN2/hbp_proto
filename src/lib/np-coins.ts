// The in-portal crypto coin whitelist (owner decision 2026-07-29: BTC / ETH /
// LTC / TRX / SOL + USDT and USDC on their top-5 chains). Pure data — safe to
// import from BOTH server code and client components (nowpayments.ts pulls in
// node:crypto and must stay server-only). Codes are NP tickers — the ONLY
// values ever forwarded to the NP API (client input is validated against this
// list, never passed through raw). All 15 were verified enabled +
// fixed-rate-capable on the live merchant account before shipping.
export type NpCoin = {
  code: string;    // NP ticker (lowercased in API calls)
  label: string;   // display name
  network: string; // display network/chain (== label for native coins)
  memo?: boolean;  // chain needs a memo/tag (payin_extra_id) — warn the client
};

export const NP_COINS: NpCoin[] = [
  { code: 'BTC', label: 'Bitcoin', network: 'Bitcoin' },
  { code: 'ETH', label: 'Ethereum', network: 'Ethereum' },
  { code: 'LTC', label: 'Litecoin', network: 'Litecoin' },
  { code: 'TRX', label: 'Tron', network: 'Tron' },
  { code: 'SOL', label: 'Solana', network: 'Solana' },
  { code: 'USDTTRC20', label: 'USDT', network: 'TRC-20' },
  { code: 'USDTERC20', label: 'USDT', network: 'ERC-20' },
  { code: 'USDTBSC', label: 'USDT', network: 'BEP-20' },
  { code: 'USDTSOL', label: 'USDT', network: 'Solana' },
  { code: 'USDTTON', label: 'USDT', network: 'TON', memo: true },
  { code: 'USDC', label: 'USDC', network: 'ERC-20' },
  { code: 'USDCSOL', label: 'USDC', network: 'Solana' },
  { code: 'USDCBASE', label: 'USDC', network: 'Base' },
  { code: 'USDCARB', label: 'USDC', network: 'Arbitrum' },
  { code: 'USDCMATIC', label: 'USDC', network: 'Polygon' },
];

export function npCoin(code: string | null | undefined): NpCoin | null {
  if (!code) return null;
  const up = code.toUpperCase();
  return NP_COINS.find(c => c.code === up) ?? null;
}

// "USDT · TRC-20" for tokens, plain "Bitcoin" for native coins.
export function npCoinDisplay(code: string): string {
  const c = npCoin(code);
  if (!c) return code;
  return c.label === c.network ? c.label : `${c.label} · ${c.network}`;
}
