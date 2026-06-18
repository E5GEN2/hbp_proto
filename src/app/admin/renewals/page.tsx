import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { RenewalsBulkTable, type RenewalRow } from '@/components/admin/RenewalsBulkTable';

const PER_PAGE = 10;

// Canon Renewals buckets are mutually exclusive and driven by order.renewalBucket
// (same source the dashboard "Expiring soon" strip uses), NOT recomputed expiry
// windows. The Renewal-paid tab folds in PENDING_RENEWAL requests (canon Phase 8).
function bucketWhere(view: string): any {
  switch (view) {
    case '24h':     return { renewalBucket: 'H24' };
    case '3d':      return { renewalBucket: 'D3' };
    case '7d':      return { renewalBucket: 'D7' };
    case 'grace':   return { renewalBucket: 'GRACE' };
    case 'expired': return { renewalBucket: 'EXPIRED' };
    case 'renewed': return { OR: [{ renewalBucket: 'RENEWED' }, { status: 'PENDING_RENEWAL' }] };
    default:        return {};
  }
}

export default async function AdminRenewalsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.view ?? '24h';
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const ar = searchParams.autorenew ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (carrier) baseWhere.plan = { carrier };
  if (region) baseWhere.region = region;
  if (ar === 'on') baseWhere.autoRenew = true;
  if (ar === 'off') baseWhere.autoRenew = false;
  if (q) {
    baseWhere.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { clientId: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const where = { AND: [baseWhere, bucketWhere(view)] };
  const countFor = (v: string) => prisma.order.count({ where: { AND: [baseWhere, bucketWhere(v)] } });

  const [orders, total, catalogItems, n24, n3, n7, nGrace, nExpired, nRenewed] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { expiresAt: 'asc' },
      include: {
        client: true,
        plan: true,
        assignments: { where: { releasedAt: null }, take: 1, select: { proxyId: true } },
        payments: { where: { status: { in: ['AWAITING', 'PENDING'] } }, take: 1, select: { id: true } },
      },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.order.count({ where }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } }),
    countFor('24h'), countFor('3d'), countFor('7d'),
    countFor('grace'), countFor('expired'), countFor('renewed'),
  ]);

  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const rows: RenewalRow[] = orders.map(o => ({
    id: o.id,
    clientId: o.client?.id ?? o.clientId ?? null,
    proxyId: o.assignments[0]?.proxyId ?? null,
    planName: o.plan?.name ?? '—',
    planDuration: o.plan?.durationDays ?? 30,
    qty: o.qty,
    expiresAt: o.expiresAt,
    lastReminderAt: o.lastReminderAt,
    status: o.status,
    renewalBucket: o.renewalBucket,
    exception: o.exception,
    autoRenew: o.autoRenew,
    paymentId: o.payments[0]?.id ?? null,
  }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  const tabs: { v: string; l: string; n: number }[] = [
    { v: '24h', l: 'Next 24 h', n: n24 },
    { v: '3d', l: 'In 3 days', n: n3 },
    { v: '7d', l: 'In 7 days', n: n7 },
    { v: 'grace', l: 'In grace', n: nGrace },
    { v: 'expired', l: 'Expired', n: nExpired },
    { v: 'renewed', l: 'Renewal paid', n: nRenewed },
  ];
  const tabLink = (t: { v: string; l: string; n: number }) => {
    const tsp = new URLSearchParams(sp);
    tsp.set('view', t.v); tsp.delete('page');
    return (
      <Link key={t.v} href={`/admin/renewals?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
        {t.l} <span className="tab-count">{t.n}</span>
      </Link>
    );
  };

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Renewals' }]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: '' },
            { kind: 'select', name: 'carrier', label: 'Carrier: all', options: carriers, size: 'sm' },
            { kind: 'select', name: 'region', label: 'Region: all', options: regions, size: 'md' },
            { kind: 'select', name: 'autorenew', label: 'Auto-renew: all', options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }], size: 'md' },
          ]}
        />

        <div className="panel">
          <div className="tabs tabs-split">
            <div className="tab-group">{tabs.slice(0, 3).map(tabLink)}</div>
            <div className="tab-group-divider" />
            <div className="tab-group">{tabs.slice(3, 5).map(tabLink)}</div>
            <div className="tab-group-divider" />
            <div className="tab-group">{tabs.slice(5).map(tabLink)}</div>
          </div>

          <RenewalsBulkTable key={view} rows={rows} view={view} />

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/renewals" search={sp} />
        </div>
      </main>
    </>
  );
}
