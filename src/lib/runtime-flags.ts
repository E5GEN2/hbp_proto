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
