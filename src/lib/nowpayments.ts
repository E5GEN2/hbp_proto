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
export { NP_COINS, npCoin, CRYPTO_MIN_USD, type NpCoin } from './np-coins';

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
  const requestBody = JSON.stringify({
    price_amount: input.amountUsd,
    price_currency: 'usd',
    pay_currency: input.payCurrency.toLowerCase(),
    order_id: input.paymentId,
    order_description: input.description,
    ipn_callback_url: appUrl('/api/webhooks/nowpayments'),
    // Floating rate (owner decision 2026-08-07, "Layer 1"): no 10–20 min
    // rate lock, so a late payer isn't punished with an underpayment when
    // the window lapses. NOTE: whether this takes effect can depend on the
    // NOWPayments account's rate mode — if the account enforces fixed rate,
    // flip it to classic/floating in the dashboard for this to apply. The
    // client pay panel no longer presents the address as "dead" either way.
    is_fixed_rate: false,
    is_fee_paid_by_user: true,
  });
  // NP's create endpoint returns spurious 5xx (e.g. "Can not get estimate from
  // TRX to USDCBSC", statusCode 500 INTERNAL_ERROR — an estimate-service
  // hiccup that clears on retry; observed live 2026-08-10). A single retry
  // turns a transient failure into a normal address instead of a hard error
  // the client sees. Never retry a 4xx (below-minimum, bad coin — deterministic).
  let r!: Response, body = '', j: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      r = await fetch(`${apiBase()}/payment`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY!, 'Content-Type': 'application/json' },
        body: requestBody,
      });
    } catch (e) {
      // Network blip — retry once, then surface as unavailable.
      if (attempt === 0) { await new Promise(res => setTimeout(res, 600)); continue; }
      console.error(`[nowpayments] payment create network error for ${input.paymentId} (${input.payCurrency})`, e);
      throw new Error('Crypto payment processor is unavailable right now — please try again in a minute.');
    }
    body = await r.text().catch(() => '');
    try { j = JSON.parse(body); } catch { j = null; }
    if (r.ok || r.status < 500 || attempt === 1) break; // success, deterministic 4xx, or out of retries
    console.warn(`[nowpayments] payment create ${r.status} for ${input.paymentId} (${input.payCurrency}) — retrying: ${body.slice(0, 160)}`);
    await new Promise(res => setTimeout(res, 600));
  }
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
// NOTE: the old npMinAmountUsd()/belowMinMessage() per-coin gating (via NP's
// /v1/min-amount endpoint) was removed 2026-08-07 — that endpoint reports
// figures that don't match real create-payment behaviour. Crypto amounts are
// now gated by the flat CRYPTO_MIN_USD floor (see np-coins.ts). Do not
// reintroduce per-coin min-amount gating.

// IPN authenticity: HMAC-SHA512 over the JSON body re-serialized with keys
// sorted (NOWPayments' documented recipe), compared against x-nowpayments-sig.
//
// NOWPayments signs on their side with PHP `json_encode(ksort($data),
// JSON_UNESCAPED_SLASHES)`, which — critically — escapes every non-ASCII char
// to `\uXXXX` (PHP does NOT set JSON_UNESCAPED_UNICODE). JS `JSON.stringify`
// emits raw UTF-8. Our order descriptions carry `—` and `×` on EVERY order
// (`Order … — N × Plan`), so the two serializations differed on that field and
// the signature never matched — every IPN was rejected and nothing auto-settled
// (root cause of the 2026-08-09 PAY-57160 incident). We now compare against BOTH
// serializations (raw and PHP-style \u-escaped): both HMAC the same authenticated
// payload with the secret, so accepting either doesn't weaken auth — it only
// tolerates the unicode-encoding difference. Secret is trimmed (a pasted key
// often carries a trailing newline).
// Recursive key sort — NOWPayments' documented verification recipe (their
// Node sample sorts nested objects too). CRITICAL: do NOT use a
// JSON.stringify replacer array here — a replacer is a key ALLOWLIST applied
// at EVERY depth, so nested objects lose any key not present at the top
// level. Real payment IPNs carry a nested `fee` object ({currency,
// depositFee, serviceFee, withdrawalFee}); the replacer serialized it as {}
// and the HMAC never matched — proven by the live sig-mismatch diagnostics
// 2026-08-10 (keys=[…,fee,…] on every rejected IPN).
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function npVerifySignature(rawBody: string, sig: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET?.trim();
  if (!secret || !sig) return false;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawBody); } catch { return false; }
  if (!parsed || typeof parsed !== 'object') return false;
  const received = Buffer.from(sig.trim());
  const base = JSON.stringify(sortDeep(parsed));
  const phpEscaped = base.replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  for (const candidate of base === phpEscaped ? [base] : [base, phpEscaped]) {
    const digest = Buffer.from(crypto.createHmac('sha512', secret).update(candidate).digest('hex'));
    if (digest.length === received.length && crypto.timingSafeEqual(digest, received)) return true;
  }
  // Diagnostic (no secret leak — the sig is a public MAC, digests are derived):
  // reveals whether a mismatch is a length/format problem vs a secret mismatch,
  // and which keys were signed. Lets us confirm from logs whether this fix took.
  console.warn(`[nowpayments] IPN sig mismatch — received ${sig.trim().slice(0, 12)}… (len ${received.length}); keys=[${Object.keys(parsed).sort().join(',')}]`);
  return false;
}
// npGetPayment (reconciliation read) lives in np-api.ts — it needs only fetch,
// so keeping it out of this crypto-importing module lets the sweep/reconcile
// chain (traced by the edge instrumentation bundle) avoid node:crypto.
