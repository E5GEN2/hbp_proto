import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

export default async function AdminPaymentsPage({ searchParams }: { searchParams: { view?: string } }) {
  const view = searchParams.view ?? 'all';
  const where = view === 'all' ? {} : { status: view.toUpperCase() as any };
  const payments = await prisma.payment.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 50,
    include: { client: { select: { id: true, name: true } }, order: { select: { id: true } } },
  });
  const counts = await prisma.payment.groupBy({ by: ['status'], _count: { _all: true } });
  const ct = (s: string) => counts.find(c => c.status === s)?._count._all ?? 0;
  const total = counts.reduce((s, c) => s + c._count._all, 0);

  return (
    <>
      <AdminTopbar title="Payments" />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/admin/payments?view=all"            className={`tab ${view === 'all' ? 'active' : ''}`}>All <span className="tab-count">{total}</span></Link>
          <Link href="/admin/payments?view=confirmed"      className={`tab ${view === 'confirmed' ? 'active' : ''}`}>Confirmed <span className="tab-count">{ct('CONFIRMED')}</span></Link>
          <Link href="/admin/payments?view=awaiting"       className={`tab ${view === 'awaiting' ? 'active' : ''}`}>Awaiting <span className="tab-count">{ct('AWAITING')}</span></Link>
          <Link href="/admin/payments?view=failed"         className={`tab ${view === 'failed' ? 'active' : ''}`}>Failed <span className="tab-count">{ct('FAILED')}</span></Link>
          <Link href="/admin/payments?view=refunded"       className={`tab ${view === 'refunded' ? 'active' : ''}`}>Refunded <span className="tab-count">{ct('REFUNDED')}</span></Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Payment</th><th>Order</th><th>Client</th><th>Provider</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {payments.map(p => (
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
      </main>
    </>
  );
}
