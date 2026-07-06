import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { PaymentsBulkTable } from '@/components/admin/PaymentsBulkTable';
import { PAY_CHIP, PAY_LABEL } from '@/lib/payment-display';

const PER_PAGE = 12;

// Tab → status filter. Groupings mirror canon (Awaiting folds Pending;
// Confirmed folds Paid). `refund_requested` = canon "Refund requested".
const VIEW_STATUS: Record<string, string[]> = {
  confirmed: ['CONFIRMED', 'PAID'],
  awaiting: ['AWAITING', 'PENDING'],
  failed: ['FAILED'],
  refunded: ['REFUNDED'],
  refund_requested: ['REFUND_REQUESTED'],
  manual_review: ['MANUAL_REVIEW'],
};

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

  const viewWhere = VIEW_STATUS[view] ? { status: { in: VIEW_STATUS[view] as any } } : {};
  const where = { ...baseWhere, ...viewWhere };

  const [payments, total, counts] = await Promise.all([
    prisma.payment.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { client: { select: { id: true } }, order: { select: { id: true } } },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
  ]);
  const ct = (...ss: string[]) => counts.filter(c => ss.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
  const totalAll = counts.reduce((s, c) => s + c._count._all, 0);

  const tabs = [
    { v: 'all',             l: 'All',              n: totalAll },
    { v: 'confirmed',       l: 'Confirmed',        n: ct('CONFIRMED', 'PAID') },
    { v: 'awaiting',        l: 'Awaiting',         n: ct('AWAITING', 'PENDING') },
    { v: 'failed',          l: 'Failed',           n: ct('FAILED') },
    { v: 'refunded',        l: 'Refunded',         n: ct('REFUNDED') },
    { v: 'refund_requested', l: 'Refund requested', n: ct('REFUND_REQUESTED') },
    { v: 'manual_review',   l: 'Manual review',    n: ct('MANUAL_REVIEW') },
  ];

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Payments' }]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q' },
            { kind: 'select', name: 'provider', label: 'Provider: all', size: 'sm', options: [
              { value: 'Stripe', label: 'Stripe' },
              { value: 'NOWPayments', label: 'NOWPayments' },
              { value: 'CoinPayments', label: 'CoinPayments' },
              { value: 'Balance', label: 'Balance' },
              { value: 'Bank transfer', label: 'Bank transfer' },
              { value: 'Comp', label: 'Comp' },
            ]},
          ]}
          exportLabel="Export CSV"
        />

        <div className="panel">
          <div className="tabs">
            {tabs.map(t => {
              const tsp = new URLSearchParams(sp);
              tsp.set('view', t.v); tsp.delete('page');
              return (
                <Link key={t.v} href={`/admin/payments?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                  {t.l}<span className="tab-count">{t.n}</span>
                </Link>
              );
            })}
          </div>

          <PaymentsBulkTable payments={payments.map(p => ({
            id: p.id,
            orderId: p.order?.id ?? null,
            clientId: p.client?.id ?? null,
            provider: p.provider,
            method: p.method,
            gross: Number(p.gross),
            status: p.status,
            statusChip: PAY_CHIP[p.status] ?? '',
            statusLabel: PAY_LABEL[p.status] ?? p.status,
            createdAt: p.createdAt,
          }))} />

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/payments" search={sp} />
        </div>
      </main>
    </>
  );
}
