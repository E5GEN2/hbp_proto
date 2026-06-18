import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

const PER_PAGE = 12;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.view ?? 'all';
  const q = searchParams.q?.trim() ?? '';
  const provider = searchParams.provider ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (provider) baseWhere.provider = provider;
  if (q) {
    baseWhere.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { orderId: { contains: q, mode: 'insensitive' } },
      { clientId: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const viewWhere = view === 'all' ? {} : { status: view.toUpperCase() as any };
  const where = { ...baseWhere, ...viewWhere };

  const [payments, total, counts] = await Promise.all([
    prisma.payment.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { client: { select: { id: true, name: true } }, order: { select: { id: true } } },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
  ]);
  const ct = (s: string) => counts.find(c => c.status === s)?._count._all ?? 0;
  const totalAll = counts.reduce((s, c) => s + c._count._all, 0);

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Payments' }]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {[
            { v: 'all',         l: 'All',              n: totalAll       },
            { v: 'confirmed',   l: 'Confirmed',        n: ct('CONFIRMED') },
            { v: 'awaiting',    l: 'Awaiting',         n: ct('AWAITING')  },
            { v: 'failed',      l: 'Failed',           n: ct('FAILED')    },
            { v: 'refunded',    l: 'Refunded',         n: ct('REFUNDED')  },
            { v: 'manual_review', l: 'Manual review',  n: ct('MANUAL_REVIEW') },
          ].map(t => {
            const tsp = new URLSearchParams(sp);
            tsp.set('view', t.v); tsp.delete('page');
            return (
              <Link key={t.v} href={`/admin/payments?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                {t.l}<span className="tab-count">{t.n}</span>
              </Link>
            );
          })}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by payment, order, client…' },
            { kind: 'select', name: 'provider', label: 'All providers', options: [
              { value: 'Stripe', label: 'Stripe' },
              { value: 'CoinPayments', label: 'CoinPayments' },
              { value: 'Balance', label: 'Balance' },
              { value: 'Bank transfer', label: 'Bank transfer' },
              { value: 'Comp', label: 'Comp' },
            ]},
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Payment</th><th>Order</th><th>Client</th><th>Provider</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-desc">No payments match these filters.</div></div></td></tr>
              ) : payments.map(p => (
                <tr key={p.id}>
                  <td><Link href={`/admin/payments/${p.id}`} className="mono td-link">{p.id}</Link></td>
                  <td>{p.order ? <Link href={`/admin/orders/${p.order.id}`} className="mono td-link">{p.order.id}</Link> : '—'}</td>
                  <td><Link href={`/admin/clients/${p.client.id}`} className="mono td-link">{p.client.id}</Link></td>
                  <td>{p.provider}</td>
                  <td>{p.method}</td>
                  <td>{money(Number(p.gross))}</td>
                  <td><span className={`chip ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span></td>
                  <td>{fmtAdminStamp(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/payments" search={sp} />
      </main>
    </>
  );
}
