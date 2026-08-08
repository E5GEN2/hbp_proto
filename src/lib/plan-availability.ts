import { prisma } from './prisma';
import type { OrderStatus, CapacityState } from '@prisma/client';

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

type PlanCapacityLite = {
  id: string;
  durationDays: number;
  availableQuota: number;
  region: string;
  capacityState: CapacityState | null;
};

// Pure core of fullySoldOutDurations (unit-tested). Given the active+PUBLIC+
// not-deleted plans, the live-region set, and held seats per plan, return the
// durations whose plan CARD leads nowhere buyable.
//
// Two plan universes on purpose, because the card and checkout filter plans
// differently and a mismatch is exactly the dead end this closes:
//   • cardedDurations — durations that RENDER a card. The card build drops
//     capacityState==='SOLD_OUT' before collapsing by duration, so a card
//     exists for a duration iff it has ≥1 non-SOLD_OUT plan.
//   • purchasableByDuration — checkout's OWN seat math: only live-region
//     plans count (checkout drops plans whose denormalized region string no
//     longer matches an enabled REGION catalog item; capacityState is NOT
//     consulted — checkout ignores it too). remaining = quota − held seats.
// A carded duration with zero purchasable seats (all taken OR every location
// removed from the catalog) is sold out.
export function computeSoldOutDurations(
  plans: PlanCapacityLite[],
  liveRegions: Set<string>,
  allocated: Map<string, number>,
): Set<number> {
  const cardedDurations = new Set(plans.filter(p => p.capacityState !== 'SOLD_OUT').map(p => p.durationDays));

  const purchasableByDuration = new Map<number, number>();
  for (const p of plans) {
    if (!liveRegions.has(p.region)) continue; // checkout drops dead-region plans
    const free = Math.max(0, p.availableQuota - (allocated.get(p.id) ?? 0));
    purchasableByDuration.set(p.durationDays, (purchasableByDuration.get(p.durationDays) ?? 0) + free);
  }

  const soldOut = new Set<number>();
  for (const duration of cardedDurations) {
    // Absent from the map (no live-region plan for the duration) → 0 → sold out.
    if ((purchasableByDuration.get(duration) ?? 0) === 0) soldOut.add(duration);
  }
  return soldOut;
}

// Durations whose plan CARD leads nowhere buyable — see computeSoldOutDurations.
// Plan cards for these durations open the sold-out → Telegram dialog instead of
// leading the client into a checkout where nothing can be bought.
export async function fullySoldOutDurations(): Promise<Set<number>> {
  const [plans, liveRegionItems] = await Promise.all([
    prisma.plan.findMany({
      where: { active: true, visibility: 'PUBLIC', deletedAt: null },
      select: { id: true, durationDays: true, availableQuota: true, region: true, capacityState: true },
    }),
    prisma.catalogItem.findMany({ where: { kind: 'REGION', enabled: true }, select: { value: true } }),
  ]);
  const liveRegions = new Set(liveRegionItems.map(r => r.value));
  const sellableIds = plans.filter(p => liveRegions.has(p.region)).map(p => p.id);
  const allocated = await allocatedByPlan(sellableIds);
  return computeSoldOutDurations(plans, liveRegions, allocated);
}
