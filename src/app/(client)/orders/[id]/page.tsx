import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { fmtDate, daysLeft } from '@/lib/date';

export default async function ClientOrderDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      plan: true,
      payments: { orderBy: { createdAt: 'desc' } },
      assignments: { include: { proxy: true } },
    },
  });
  if (!order) notFound();
  if (order.clientId !== session!.user.id) redirect('/orders');

  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const d = daysLeft(order.expiresAt);

  return (
    <>
      <ClientTopbar title="Order detail" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{order.id}</h2>
          <span className={`chip ${order.status.toLowerCase().replace('_','-')}`}>{order.status.toLowerCase()}</span>
          {order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CONFIRMED' && <span className={`chip ${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus.toLowerCase()} payment</span>}
          {order.autoRenew && <span className="chip muted">Auto-renew on</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Order snapshot</span></div>
              <div className="panel-body">
                <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{order.plan.name}</span></div>
                <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{order.plan.carrier} · {order.region}</span></div>
                <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{order.qty}</span></div>
                <div className="kv-row total"><span className="kv-label">Amount</span><span className="kv-val">{money(Number(order.amount))}</span></div>
              </div>
            </div>
            {order.assignments.length > 0 && (
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Assigned proxies ({order.assignments.length})</span>
                  <Link href={`/proxies?order=${order.id}`} className="panel-action">My Proxies →</Link>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {order.assignments.map(a => (
                    <li key={a.id} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Link href={`/proxies/${a.proxy.id}`} className="mono td-link">{a.proxy.id}</Link>
                      <span className={`chip ${a.proxy.health.toLowerCase()}`}>{a.proxy.health.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Lifecycle</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Created</span><span className="kv-val">{fmtDate(order.createdAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Activated</span><span className="kv-val">{fmtDate(order.activatedAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val">{fmtDate(order.expiresAt)}{d !== null && d > 0 ? ` (${d}d left)` : ''}</span></div>
              <div className="kv-row"><span className="kv-label">Auto-renew</span><span className={`chip ${order.autoRenew ? 'success' : 'muted'}`}>{order.autoRenew ? 'On' : 'Off'}</span></div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
