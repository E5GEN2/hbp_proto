import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { ProxiesBulkTable } from '@/components/admin/ProxiesBulkTable';

const PER_PAGE = 12;

export default async function AdminProxiesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const pool = searchParams.pool ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (carrier) baseWhere.carrier = carrier;
  if (region) baseWhere.region = region;
  if (pool) baseWhere.pool = pool;
  if (q) {
    baseWhere.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { modem: { contains: q, mode: 'insensitive' } },
      { ip: { contains: q, mode: 'insensitive' } },
      { currentOrderId: { contains: q, mode: 'insensitive' } },
    ];
  }

  const viewWhere = (() => {
    if (searchParams.status) return { status: searchParams.status.toUpperCase() as any };
    if (searchParams.health === 'faulty') return { OR: [{ status: 'FAULTY' as const }, { health: 'OFFLINE' as const }] };
    if (searchParams.health === 'maintenance') return { status: 'MAINTENANCE' as const };
    return {};
  })();

  const where = { ...baseWhere, ...viewWhere };

  const [proxies, total, total_all, faulty, maint, available, assigned, catalogItems] = await Promise.all([
    prisma.proxy.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    prisma.proxy.count({ where }),
    prisma.proxy.count({ where: baseWhere }),
    prisma.proxy.count({ where: { ...baseWhere, OR: [{ status: 'FAULTY' }, { health: 'OFFLINE' }] } }),
    prisma.proxy.count({ where: { ...baseWhere, status: 'MAINTENANCE' } }),
    prisma.proxy.count({ where: { ...baseWhere, status: 'AVAILABLE' } }),
    prisma.proxy.count({ where: { ...baseWhere, status: 'ASSIGNED' } }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION', 'POOL'] } } }),
  ]);
  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => c.value);
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => c.value);
  const pools = catalogItems.filter(c => c.kind === 'POOL').map(c => c.value);

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  function tabLink(params: Record<string, string | null>, label: string, count: number, active: boolean, emphasis = false) {
    const tsp = new URLSearchParams(sp);
    tsp.delete('status'); tsp.delete('health'); tsp.delete('page');
    for (const [k, v] of Object.entries(params)) if (v) tsp.set(k, v);
    return (
      <Link href={`/admin/proxies?${tsp.toString()}`} className={`tab ${emphasis ? 'emphasis' : ''} ${active ? 'active' : ''}`}>
        {label}<span className="tab-count">{count}</span>
      </Link>
    );
  }

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Proxies' }]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        {/* Canon (prototype.html proxies): «+ Register proxy» is the primary
            at the RIGHT END of the filter bar, not a topbar action. */}
        <FilterBar
          filters={[
            { kind: 'search', name: 'q' },
            { kind: 'select', name: 'carrier', label: 'Carrier: all', size: 'sm', options: carriers.map(c => ({ value: c, label: c })) },
            { kind: 'select', name: 'region', label: 'Region: all', size: 'md', options: regions.map(r => ({ value: r, label: r })) },
            { kind: 'select', name: 'pool', label: 'Pool: all', size: 'lg', options: pools.map(p => ({ value: p, label: p })) },
          ]}
          action={<Link href="/admin/proxies/new" className="btn primary">+ Register proxy</Link>}
        />

        <div className="panel">
          <div className="tabs">
            {tabLink({ health: 'faulty' }, '⚠ Health Issues', faulty, searchParams.health === 'faulty', true)}
            {tabLink({}, 'All', total_all, !searchParams.health && !searchParams.status)}
            {tabLink({ status: 'assigned' }, 'Assigned', assigned, searchParams.status === 'assigned')}
            {tabLink({ status: 'available' }, 'Available', available, searchParams.status === 'available')}
            {tabLink({ health: 'maintenance' }, 'Maintenance', maint, searchParams.health === 'maintenance')}
          </div>

          <ProxiesBulkTable proxies={proxies.map(p => ({
            id: p.id, currentOrderId: p.currentOrderId, carrier: p.carrier, region: p.region, pool: p.pool,
            ip: p.ip, port: p.port, modem: p.modem, trafficUsedMB: p.trafficUsedMB, uptime: p.uptime, status: p.status,
            registeredAt: p.registeredAt,
          }))} />

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/proxies" search={sp} />
        </div>
      </main>
    </>
  );
}
