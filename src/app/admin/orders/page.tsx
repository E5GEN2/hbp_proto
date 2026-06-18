import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { OrdersBulkTable } from '@/components/admin/OrdersBulkTable';

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

  const [orders, totalForView, catalogItems] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { client: true, plan: true },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.order.count({ where }),
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

  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar title="Orders" />
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
        <div style={{ marginTop: 8 }}>
          <OrdersBulkTable orders={orders.map(o => ({
            id: o.id, clientId: o.client.id, planName: o.plan.name, planCarrier: o.plan.carrier,
            region: o.region, amount: Number(o.amount),
            paymentStatus: o.paymentStatus, status: o.status, exception: o.exception,
            createdAt: o.createdAt, expiresAt: o.expiresAt,
          }))} />
        </div>
        <Pagination total={totalForView} page={page} perPage={PER_PAGE} basePath="/admin/orders" search={sp} />
      </main>
    </>
  );
}
