import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { fmtAdminStamp } from '@/lib/date';

export default async function AdminLogsPage({ searchParams }: { searchParams: { type?: string } }) {
  const t = searchParams.type ?? 'all';
  const where = t === 'all' ? {} : { objectType: t.toUpperCase() as any };
  const logs = await prisma.log.findMany({
    where, orderBy: { at: 'desc' }, take: 60,
    include: { actor: { select: { id: true, name: true, role: true, initials: true } } },
  });

  return (
    <>
      <AdminTopbar title="Admin Logs" />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/admin/logs?type=all"      className={`tab ${t === 'all' ? 'active' : ''}`}>All events</Link>
          <Link href="/admin/logs?type=order"    className={`tab ${t === 'order' ? 'active' : ''}`}>Orders</Link>
          <Link href="/admin/logs?type=payment"  className={`tab ${t === 'payment' ? 'active' : ''}`}>Payments</Link>
          <Link href="/admin/logs?type=proxy"    className={`tab ${t === 'proxy' ? 'active' : ''}`}>Proxies</Link>
          <Link href="/admin/logs?type=client"   className={`tab ${t === 'client' ? 'active' : ''}`}>Clients</Link>
          <Link href="/admin/logs?type=plan"     className={`tab ${t === 'plan' ? 'active' : ''}`}>Plans</Link>
          <Link href="/admin/logs?type=system"   className={`tab ${t === 'system' ? 'active' : ''}`}>System</Link>
          <Link href="/admin/logs?type=auth"     className={`tab ${t === 'auth' ? 'active' : ''}`}>Auth</Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Admin</th><th>Action</th><th>Object</th><th>Timestamp</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td>{l.actor ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{l.actor.initials ?? l.actor.name.charAt(0)}</span>
                      <span>{l.actor.name}</span>
                    </span>
                  ) : '—'}</td>
                  <td><span className="chip muted">{l.action}</span></td>
                  <td className="mono">{l.objectId ?? '—'}</td>
                  <td>{fmtAdminStamp(l.at)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
