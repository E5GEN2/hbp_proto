import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { PlansBulkTable } from '@/components/admin/PlansBulkTable';

const PER_PAGE = 12;

export default async function AdminPlansPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const duration = searchParams.duration ?? '';
  const status = searchParams.status ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const where: any = { deletedAt: null };
  if (carrier) where.carrier = carrier;
  if (region) where.region = region;
  if (duration) where.durationDays = parseInt(duration, 10);
  if (status === 'active') where.active = true;
  if (status === 'inactive') where.active = false;
  if (q) {
    where.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { pool: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [plans, total, allocations, catalogItems] = await Promise.all([
    prisma.plan.findMany({ where, orderBy: { durationDays: 'asc' }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    prisma.plan.count({ where }),
    prisma.order.groupBy({
      by: ['planId'],
      where: { status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
      _sum: { qty: true },
    }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } }),
  ]);
  const allocMap = new Map(allocations.map(a => [a.planId, a._sum.qty ?? 0]));
  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  const rows = plans.map(p => {
    const allocated = allocMap.get(p.id) ?? 0;
    const available = Math.max(0, p.availableQuota - allocated);
    const capacityState: 'sold-out' | 'low' | 'available' =
      available === 0 && p.availableQuota > 0 ? 'sold-out'
      : (p.availableQuota > 0 && available / p.availableQuota < 0.15 ? 'low' : 'available');
    return {
      id: p.id, name: p.name, carrier: p.carrier, region: p.region, pool: p.pool,
      durationDays: p.durationDays, price: Number(p.price), quota: p.availableQuota,
      allocated, available, capacityState, active: p.active,
    };
  });

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Plans' }]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by plan id, name, pool…' },
            { kind: 'select', name: 'carrier', label: 'Carrier: all', size: 'sm', options: carriers },
            { kind: 'select', name: 'region', label: 'Region: all', size: 'md', options: regions },
            { kind: 'select', name: 'duration', label: 'Duration: all', size: 'sm', options: [
              { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' },
            ]},
            { kind: 'select', name: 'status', label: 'Status: all', size: 'sm', options: [
              { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Disabled' },
            ]},
          ]}
          action={<Link className="btn primary" href="/admin/plans/new">+ Create plan</Link>}
        />

        <div className="panel">
          <div className="panel-header"><span className="panel-title">Plan catalog</span></div>
          <PlansBulkTable plans={rows} />
          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/plans" search={sp} />
        </div>
      </main>
    </>
  );
}
