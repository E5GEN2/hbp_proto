import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { fmtAdminStamp } from '@/lib/date';
import { money } from '@/lib/money';

export default async function AdminClientsPage({ searchParams }: { searchParams: { status?: string } }) {
  const view = searchParams.status ?? 'all';
  const where = view === 'all' ? { role: 'CLIENT' as const } : { role: 'CLIENT' as const, status: view.toUpperCase() as any };
  const clients = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { orders: true } } },
  });

  const allCount = await prisma.user.count({ where: { role: 'CLIENT' } });
  const activeCount = await prisma.user.count({ where: { role: 'CLIENT', status: 'ACTIVE' } });
  const churnedCount = await prisma.user.count({ where: { role: 'CLIENT', status: 'CHURNED' } });
  const blockedCount = await prisma.user.count({ where: { role: 'CLIENT', status: 'BLOCKED' } });

  return (
    <>
      <AdminTopbar title="Clients" action={<button className="btn primary">+ New Client</button>} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/admin/clients?status=all"     className={`tab ${view === 'all' ? 'active' : ''}`}>All     <span className="tab-count">{allCount}</span></Link>
          <Link href="/admin/clients?status=active"  className={`tab ${view === 'active' ? 'active' : ''}`}>Active  <span className="tab-count">{activeCount}</span></Link>
          <Link href="/admin/clients?status=churned" className={`tab ${view === 'churned' ? 'active' : ''}`}>Churned <span className="tab-count">{churnedCount}</span></Link>
          <Link href="/admin/clients?status=blocked" className={`tab ${view === 'blocked' ? 'active' : ''}`}>Blocked <span className="tab-count">{blockedCount}</span></Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Client</th><th>ID</th><th>Tier</th><th>Country</th><th>Orders</th><th>Balance</th><th>Status</th><th>Risk</th><th>Joined</th></tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/clients/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="avatar">{c.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</span>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email}{c.telegram && ` · ${c.telegram}`}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="mono">{c.id}</td>
                  <td><span className={`chip ${c.tier === 'VIP' ? 'accent' : c.tier === 'PRO' ? 'info' : 'muted'}`}>{c.tier.toLowerCase()}</span></td>
                  <td>{c.country ?? '—'}</td>
                  <td className="mono">{c._count.orders}</td>
                  <td className="mono">{money(Number(c.balance))}</td>
                  <td><span className={`chip ${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span></td>
                  <td><span className={`chip ${c.risk === 'NONE' ? 'muted' : c.risk.toLowerCase()}`}>{c.risk.toLowerCase()}</span></td>
                  <td>{fmtAdminStamp(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
