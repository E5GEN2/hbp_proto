import { prisma } from './prisma';
import type { OrderStatus } from '@prisma/client';

// Order statuses that HOLD plan capacity. Single source of truth for the
// quota math — checkout's per-location "available" and the plan-card sold-out
// marking must agree, or a card would open a checkout that disagrees with it.
export const CAPACITY_HOLDING_STATUSES: OrderStatus[] = ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'];

// Seats currently held per plan, one grouped query (checkout used to run one
// aggregate per plan — same numbers, N fewer round-trips).
export async function allocatedByPlan(planIds: string[]): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map();
  const grouped = await prisma.order.groupBy({
    by: ['planId'],
    _sum: { qty: true },
    where: { planId: { in: planIds }, status: { in: CAPACITY_HOLDING_STATUSES } },
  });
  return new Map(grouped.map(g => [g.planId, g._sum.qty ?? 0]));
}

// Durations whose EVERY live location variant is at capacity (remaining
// quota 0 across all of them). Mirrors checkout's sellability exactly: same
// plan filter (active + public + not deleted), same live-region gate (plans
// whose denormalized region string no longer matches an enabled REGION
// catalog item are not sellable), same seat math. capacityState is NOT
// consulted — checkout ignores it too; it only drives card visibility.
// Plan cards for these durations open the sold-out → Telegram dialog instead
// of leading the client into a checkout where nothing can be bought.
export async function fullySoldOutDurations(): Promise<Set<number>> {
  const [plans, liveRegionItems] = await Promise.all([
    prisma.plan.findMany({
      where: { active: true, visibility: 'PUBLIC', deletedAt: null },
      select: { id: true, durationDays: true, availableQuota: true, region: true },
    }),
    prisma.catalogItem.findMany({ where: { kind: 'REGION', enabled: true }, select: { value: true } }),
  ]);
  const liveRegions = new Set(liveRegionItems.map(r => r.value));
  const sellable = plans.filter(p => liveRegions.has(p.region));
  const alloc = await allocatedByPlan(sellable.map(p => p.id));

  const remainingByDuration = new Map<number, number>();
  for (const p of sellable) {
    const remaining = Math.max(0, p.availableQuota - (alloc.get(p.id) ?? 0));
    remainingByDuration.set(p.durationDays, (remainingByDuration.get(p.durationDays) ?? 0) + remaining);
  }
  const soldOut = new Set<number>();
  for (const [duration, remaining] of remainingByDuration) {
    if (remaining === 0) soldOut.add(duration);
  }
  return soldOut;
}
