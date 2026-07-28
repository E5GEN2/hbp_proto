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

// ── Assign/Replace candidate lists (admin pickers) ────────────────────────
// Two groups, both AVAILABLE+HEALTHY: proxies matching the order's plan
// contract (carrier+region — the same predicate every automated matcher
// uses), and everything else as an explicit admin override. Pool is NOT a
// filter anywhere in the system (soft routing preference only) — it is
// surfaced per row so the admin sees where each proxy lives.
export type AssignCandidate = {
  id: string; carrier: string; region: string; pool: string;
  ip: string; port: number; health: string;
};
export type AssignCandidates = {
  matching: AssignCandidate[];
  others: AssignCandidate[];
  plan: { carrier: string; region: string; pool: string };
  // Live raw open-slot deficit (qty − open assignments) — the modal caps its
  // selection on THIS, not the page-render-time prop, so a grown deficit or a
  // concurrent assign is reflected the moment the picker opens.
  deficit: number;
};

export async function listAssignCandidates(orderId: string): Promise<AssignCandidates> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { qty: true, region: true, plan: { select: { carrier: true, pool: true } }, _count: { select: { assignments: { where: { releasedAt: null } } } } },
  });
  if (!order) throw new Error('Order not found');
  const deficit = Math.max(0, order.qty - order._count.assignments);
  const sel = { id: true, carrier: true, region: true, pool: true, ip: true, port: true, health: true };
  const [matching, others] = await Promise.all([
    prisma.proxy.findMany({
      where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY' },
      select: sel, orderBy: [{ pool: 'asc' }, { id: 'asc' }], take: 100,
    }),
    prisma.proxy.findMany({
      where: {
        NOT: { carrier: order.plan.carrier, region: order.region },
        status: 'AVAILABLE', health: 'HEALTHY',
      },
      select: sel, orderBy: [{ carrier: 'asc' }, { region: 'asc' }, { pool: 'asc' }, { id: 'asc' }], take: 100,
    }),
  ]);
  // Plan-pool proxies float to the top of the matching group.
  matching.sort((a, b) => Number(b.pool === order.plan.pool) - Number(a.pool === order.plan.pool));
  return { matching, others, plan: { carrier: order.plan.carrier, region: order.region, pool: order.plan.pool }, deficit };
}
