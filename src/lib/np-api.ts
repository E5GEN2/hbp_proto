// NOWPayments REST reads that need only `fetch` — deliberately NO node:crypto
// import, so the sweep → np-reconcile chain (which the edge instrumentation
// bundle traces) stays edge-safe. Signature verification + payment creation
// (which do need crypto) live in nowpayments.ts, imported only by node routes.

function npApiBase() {
  return process.env.NOWPAYMENTS_SANDBOX === 'true'
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';
}

// A payment's authoritative status from NOWPayments (reconciliation). Best-
// effort: any failure returns null so the caller skips this payment this tick
// rather than throwing. Authenticated by the API KEY (not the IPN secret), so
// it works even when IPN signatures don't.
export async function npGetPayment(npPaymentId: string): Promise<Record<string, any> | null> {
  if (!process.env.NOWPAYMENTS_API_KEY) return null;
  try {
    const r = await fetch(`${npApiBase()}/payment/${encodeURIComponent(npPaymentId)}`, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.warn(`[nowpayments] get payment ${npPaymentId} → ${r.status}`);
      return null;
    }
    return (await r.json()) as Record<string, any>;
  } catch (e) {
    console.warn(`[nowpayments] get payment ${npPaymentId} failed`, e);
    return null;
  }
}
