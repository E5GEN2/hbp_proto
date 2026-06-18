import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { fmtAdminStamp } from '@/lib/date';

const PER_PAGE = 12;

export default async function AdminRenewalsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.view ?? '7d';
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const ar = searchParams.autorenew ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const now = new Date();

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

  const viewWhere = (() => {
    switch (view) {
      case '24h':     return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 24 * 3600_000) } };
      case '3d':      return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 3 * 86400_000) } };
      case '7d':      return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400_000) } };
      case 'grace':   return { renewalBucket: 'GRACE' as const };
      case 'expired': return { status: 'EXPIRED' as const };
      case 'renewed': return { renewalBucket: 'RENEWED' as const };
      default:        return {};
    }
  })();
  const where = { ...baseWhere, ...viewWhere };

  const [orders, total, catalogItems, ...bucketCounts] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { expiresAt: 'asc' }, include: { client: true, plan: true }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    prisma.order.count({ where }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } }),
    prisma.order.count({ where: { ...baseWhere, status: 'ACTIVE', expiresAt: { gte: now, lte: new Date(now.getTime() + 24 * 3600_000) } } }),
    prisma.order.count({ where: { ...baseWhere, status: 'ACTIVE', expiresAt: { gte: now, lte: new Date(now.getTime() + 3 * 86400_000) } } }),
    prisma.order.count({ where: { ...baseWhere, status: 'ACTIVE', expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400_000) } } }),
    prisma.order.count({ where: { ...baseWhere, renewalBucket: 'GRACE' } }),
    prisma.order.count({ where: { ...baseWhere, status: 'EXPIRED' } }),
    prisma.order.count({ where: { ...baseWhere, renewalBucket: 'RENEWED' } }),
  ]);
  const [n24, n3, n7, nGrace, nExpired, nRenewed] = bucketCounts as number[];
  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Renewals' }]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {[
            { v: '24h',     l: 'Next 24h',  n: n24 },
            { v: '3d',      l: 'In 3 days', n: n3 },
            { v: '7d',      l: 'In 7 days', n: n7 },
            { v: 'grace',   l: 'In grace',  n: nGrace },
            { v: 'expired', l: 'Expired',   n: nExpired },
            { v: 'renewed', l: 'Renewed',   n: nRenewed },
          ].map(t => {
            const tsp = new URLSearchParams(sp);
            tsp.set('view', t.v); tsp.delete('page');
            return (
              <Link key={t.v} href={`/admin/renewals?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                {t.l}<span className="tab-count">{t.n}</span>
              </Link>
            );
          })}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by order, client…' },
            { kind: 'select', name: 'carrier',   label: 'All carriers', options: carriers },
            { kind: 'select', name: 'region',    label: 'All regions',  options: regions },
            { kind: 'select', name: 'autorenew', label: 'Auto-renew',    options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Order</th><th>Client</th><th>Plan</th><th>Expires</th><th>Auto-renew</th><th>Status</th></tr></thead>
            <tbody>
              {orders.length === 0
                ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No orders in this bucket.</div></div></td></tr>
                : orders.map(o => (
                  <tr key={o.id}>
                    <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                    <td><Link href={`/admin/clients/${o.client.id}`} className="mono td-link">{o.client.id}</Link></td>
                    <td>{o.plan.name}</td>
                    <td>{fmtAdminStamp(o.expiresAt)}</td>
                    <td><span className={`chip ${o.autoRenew ? 'success' : 'muted'}`}>{o.autoRenew ? 'On' : 'Off'}</span></td>
                    <td><span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/renewals" search={sp} />
      </main>
    </>
  );
}
