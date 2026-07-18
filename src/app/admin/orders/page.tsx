import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { OrdersBulkTable } from '@/components/admin/OrdersBulkTable';
import { underProvisionedOrders } from '@/lib/provisioning';

const PER_PAGE = 12;

// Exception sub-filter pills (canon Orders Exceptions tab). `enum` null = "All".
const EXC_TYPES: { key: string; label: string; enum: string | null }[] = [
  { key: 'all',                   label: 'All',                        enum: null },
  { key: 'paid-not-provisioned',  label: 'Paid, not provisioned',      enum: 'PAID_NOT_PROVISIONED' },
  { key: 'renewal-not-extended',  label: 'Renewal paid, not extended', enum: 'RENEWAL_NOT_EXTENDED' },
  { key: 'renewal-faulty-proxy',  label: 'Renewal · faulty proxy',     enum: 'RENEWAL_FAULTY_PROXY' },
  { key: 'replacement-pending',   label: 'Replacement pending',        enum: 'REPLACEMENT_PENDING' },
  { key: 'refund-pending',        label: 'Refund review',              enum: 'REFUND_PENDING' },
];

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.view ?? 'all';
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const exc = searchParams.exc ?? 'all';
  const excEnum = EXC_TYPES.find(t => t.key === exc)?.enum ?? null;
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

  // Authoritative proxy-shortage signal (dashboard + bell link here): ACTIVE
  // paid orders whose effective-live assignments are below the bought qty.
  // Computed live, so we resolve to concrete ids and filter by them — the tab
  // count then equals exactly what this view lists.
  const deficitIds = (await underProvisionedOrders()).map(o => o.id);

  const viewWhere = (() => {
    switch (view) {
      case 'new':             return { status: 'NEW' as const };
      case 'awaiting':        return { paymentStatus: { in: ['AWAITING', 'PENDING'] as any }, status: { not: 'NEW' as const } };
      case 'provisioning':    return { status: 'PROVISIONING' as const };
      case 'active':          return { status: 'ACTIVE' as const };
      case 'expired':         return { status: 'EXPIRED' as const };
      case 'cancelled':       return { status: 'CANCELLED' as const };
      case 'underprovisioned': return { id: { in: deficitIds } };
      case 'exceptions':      return excEnum ? { exception: excEnum as any } : { exception: { not: null } };
      default:                return {};
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
    { v: 'underprovisioned', l: '⚠ Missing proxies', n: deficitIds.length },
    { v: 'exceptions',   l: '⚠ Exceptions',    n: exceptionCount },
    { v: 'all',          l: 'All',              n: tabCounts.reduce((s, c) => s + c._count._all, 0) },
    { v: 'new',          l: 'New',              n: ct('NEW') },
    { v: 'awaiting',     l: 'Awaiting Payment', n: 0 },
    { v: 'provisioning', l: 'Provisioning',     n: ct('PROVISIONING') },
    { v: 'active',       l: 'Active',           n: ct('ACTIVE') },
    { v: 'expired',      l: 'Expired',          n: ct('EXPIRED') },
    { v: 'cancelled',    l: 'Cancelled',        n: ct('CANCELLED') },
  ];

  // Exception sub-filter counts — only when the Exceptions tab is active
  const excCounts: Record<string, number> = {};
  if (view === 'exceptions') {
    const grp = await prisma.order.groupBy({
      by: ['exception'],
      where: { ...baseWhere, exception: { not: null } },
      _count: { _all: true },
    });
    let total = 0;
    const byEnum: Record<string, number> = {};
    for (const g of grp) if (g.exception) { byEnum[g.exception] = g._count._all; total += g._count._all; }
    excCounts.all = total;
    for (const t of EXC_TYPES) if (t.enum) excCounts[t.key] = byEnum[t.enum] ?? 0;
  }

  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Orders' }]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q' },
            { kind: 'select', name: 'carrier', label: 'Carrier: all', options: carriers, size: 'sm' },
            { kind: 'select', name: 'region', label: 'Region: all', options: regions, size: 'md' },
          ]}
          exportLabel="Export CSV"
        />

        <div className="panel">
          <div className="tabs">
            {tabs.map(t => {
              const tsp = new URLSearchParams(sp);
              tsp.set('view', t.v); tsp.delete('page'); tsp.delete('exc');
              return (
                <Link
                  key={t.v}
                  href={`/admin/orders?${tsp.toString()}`}
                  className={`tab ${t.v === 'exceptions' ? 'emphasis' : ''} ${view === t.v ? 'active' : ''}`}
                >
                  {t.l}<span className="tab-count">{t.n}</span>
                </Link>
              );
            })}
          </div>

          {view === 'exceptions' && (
            <div className="exc-subfilters visible">
              <span className="exc-subfilters-label">Filter by exception</span>
              {EXC_TYPES.map(t => {
                const psp = new URLSearchParams(sp);
                psp.set('view', 'exceptions'); psp.set('exc', t.key); psp.delete('page');
                return (
                  <Link
                    key={t.key}
                    href={`/admin/orders?${psp.toString()}`}
                    className={`exc-pill ${exc === t.key ? 'active' : ''}`}
                  >
                    {t.label}<span className="exc-pill-count">{excCounts[t.key] ?? 0}</span>
                  </Link>
                );
              })}
              <div className="spacer" style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 11 }}>Resolve each order via its detail page.</span>
            </div>
          )}

          <OrdersBulkTable orders={orders.map(o => ({
            id: o.id, clientId: o.client.id, planName: o.plan.name, planCarrier: o.plan.carrier,
            region: o.region, amount: Number(o.amount),
            paymentStatus: o.paymentStatus, status: o.status, exception: o.exception,
            createdAt: o.createdAt, expiresAt: o.expiresAt,
          }))} />

          <Pagination total={totalForView} page={page} perPage={PER_PAGE} basePath="/admin/orders" search={sp} />
        </div>
      </main>
    </>
  );
}
