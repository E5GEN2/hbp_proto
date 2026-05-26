import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { OrdersToolbar } from '@/components/admin/toolbars/OrdersToolbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

const PER_PAGE = 12;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.view ?? 'all';
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (carrier) baseWhere.plan = { carrier };
  if (region) baseWhere.region = region;
  if (q) {
    baseWhere.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { clientId: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
      { client: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const viewWhere = (() => {
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

  const where = { ...baseWhere, ...viewWhere };

  const [orders, totalForView, allClients, allPlans, catalogItems] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { client: true, plan: true },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.order.count({ where }),
    prisma.user.findMany({
      where: { role: 'CLIENT', status: { not: 'BLOCKED' } },
      select: { id: true, name: true, email: true, balance: true },
      orderBy: { name: 'asc' }, take: 200,
    }),
    prisma.plan.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } }),
  ]);

  // Tab counts (respect search/filter for accurate counts within the user's filter)
  const tabCounts = await prisma.order.groupBy({
    by: ['status'],
    where: baseWhere,
    _count: { _all: true },
  });
  const exceptionCount = await prisma.order.count({ where: { ...baseWhere, exception: { not: null } } });
  const ct = (s: string) => tabCounts.find(c => c.status === s)?._count._all ?? 0;
  const tabs = [
    { v: 'exceptions',   l: '⚠ Exceptions',    n: exceptionCount },
    { v: 'all',          l: 'All',              n: tabCounts.reduce((s, c) => s + c._count._all, 0) },
    { v: 'new',          l: 'New',              n: ct('NEW') },
    { v: 'awaiting',     l: 'Awaiting Payment', n: 0 },
    { v: 'provisioning', l: 'Provisioning',     n: ct('PROVISIONING') },
    { v: 'active',       l: 'Active',           n: ct('ACTIVE') },
    { v: 'expired',      l: 'Expired',          n: ct('EXPIRED') },
    { v: 'cancelled',    l: 'Cancelled',        n: ct('CANCELLED') },
  ];

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

  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar title="Orders" action={<OrdersToolbar clients={clientOpts} plans={planOpts} />} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {tabs.map(t => {
            const tsp = new URLSearchParams(sp);
            tsp.set('view', t.v); tsp.delete('page');
            return (
              <Link key={t.v} href={`/admin/orders?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                {t.l}{t.n > 0 && <span className="tab-count">{t.n}</span>}
              </Link>
            );
          })}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by order id, client name/email…' },
            { kind: 'select', name: 'carrier', label: 'All carriers', options: carriers },
            { kind: 'select', name: 'region', label: 'All regions', options: regions },
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Order ID</th><th>Client</th><th>Plan</th><th>Carrier</th><th>Region</th><th>Amount</th><th>Payment</th><th>Status</th><th>Created</th><th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={10}><div className="empty"><div className="empty-desc">No orders match these filters. Adjust or reset.</div></div></td></tr>
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
        <Pagination total={totalForView} page={page} perPage={PER_PAGE} basePath="/admin/orders" search={sp} />
      </main>
    </>
  );
}
