// NOWPayments integration (hosted invoice + IPN webhook). REST via fetch —
// same no-SDK constraint as email.ts.
//
// Env: NOWPAYMENTS_API_KEY (charges), NOWPAYMENTS_IPN_SECRET (webhook HMAC),
// NOWPAYMENTS_SANDBOX=true → api-sandbox host. Key unset → npEnabled() false
// and the crypto flow falls back to the legacy mock (only where
// ALLOW_MOCK_PAYMENTS permits it).

import crypto from 'crypto';
import { appUrl } from './app-url';

function apiBase() {
  return process.env.NOWPAYMENTS_SANDBOX === 'true'
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';
}

export function npEnabled() {
  return Boolean(process.env.NOWPAYMENTS_API_KEY);
}

// (npCreateInvoice removed 2026-07-29 — hosted invoices replaced by the
// in-portal direct flow below; npInvoiceUrl stays for pre-existing payments.)

// Hosted invoice page for a stored invoice id (payments.externalRef) — the
// link stays valid until the invoice expires, so "Complete payment" can send
// the client back without any API call. LEGACY: kept only for payments created
// before the in-portal direct flow (they have externalRef but no payAddress).
export function npInvoiceUrl(invoiceId: string) {
  return process.env.NOWPAYMENTS_SANDBOX === 'true'
    ? `https://sandbox.nowpayments.io/payment/?iid=${invoiceId}`
    : `https://nowpayments.io/payment/?iid=${invoiceId}`;
}

// ── In-portal direct payments ────────────────────────────────────────────────
// Coin whitelist lives in np-coins.ts (pure data — client components import it
// directly; this file is server-only because of node:crypto). Re-exported so
// server code keeps a single import site.
export { NP_COINS, npCoin, type NpCoin } from './np-coins';

export type NpDirectPayment = {
  npPaymentId: string;   // NP-side numeric id → payments.externalRef
  payCurrency: string;   // NP ticker (uppercased)
  payAmount: string;     // exact crypto amount as a string (never float-mangled)
  payAddress: string;
  payinExtraId: string | null;
  expiresAt: Date | null; // fixed-rate window end
};

// Direct payment: NP returns a deposit address + exact amount and the client
// pays on OUR page — no redirect. Fixed rate + network fee on the client
// (owner decisions 2026-07-29). order_id carries OUR payment id, so the same
// IPN webhook settles both this and legacy invoices identically.
export async function npCreatePayment(input: {
  amountUsd: number;
  payCurrency: string; // must already be whitelist-validated by the caller
  paymentId: string;
  description: string;
}): Promise<NpDirectPayment> {
  const r = await fetch(`${apiBase()}/payment`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_amount: input.amountUsd,
      price_currency: 'usd',
      pay_currency: input.payCurrency.toLowerCase(),
      order_id: input.paymentId,
      order_description: input.description,
      ipn_callback_url: appUrl('/api/webhooks/nowpayments'),
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
    }),
  });
  const body = await r.text().catch(() => '');
  let j: any;
  try { j = JSON.parse(body); } catch { j = null; }
  if (!r.ok) {
    console.error(`[nowpayments] payment create failed ${r.status} for ${input.paymentId} (${input.payCurrency}): ${body.slice(0, 300)}`);
    // NP's 400s carry actionable text (e.g. amount below the coin's minimum) —
    // surface it; anything else gets the generic retry message.
    const msg = r.status === 400 && j?.message
      ? `Payment processor: ${String(j.message).slice(0, 200)}`
      : 'Crypto payment processor is unavailable right now — please try again in a minute.';
    throw new Error(msg);
  }
  if (!j?.payment_id || !j?.pay_address || j?.pay_amount == null) {
    console.error(`[nowpayments] payment response missing fields for ${input.paymentId}: ${body.slice(0, 300)}`);
    throw new Error('Crypto payment processor returned an unexpected response — please try again.');
  }
  const expiresRaw = j.valid_until ?? j.expiration_estimate_date ?? null;
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  return {
    npPaymentId: String(j.payment_id),
    payCurrency: String(j.pay_currency ?? input.payCurrency).toUpperCase(),
    payAmount: String(j.pay_amount),
    payAddress: String(j.pay_address),
    payinExtraId: j.payin_extra_id != null ? String(j.payin_extra_id) : null,
    expiresAt: expiresAt && !isNaN(expiresAt.getTime()) ? expiresAt : null,
  };
}

// Per-coin USD minimum for the picker (min-amount endpoint, fiat_equivalent).
// Cached in-process for 5 minutes — minimums drift with rates, not per-request.
// A failed lookup yields null (coin stays selectable; npCreatePayment surfaces
// NP's own minimum error if the client picks it anyway).
const minCache = new Map<string, { at: number; minUsd: number | null }>();
const MIN_TTL_MS = 5 * 60_000;
export async function npMinAmountUsd(code: string): Promise<number | null> {
  const hit = minCache.get(code);
  if (hit && Date.now() - hit.at < MIN_TTL_MS) return hit.minUsd;
  let minUsd: number | null = null;
  try {
    const r = await fetch(
      `${apiBase()}/min-amount?currency_from=${encodeURIComponent(code.toLowerCase())}&fiat_equivalent=usd`,
      { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY! } },
    );
    if (r.ok) {
      const j: any = await r.json().catch(() => null);
      const v = Number(j?.fiat_equivalent);
      if (Number.isFinite(v) && v > 0) minUsd = v;
    }
  } catch { /* network blip — treat as unknown */ }
  minCache.set(code, { at: Date.now(), minUsd });
  return minUsd;
}

// IPN authenticity: HMAC-SHA512 over the JSON body re-serialized with keys
// sorted (NOWPayments' documented recipe), compared against x-nowpayments-sig.
export function npVerifySignature(rawBody: string, sig: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !sig) return false;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawBody); } catch { return false; }
  if (!parsed || typeof parsed !== 'object') return false;
  const sorted = JSON.stringify(parsed, Object.keys(parsed).sort());
  const digest = crypto.createHmac('sha512', secret).update(sorted).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
