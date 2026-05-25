import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

export default async function AdminDashboardPage() {
  const [
    paidToday, revenue30dAgg, activeOrders, activeClients, expiringToday, inGrace,
    recentOrders, capacityRows, exceptions, healthBuckets,
  ] = await Promise.all([
    prisma.payment.aggregate({
      _sum: { net: true },
      where: { status: { in: ['CONFIRMED', 'PAID'] }, confirmedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.payment.aggregate({
      _sum: { net: true },
      where: { status: { in: ['CONFIRMED', 'PAID'] }, confirmedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.order.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'ACTIVE' } }),
    prisma.order.count({
      where: { status: 'ACTIVE', expiresAt: { gte: new Date(new Date().setHours(0,0,0,0)), lte: new Date(new Date().setHours(23,59,59,999)) } },
    }),
    prisma.order.count({ where: { renewalBucket: 'GRACE' } }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { client: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } },
    }),
    prisma.plan.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { durationDays: 'asc' },
      take: 6,
    }),
    prisma.order.findMany({
      where: { exception: { not: null } },
      take: 10,
    }),
    Promise.all([
      prisma.proxy.count({ where: { OR: [{ status: 'FAULTY' }, { health: 'OFFLINE' }] } }),
      prisma.proxy.count({ where: { status: 'MAINTENANCE' } }),
    ]),
  ]);

  const [faulty, maintenance] = healthBuckets;

  // capacity computation
  async function capacityFor(planId: string) {
    const a = await prisma.order.aggregate({
      _sum: { qty: true },
      where: { planId, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    return a._sum.qty ?? 0;
  }
  const capacity = await Promise.all(capacityRows.map(async p => {
    const allocated = await capacityFor(p.id);
    const displayAvail = Math.max(0, p.availableQuota - allocated);
    let state: string = 'available';
    if (displayAvail === 0 && p.availableQuota > 0) state = 'sold-out';
    else if (p.capacityState === 'BLOCKED_GRACE') state = 'blocked-grace';
    else if (p.capacityState === 'WAITING_RELEASE') state = 'waiting-release';
    else if (displayAvail / p.availableQuota < 0.15) state = 'low';
    return { plan: p, allocated, displayAvail, state };
  }));

  return (
    <>
      <AdminTopbar title="Dashboard" action={<button className="btn primary">+ New Order</button>} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        {/* KPI strip — 6 tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
          <Kpi label="Paid today"       value={money(Number(paidToday._sum.net ?? 0))}      tone="success" />
          <Kpi label="Revenue 30D"      value={money(Number(revenue30dAgg._sum.net ?? 0))} tone="success" />
          <Kpi label="Active orders"    value={String(activeOrders)}                       tone="violet" />
          <Kpi label="Active clients"   value={String(activeClients)}                      tone="violet" />
          <Kpi label="Expiring today"   value={String(expiringToday)}                      tone="warning" />
          <Kpi label="In grace period"  value={String(inGrace)}                            tone="danger" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Recent orders */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Recent orders</span>
                <Link className="panel-action" href="/admin/orders">View all →</Link>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Client</th>
                    <th>Plan</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(o => (
                    <tr key={o.id}>
                      <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                      <td><Link href={`/admin/clients/${o.client.id}`} className="mono td-link">{o.client.id}</Link></td>
                      <td>{o.plan.name}</td>
                      <td>{money(Number(o.amount))}</td>
                      <td><span className={`chip ${o.paymentStatus.toLowerCase()}`}>{o.paymentStatus.toLowerCase()}</span></td>
                      <td><span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span></td>
                      <td>{fmtAdminStamp(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Capacity */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Selling capacity by plan</span>
                <Link className="panel-action" href="/admin/plans">Manage plans →</Link>
              </div>
              <table className="table">
                <thead>
                  <tr><th>Plan</th><th>Quota</th><th>Allocated</th><th>Available</th><th>Capacity</th></tr>
                </thead>
                <tbody>
                  {capacity.map(c => (
                    <tr key={c.plan.id}>
                      <td><Link href={`/admin/plans/${c.plan.id}`} className="td-link">{c.plan.name}</Link></td>
                      <td className="mono">{c.plan.availableQuota}</td>
                      <td className="mono">{c.allocated}</td>
                      <td className="mono">{c.displayAvail}</td>
                      <td><span className={`chip ${c.state === 'sold-out' || c.state === 'low' ? c.state.replace('-','') : 'muted'}`}>{c.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Exceptions</span></div>
              <div className="panel-body" style={{ padding: 0 }}>
                {exceptions.length === 0 ? (
                  <div className="empty"><div className="empty-desc">No exceptions in queue.</div></div>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {exceptions.slice(0, 5).map(o => (
                      <li key={o.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <Link href={`/admin/orders/${o.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="mono td-link" style={{ fontSize: 12 }}>{o.id}</span>
                          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--muted)' }}>{o.exception?.toLowerCase().replace(/_/g, ' ')}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Proxy health</span></div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                <li style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                  <Link href="/admin/proxies?health=faulty" className="td-link">Faulty / offline</Link>
                  <span className="mono" style={{ color: 'var(--danger)', fontWeight: 600 }}>{faulty}</span>
                </li>
                <li style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between' }}>
                  <Link href="/admin/proxies?health=maintenance" className="td-link">Maintenance</Link>
                  <span className="mono" style={{ color: 'var(--warning)', fontWeight: 600 }}>{maintenance}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px', borderLeft: `3px solid var(--${tone})` }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{value}</div>
    </div>
  );
}
