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

// Creates a hosted invoice: the client picks the coin on NOWPayments' page and
// we get the IPN callback once the transfer lands. order_id carries OUR
// payment id (PAY-#####) — the webhook settles by it.
export async function npCreateInvoice(input: {
  amountUsd: number;
  paymentId: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ invoiceUrl: string; invoiceId: string }> {
  const r = await fetch(`${apiBase()}/invoice`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_amount: input.amountUsd,
      price_currency: 'usd',
      order_id: input.paymentId,
      order_description: input.description,
      ipn_callback_url: appUrl('/api/webhooks/nowpayments'),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    }),
  });
  const body = await r.text().catch(() => '');
  if (!r.ok) {
    console.error(`[nowpayments] invoice create failed ${r.status} for ${input.paymentId}: ${body.slice(0, 300)}`);
    throw new Error('Crypto payment processor is unavailable right now — please try again in a minute.');
  }
  let j: any;
  try { j = JSON.parse(body); } catch { j = null; }
  if (!j?.invoice_url) {
    console.error(`[nowpayments] invoice response missing invoice_url for ${input.paymentId}: ${body.slice(0, 300)}`);
    throw new Error('Crypto payment processor returned an unexpected response — please try again.');
  }
  return { invoiceUrl: String(j.invoice_url), invoiceId: String(j.id) };
}

// Hosted invoice page for a stored invoice id (payments.externalRef) — the
// link stays valid until the invoice expires, so "Complete payment" can send
// the client back without any API call.
export function npInvoiceUrl(invoiceId: string) {
  return process.env.NOWPAYMENTS_SANDBOX === 'true'
    ? `https://sandbox.nowpayments.io/payment/?iid=${invoiceId}`
    : `https://nowpayments.io/payment/?iid=${invoiceId}`;
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
