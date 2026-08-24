import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { PlanShowcase } from '@/components/client/PlanShowcase';
import { collapseLiveByDuration } from '@/lib/plan-tiers';
import { fullySoldOutDurations } from '@/lib/plan-availability';
import { purchaseUnitPrice } from '@/lib/renewal';

export default async function CatalogPage() {
  const session = await getServerSession(authOptions);
  const [me, plans, soldOutDurations] = await Promise.all([
    prisma.user.findUnique({ where: { id: session!.user.id } }),
    prisma.plan.findMany({
      where: { active: true, visibility: 'PUBLIC', deletedAt: null },
      orderBy: { durationDays: 'asc' },
    }),
    fullySoldOutDurations(),
  ]);
  // One card per DURATION (same-duration location variants collapse; the
  // Location choice lives inside checkout). Cap 3 durations. A duration with
  // zero remaining quota in EVERY location keeps its card but the CTA opens
  // the sold-out → Telegram dialog (PlanShowcase) instead of checkout.
  // Card price carries the client-level discount (owner decision 2026-08-22) —
  // the signed-in client sees THEIR price, same helper checkout charges with.
  const sellable = collapseLiveByDuration(plans
    .filter(p => p.capacityState !== 'SOLD_OUT')
    .map(p => ({ durationDays: p.durationDays, price: purchaseUnitPrice(Number(p.price), me?.clientDiscountPct) })))
    .map(p => (soldOutDurations.has(p.durationDays) ? { ...p, soldOut: true } : p));

  return (
    <>
      <ClientTopbar
        breadcrumb={[{ label: 'Orders', href: '/orders' }, { label: 'Catalog' }]}
        balance={Number(me?.balance ?? 0)}
      />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Choose Your Plan</span>
            </div>
            <div className="panel-body">
              <PlanShowcase plans={sellable} hrefFor={d => `/checkout?duration=${d}`} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
