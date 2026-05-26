import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import { Stage15Pill } from '@/components/ui/Stage15Badge';

export default async function BillingPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const tab = searchParams.tab ?? 'all';
  const where: any = { clientId: userId };
  if (tab === 'confirmed') where.status = 'CONFIRMED';
  if (tab === 'awaiting')  where.status = { in: ['AWAITING', 'PENDING'] };
  if (tab === 'refunded')  where.status = 'REFUNDED';

  const [payments, methods] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, include: { invoice: true, order: { select: { id: true } } } }),
    prisma.paymentMethod.findMany({ where: { userId } }),
  ]);

  return (
    <>
      <ClientTopbar title="Billing" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div>
          <div className="panel" style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Account balance <Stage15Pill /></div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{money(Number(me?.balance ?? 0))}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>Use balance at checkout for instant order activation.</div>
            <Link href="/checkout?kind=deposit" className="btn primary" style={{ marginTop: 14 }}>Add funds</Link>
          </div>
          <div className="panel">
            <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <span className="panel-title">Transactions</span>
              <div className="tabs">
                <Link href="/billing?tab=all"        className={`tab ${tab === 'all' ? 'active' : ''}`}>All</Link>
                <Link href="/billing?tab=confirmed"  className={`tab ${tab === 'confirmed' ? 'active' : ''}`}>Confirmed</Link>
                <Link href="/billing?tab=awaiting"   className={`tab ${tab === 'awaiting' ? 'active' : ''}`}>Awaiting</Link>
                <Link href="/billing?tab=refunded"   className={`tab ${tab === 'refunded' ? 'active' : ''}`}>Refunded</Link>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Payment</th><th>Amount</th><th>Date</th><th>Type</th><th>Order</th><th>Status</th><th>Invoice <Stage15Pill /></th></tr></thead>
              <tbody>
                {payments.length === 0
                  ? <tr><td colSpan={7}><div className="empty"><div className="empty-desc">No transactions in this view.</div></div></td></tr>
                  : payments.map(p => (
                    <tr key={p.id}>
                      <td><span className="mono">{p.id}</span></td>
                      <td>{p.status === 'REFUNDED' ? `+${money(Number(p.gross))}` : money(Number(p.gross))}</td>
                      <td>{fmtDate(p.createdAt)}</td>
                      <td>
                        <div>{p.orderId ? 'Order payment' : p.method}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.method}</div>
                      </td>
                      <td>{p.order ? <Link href={`/orders/${p.order.id}`} className="mono td-link">{p.order.id}</Link> : '—'}</td>
                      <td><span className={`chip ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span></td>
                      <td>{p.invoice ? <a className="td-link" href="#">Download</a> : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Payment methods</span></div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {methods.map(m => (
                <div key={m.id} style={{ padding: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.brand}</div>
                    {m.isDefault && <span className="chip accent sm">Default</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                    {m.last4 ? `•• ${m.last4}` : m.kind === 'BALANCE' ? `Balance: ${money(Number(me?.balance ?? 0))}` : '—'}
                    {m.exp && ` · exp ${m.exp}`}
                    {m.locked && ' · Locked'}
                  </div>
                </div>
              ))}
              <button className="btn" style={{ borderStyle: 'dashed' }}>+ Add payment method</button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
