import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { ProxiesToolbar } from '@/components/admin/toolbars/ProxiesToolbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';

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

  function tabLink(params: Record<string, string | null>, label: string, count: number, active: boolean) {
    const tsp = new URLSearchParams(sp);
    tsp.delete('status'); tsp.delete('health'); tsp.delete('page');
    for (const [k, v] of Object.entries(params)) if (v) tsp.set(k, v);
    return (
      <Link href={`/admin/proxies?${tsp.toString()}`} className={`tab ${active ? 'active' : ''}`}>
        {label}<span className="tab-count">{count}</span>
      </Link>
    );
  }

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Proxies' }]} action={<ProxiesToolbar carriers={carriers} regions={regions} pools={pools} />} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {tabLink({ health: 'faulty' }, '⚠ Health Issues', faulty, searchParams.health === 'faulty')}
          {tabLink({}, 'All', total_all, !searchParams.health && !searchParams.status)}
          {tabLink({ status: 'assigned' }, 'Assigned', assigned, searchParams.status === 'assigned')}
          {tabLink({ status: 'available' }, 'Available', available, searchParams.status === 'available')}
          {tabLink({ health: 'maintenance' }, 'Maintenance', maint, searchParams.health === 'maintenance')}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by proxy id, modem, IP, order…' },
            { kind: 'select', name: 'carrier', label: 'All carriers', options: carriers.map(c => ({ value: c, label: c })) },
            { kind: 'select', name: 'region', label: 'All regions', options: regions.map(r => ({ value: r, label: r })) },
            { kind: 'select', name: 'pool', label: 'All pools', options: pools.map(p => ({ value: p, label: p })) },
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Proxy</th><th>Order</th><th>Carrier</th><th>Region</th><th>Pool</th><th>Credentials</th><th>Modem</th><th>Uptime</th><th>Health</th></tr></thead>
            <tbody>
              {proxies.length === 0 ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-desc">No proxies match these filters.</div></div></td></tr>
              ) : proxies.map(p => (
                <tr key={p.id}>
                  <td><Link href={`/admin/proxies/${p.id}`} className="mono td-link">{p.id}</Link></td>
                  <td>{p.currentOrderId ? <Link href={`/admin/orders/${p.currentOrderId}`} className="mono td-link">{p.currentOrderId}</Link> : '—'}</td>
                  <td>{p.carrier}</td>
                  <td>{p.region}</td>
                  <td>{p.pool}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{p.ip}:{p.port}</td>
                  <td className="mono">{p.modem}</td>
                  <td className="mono">{p.uptime.toFixed(1)}%</td>
                  <td>
                    <span className={`chip ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span>
                    {p.health !== 'HEALTHY' && <span className={`chip ${p.health.toLowerCase()} sm`} style={{ marginLeft: 4 }}>{p.health.toLowerCase()}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/proxies" search={sp} />
      </main>
    </>
  );
}
