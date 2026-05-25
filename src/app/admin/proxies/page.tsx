import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';

export default async function AdminProxiesPage({ searchParams }: { searchParams: { health?: string; status?: string } }) {
  const where: any = {};
  if (searchParams.status) where.status = searchParams.status.toUpperCase();
  if (searchParams.health === 'faulty') where.OR = [{ status: 'FAULTY' }, { health: 'OFFLINE' }];
  if (searchParams.health === 'maintenance') where.status = 'MAINTENANCE';

  const [proxies, total, faulty, maint, available, assigned] = await Promise.all([
    prisma.proxy.findMany({ where, orderBy: { id: 'asc' }, take: 50 }),
    prisma.proxy.count(),
    prisma.proxy.count({ where: { OR: [{ status: 'FAULTY' }, { health: 'OFFLINE' }] } }),
    prisma.proxy.count({ where: { status: 'MAINTENANCE' } }),
    prisma.proxy.count({ where: { status: 'AVAILABLE' } }),
    prisma.proxy.count({ where: { status: 'ASSIGNED' } }),
  ]);

  return (
    <>
      <AdminTopbar title="Proxies" action={<button className="btn primary">+ Register proxy</button>} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/admin/proxies?health=faulty"      className={`tab ${searchParams.health === 'faulty' ? 'active' : ''}`}>⚠ Health Issues <span className="tab-count">{faulty}</span></Link>
          <Link href="/admin/proxies"                     className={`tab ${!searchParams.health && !searchParams.status ? 'active' : ''}`}>All       <span className="tab-count">{total}</span></Link>
          <Link href="/admin/proxies?status=assigned"     className={`tab ${searchParams.status === 'assigned' ? 'active' : ''}`}>Assigned  <span className="tab-count">{assigned}</span></Link>
          <Link href="/admin/proxies?status=available"    className={`tab ${searchParams.status === 'available' ? 'active' : ''}`}>Available <span className="tab-count">{available}</span></Link>
          <Link href="/admin/proxies?health=maintenance"  className={`tab ${searchParams.health === 'maintenance' ? 'active' : ''}`}>Maintenance <span className="tab-count">{maint}</span></Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Proxy</th><th>Order</th><th>Carrier</th><th>Region</th><th>Pool</th><th>Credentials</th><th>Modem</th><th>Uptime</th><th>Health</th></tr></thead>
            <tbody>
              {proxies.map(p => (
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
      </main>
    </>
  );
}
