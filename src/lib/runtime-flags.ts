import { prisma } from './prisma';

// Mock payment methods (card checkout, card deposit) stay enabled by default on
// this prototype deployment. Set ALLOW_MOCK_PAYMENTS=false on the service before
// opening the portal to real clients — the card paths self-confirm without a
// processor and would hand out proxies/balance for free.
export function mockPaymentsAllowed() {
  return process.env.ALLOW_MOCK_PAYMENTS !== 'false';
}

// Settings → System Flags → "Freeze new orders" (SystemSetting key 'freezeNewOrders').
export async function newOrdersFrozen() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'freezeNewOrders' } });
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
