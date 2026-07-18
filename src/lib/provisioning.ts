import { prisma } from './prisma';

export type UnderProvisioned = { id: string; clientId: string; qty: number; live: number; deficit: number };

// The single source of truth for "does this order still need proxies": a PAID
// order that is live (ACTIVE = lost a proxy after provisioning, or PROVISIONING
// = never got its full count because the pool was short) whose effectively-live
// assignments are fewer than the quantity it bought. Deliberately independent of
// the `exception` field, which can drift after manual faulty/release ops — the
// deficit is the real signal the admin asked for («требуется ли замена»). Both
// statuses matter: a client who paid and has zero proxies (PROVISIONING) must
// surface on the same dashboard/bell row as one who lost one (ACTIVE).
export async function underProvisionedOrders(): Promise<UnderProvisioned[]> {
  const orders = await prisma.order.findMany({
    where: { status: { in: ['ACTIVE', 'PROVISIONING'] }, paymentStatus: { in: ['PAID', 'CONFIRMED', 'FREE'] } },
    select: {
      id: true, qty: true, clientId: true,
      // Effectively-serving only: a FAULTY/OFFLINE proxy keeps its assignment
      // open (to heal in place) but is not carrying traffic, so it counts as a
      // deficit — same rule as refreshProvisionException in transitions.ts.
      assignments: { where: { releasedAt: null, proxy: { status: { not: 'FAULTY' }, health: { not: 'OFFLINE' } } }, select: { id: true } },
    },
  });
  return orders
    .filter(o => o.assignments.length < o.qty)
    .map(o => ({ id: o.id, clientId: o.clientId, qty: o.qty, live: o.assignments.length, deficit: o.qty - o.assignments.length }));
}

export async function underProvisionedCount(): Promise<number> {
  return (await underProvisionedOrders()).length;
}
