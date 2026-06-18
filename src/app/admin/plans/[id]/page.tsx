import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { PlanForm } from '@/components/admin/PlanForm';
import type { PlanInput } from '@/lib/transitions';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

export const dynamic = 'force-dynamic';

export default async function AdminEditPlanPage({ params }: { params: { id: string } }) {
  const plan = await prisma.plan.findUnique({ where: { id: params.id } });
  if (!plan || plan.deletedAt) notFound();

  const allocAgg = await prisma.order.aggregate({
    _sum: { qty: true },
    where: { planId: plan.id, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
  });
  const allocated = allocAgg._sum.qty ?? 0;
  const displayAvailable = Math.max(0, plan.availableQuota - allocated);
  const state =
    displayAvailable === 0 && plan.availableQuota > 0 ? 'sold-out'
    : plan.availableQuota > 0 && displayAvailable / plan.availableQuota < 0.15 ? 'low'
    : 'available';

  const activeOrders = await prisma.order.count({ where: { planId: plan.id, status: { in: ['ACTIVE', 'PROVISIONING', 'NEW', 'PENDING_RENEWAL'] } } });

  const catalog = await loadCatalog();

  const initial: Partial<PlanInput> = {
    name: plan.name,
    description: plan.description,
    visibility: plan.visibility,
    carrier: plan.carrier,
    region: plan.region,
    pool: plan.pool,
    durationDays: plan.durationDays,
    price: Number(plan.price),
    currency: plan.currency,
    availableQuota: plan.availableQuota,
    protocols: plan.protocols,
    rotation: plan.rotation,
    traffic: plan.traffic,
    active: plan.active,
    autoProvision: plan.autoProvision,
    autoRenewDefault: plan.autoRenewDefault,
    renewalAllowed: plan.renewalAllowed,
    preRenewalReminderHours: plan.preRenewalReminderHours,
    gracePeriodHours: plan.gracePeriodHours,
    renewalDiscountPct: plan.renewalDiscountPct,
    lowCapacityThresholdPct: plan.lowCapacityThresholdPct,
  };

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Plans', href: '/admin/plans' },
        { label: plan.name },
      ]} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1416, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{plan.id}</span>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>· SKU {plan.internalSku ?? '—'}</span>
          <span className={`chip ${plan.active ? 'success' : 'muted'}`}>{plan.active ? 'Active' : 'Disabled'}</span>
          <span className={`chip ${plan.visibility === 'PUBLIC' ? 'muted' : 'info'}`}>{plan.visibility.toLowerCase()}</span>
        </div>
        <PlanForm
          mode="edit"
          planId={plan.id}
          initial={initial}
          catalog={catalog}
          capacity={{ allocated, displayAvailable, state }}
          canDelete={activeOrders === 0}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16, alignItems: 'start' }}>

          <EntityNotesPanel objectType="PLAN" objectId={plan.id} />

          <EntityActivityWidget objectType="PLAN" objectId={plan.id} />
        </div>
      </main>
    </>
  );
}

async function loadCatalog() {
  const items = await prisma.catalogItem.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] });
  const group = (kind: string) => items.filter(i => i.kind === kind).map(i => ({ value: i.value }));
  return {
    carriers: group('CARRIER'),
    regions: group('REGION'),
    pools: group('POOL'),
    protocols: group('PROTOCOL'),
    rotations: group('ROTATION'),
    traffic: group('TRAFFIC'),
    durations: group('DURATION'),
    currencies: group('CURRENCY'),
  };
}
