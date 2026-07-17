import { prisma } from './prisma';

export type UnderProvisioned = { id: string; clientId: string; qty: number; live: number; deficit: number };

// The single source of truth for "does this order still need proxies": an ACTIVE
// paid order whose LIVE assignments are fewer than the quantity it bought. This
// is deliberately independent of the `exception` field, which can drift after
// manual faulty/release operations — the deficit is the real signal the admin
// asked for («требуется ли замена»).
export async function underProvisionedOrders(): Promise<UnderProvisioned[]> {
  const orders = await prisma.order.findMany({
    where: { status: 'ACTIVE', paymentStatus: { in: ['PAID', 'CONFIRMED', 'FREE'] } },
    select: {
      id: true, qty: true, clientId: true,
      assignments: { where: { releasedAt: null }, select: { id: true } },
    },
  });
  return orders
    .filter(o => o.assignments.length < o.qty)
    .map(o => ({ id: o.id, clientId: o.clientId, qty: o.qty, live: o.assignments.length, deficit: o.qty - o.assignments.length }));
}

export async function underProvisionedCount(): Promise<number> {
  return (await underProvisionedOrders()).length;
}
