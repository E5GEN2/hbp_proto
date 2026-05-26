import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { OrdersToolbar } from '@/components/admin/toolbars/OrdersToolbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

export default async function AdminOrdersPage({ searchParams }: { searchParams: { view?: string } }) {
  const view = searchParams.view ?? 'all';
  const where = (() => {
    switch (view) {
      case 'new':          return { status: 'NEW' as const };
      case 'awaiting':     return { paymentStatus: { in: ['AWAITING', 'PENDING'] as any }, status: { not: 'NEW' as const } };
      case 'provisioning': return { status: 'PROVISIONING' as const };
      case 'active':       return { status: 'ACTIVE' as const };
      case 'expired':      return { status: 'EXPIRED' as const };
      case 'cancelled':    return { status: 'CANCELLED' as const };
      case 'exceptions':   return { exception: { not: null } };
      default:             return {};
    }
  })();

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { client: true, plan: true },
    take: 50,
  });

  // Prefetch options for the New Order modal
  const [allClients, allPlans] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'CLIENT', status: { not: 'BLOCKED' } },
      select: { id: true, name: true, email: true, balance: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.plan.findMany({
      where: { active: true, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
  ]);
  const allocByPlan = new Map(
    (await prisma.order.groupBy({
      by: ['planId'],
      where: { status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
      _sum: { qty: true },
    })).map(a => [a.planId, a._sum.qty ?? 0])
  );
  const clientOpts = allClients.map(c => ({ id: c.id, name: c.name, email: c.email, balance: Number(c.balance) }));
  const planOpts = allPlans.map(p => ({
    id: p.id, name: p.name, price: Number(p.price), durationDays: p.durationDays,
    carrier: p.carrier, region: p.region,
    available: Math.max(0, p.availableQuota - (allocByPlan.get(p.id) ?? 0)),
  }));

  const counts = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  const exceptionCount = await prisma.order.count({ where: { exception: { not: null } } });
  const ct = (s: string) => counts.find(c => c.status === s)?._count._all ?? 0;
  const tabs = [
    { v: 'exceptions',   l: '⚠ Exceptions',    n: exceptionCount },
    { v: 'all',          l: 'All',              n: counts.reduce((s, c) => s + c._count._all, 0) },
    { v: 'new',          l: 'New',              n: ct('NEW') },
    { v: 'awaiting',     l: 'Awaiting Payment', n: 0 },
    { v: 'provisioning', l: 'Provisioning',     n: ct('PROVISIONING') },
    { v: 'active',       l: 'Active',           n: ct('ACTIVE') },
    { v: 'expired',      l: 'Expired',          n: ct('EXPIRED') },
    { v: 'cancelled',    l: 'Cancelled',        n: ct('CANCELLED') },
  ];

  return (
    <>
      <AdminTopbar title="Orders" action={<OrdersToolbar clients={clientOpts} plans={planOpts} />} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          {tabs.map(t => (
            <Link key={t.v} href={`/admin/orders?view=${t.v}`} className={`tab ${view === t.v ? 'active' : ''}`}>
              {t.l}{t.n > 0 && <span className="tab-count">{t.n}</span>}
            </Link>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order ID</th><th>Client</th><th>Plan</th><th>Carrier</th><th>Region</th><th>Amount</th><th>Payment</th><th>Status</th><th>Created</th><th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={10}><div className="empty"><div className="empty-desc">No orders match this view.</div></div></td></tr>
              ) : orders.map(o => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                  <td><Link href={`/admin/clients/${o.client.id}`} className="mono td-link">{o.client.id}</Link></td>
                  <td>{o.plan.name}</td>
                  <td>{o.plan.carrier}</td>
                  <td>{o.region}</td>
                  <td>{money(Number(o.amount))}</td>
                  <td><span className={`chip ${o.paymentStatus.toLowerCase()}`}>{o.paymentStatus.toLowerCase()}</span></td>
                  <td>
                    {o.exception ? (
                      <span className="chip danger">{o.exception.toLowerCase().replace(/_/g, ' ')}</span>
                    ) : (
                      <span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span>
                    )}
                  </td>
                  <td>{fmtAdminStamp(o.createdAt)}</td>
                  <td>{fmtAdminStamp(o.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
