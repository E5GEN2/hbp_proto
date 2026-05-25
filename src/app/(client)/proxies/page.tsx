import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';

export default async function ClientProxiesPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const assignments = await prisma.assignment.findMany({
    where: { order: { clientId: userId }, releasedAt: null },
    include: { proxy: true, order: { include: { plan: true } } },
  });

  return (
    <>
      <ClientTopbar title="Proxies" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="filter-bar">
          <input className="form-input search" placeholder="Search…" />
          <select className="form-select"><option>All carriers</option><option>Verizon</option><option>T-Mobile</option><option>AT&T</option></select>
          <div className="spacer" />
          <Link href="/catalog" className="btn primary">Buy proxies</Link>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead><tr><th>Proxy</th><th>Order</th><th>Carrier</th><th>Region</th><th>Auto rotation</th><th>Uptime</th><th>Speed</th><th>Health</th></tr></thead>
            <tbody>
              {assignments.length === 0
                ? <tr><td colSpan={8}><div className="empty"><div className="empty-title">No proxies yet</div><div className="empty-desc">Buy a plan to provision your first proxy.</div></div></td></tr>
                : assignments.map(a => (
                  <tr key={a.id}>
                    <td><Link href={`/proxies/${a.proxy.id}`} className="mono td-link">{a.proxy.id}</Link></td>
                    <td><Link href={`/orders/${a.order.id}`} className="mono td-link">{a.order.id}</Link></td>
                    <td>{a.proxy.carrier}</td>
                    <td>{a.proxy.region}</td>
                    <td className="mono">{a.proxy.autoRotateMin ? `${a.proxy.autoRotateMin} min` : '—'}</td>
                    <td className="mono">{a.proxy.uptime.toFixed(1)}%</td>
                    <td className="mono">{a.proxy.speedMbps} Mbps</td>
                    <td><span className={`chip ${a.proxy.health.toLowerCase()}`}>{a.proxy.health.toLowerCase()}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
