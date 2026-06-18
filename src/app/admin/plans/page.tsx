import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { money } from '@/lib/money';
import { TogglePlanButton } from '@/components/admin/ActionButtons';

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

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Plans' }]} action={<Link className="btn primary" href="/admin/plans/new">+ Create plan</Link>} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by plan id, name, pool…' },
            { kind: 'select', name: 'carrier', label: 'All carriers', options: carriers },
            { kind: 'select', name: 'region', label: 'All regions', options: regions },
            { kind: 'select', name: 'duration', label: 'All durations', options: [
              { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' },
            ]},
            { kind: 'select', name: 'status', label: 'All statuses', options: [
              { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Disabled' },
            ]},
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Plan</th><th>Carrier</th><th>Region</th><th>Pool</th><th>Duration</th><th>Price</th><th>Quota</th><th>Allocated</th><th>Available</th><th>Status</th><th>Visibility</th><th>Actions</th></tr></thead>
            <tbody>
              {plans.length === 0 ? (
                <tr><td colSpan={12}><div className="empty"><div className="empty-desc">No plans match these filters.</div></div></td></tr>
              ) : plans.map(p => {
                const allocated = allocMap.get(p.id) ?? 0;
                const avail = Math.max(0, p.availableQuota - allocated);
                const state = avail === 0 && p.availableQuota > 0 ? 'sold-out' : (avail / Math.max(p.availableQuota, 1) < 0.15 ? 'low' : 'available');
                return (
                  <tr key={p.id}>
                    <td><Link href={`/admin/plans/${p.id}`} className="td-link">{p.name}</Link></td>
                    <td>{p.carrier}</td>
                    <td>{p.region}</td>
                    <td>{p.pool}</td>
                    <td className="mono">{p.durationDays} days</td>
                    <td className="mono">{money(Number(p.price))}</td>
                    <td className="mono">{p.availableQuota}</td>
                    <td className="mono">{allocated}</td>
                    <td className="mono">{avail} <span className={`chip ${state === 'low' || state === 'sold-out' ? state.replace('-','') : 'muted'} sm`} style={{ marginLeft: 6 }}>{state}</span></td>
                    <td><span className={`chip ${p.active ? 'success' : 'muted'}`}>{p.active ? 'Active' : 'Disabled'}</span></td>
                    <td><span className={`chip ${p.visibility === 'PUBLIC' ? 'muted' : 'info'}`}>{p.visibility.toLowerCase()}</span></td>
                    <td><TogglePlanButton planId={p.id} active={p.active} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/plans" search={sp} />
      </main>
    </>
  );
}
