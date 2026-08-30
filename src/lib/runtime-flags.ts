import { prisma } from './prisma';

// Mock payment methods (card checkout, card deposit) self-confirm with NO
// processor and would hand out proxies/balance for free, so they are FAIL-CLOSED
// (security audit M1): OFF by default and NEVER in production. An absent, empty,
// removed, or misspelled env var therefore DISABLES them. (Previously this was
// fail-open — `!== 'false'` — so dropping the var silently ENABLED free
// payments.) Opt in explicitly, and only outside production, for local/dev
// testing: ALLOW_MOCK_PAYMENTS=true with NODE_ENV != production.
export function mockPaymentsAllowed() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ALLOW_MOCK_PAYMENTS === 'true';
}

// Settings → System Flags → "Freeze new orders" (SystemSetting key 'freezeNewOrders').
export async function newOrdersFrozen() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'freezeNewOrders' } });
  return row?.value === true;
}

// Settings → System Flags → "Auto-fill orders from pool" (key
// 'systemAutoProvisionOnPayment'). Master switch for the sweep's auto-backfill
// of under-provisioned orders. OFF by default (opt-in) — turning it on lets the
// system draw AVAILABLE proxies into deficit orders without an admin, and it
// still respects each order's own autoProvision snapshot (from its plan).
export async function autoBackfillEnabled() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'systemAutoProvisionOnPayment' } });
  return row?.value === true;
}

// Settings → Payment Providers (SystemSetting key 'providers', shape
// { stripe: {enabled}, crypto: {enabled}, … }). A provider that was never
// configured counts as ENABLED — these methods were always offered, so only
// an explicit admin toggle-off removes them from checkout/deposits. In-flight
// payments (e.g. crypto awaiting confirmation) are deliberately unaffected.
export type ProviderKey = 'stripe' | 'crypto' | 'bank' | 'paypal';
export async function enabledProviders(): Promise<Record<ProviderKey, boolean>> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'providers' } });
  const cfg = (row?.value as any) ?? {};
  const on = (k: ProviderKey) => cfg[k]?.enabled !== false;
  return { stripe: on('stripe'), crypto: on('crypto'), bank: on('bank'), paypal: on('paypal') };
}
