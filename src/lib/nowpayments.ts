import crypto from 'crypto';

/**
 * NOWPayments gateway — same provider + secrets as the HighBid marketplace.
 *
 * Flow: create a hosted invoice (POST /invoice with x-api-key), redirect the
 * buyer to invoice_url, and confirm out-of-band via the IPN webhook, whose
 * payload is signed with HMAC-SHA512 over the *sorted* JSON using
 * NOWPAYMENTS_IPN_SECRET.
 *
 * Env:
 *   NOWPAYMENTS_API_KEY     — invoice creation
 *   NOWPAYMENTS_IPN_SECRET  — webhook signature verification
 *   NOWPAYMENTS_SANDBOX     — "true" => sandbox API
 *   NEXTAUTH_URL            — base URL for ipn/success/cancel callbacks
 */

const API_URL =
  process.env.NOWPAYMENTS_SANDBOX === 'true'
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';

const API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || '';

export function isNowPaymentsConfigured(): boolean {
  return !!API_KEY;
}

export function appBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export type CreateInvoiceResult =
  | { ok: true; id: string; invoiceUrl: string }
  | { ok: false; error: string };

/**
 * Create a hosted NOWPayments invoice. `reference` is echoed back as
 * `order_id` in the IPN — we use the hbp Order id (ORD-…) for order checkouts
 * and the Payment id (PAY-…) for balance deposits so the webhook can route it.
 */
export async function createInvoice(opts: {
  reference: string;
  amount: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CreateInvoiceResult> {
  if (!API_KEY) return { ok: false, error: 'Payment provider not configured' };

  const body = {
    price_amount: opts.amount,
    price_currency: 'usd',
    order_id: opts.reference,
    order_description: opts.description,
    ipn_callback_url: `${appBaseUrl()}/api/nowpayments/webhook`,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  };

  try {
    const res = await fetch(`${API_URL}/invoice`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[nowpayments] invoice creation failed', res.status, text);
      return { ok: false, error: 'Failed to create payment invoice' };
    }
    const inv = (await res.json()) as { id: string | number; invoice_url: string };
    return { ok: true, id: String(inv.id), invoiceUrl: inv.invoice_url };
  } catch (e) {
    console.error('[nowpayments] invoice creation error', e);
    return { ok: false, error: 'Failed to create payment invoice' };
  }
}

/** Recursively sort object keys — required to reproduce NOWPayments' HMAC. */
function sortObject(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Verify an IPN payload against the `x-nowpayments-sig` header. Runs in every
 * environment — a missing secret or signature fails closed.
 */
export function verifyIpnSignature(payload: unknown, signature: string): boolean {
  if (!IPN_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha512', IPN_SECRET)
    .update(JSON.stringify(sortObject(payload)))
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
