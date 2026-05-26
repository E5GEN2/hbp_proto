import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ClientOrderDetailActions, ClientAutoRenewToggle } from '@/components/client/OrderDetailActions';
import { money } from '@/lib/money';
import { fmtDate, fmtTimelineStamp, daysLeft } from '@/lib/date';

export default async function ClientOrderDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      plan: true,
      payments: { orderBy: { createdAt: 'desc' } },
      assignments: { where: { releasedAt: null }, include: { proxy: true } },
    },
  });
  if (!order) notFound();
  if (order.clientId !== session!.user.id) redirect('/orders');

  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const d = daysLeft(order.expiresAt);
  const paidPayment = order.payments.find(p => p.status === 'CONFIRMED' || p.status === 'PAID');
  const lastPaymentId = paidPayment?.id ?? order.payments[0]?.id ?? null;

  // Build the client-side activity timeline (synthesized from order + payments)
  type Event = { at: Date; tone: 'success' | 'warning' | 'danger' | 'info' | 'muted'; title: string; detail?: string };
  const events: Event[] = [];
  events.push({ at: order.createdAt, tone: 'info', title: 'Order placed', detail: `${order.plan.name} · qty ${order.qty}` });
  for (const p of [...order.payments].reverse()) {
    if (p.status === 'CONFIRMED' || p.status === 'PAID') events.push({ at: p.confirmedAt ?? p.createdAt, tone: 'success', title: `Payment confirmed`, detail: `${p.method} · ${money(Number(p.gross))}` });
    else if (p.status === 'AWAITING' || p.status === 'PENDING') events.push({ at: p.createdAt, tone: 'warning', title: `Awaiting payment`, detail: `${p.provider} · ${p.method}` });
    else if (p.status === 'FAILED') events.push({ at: p.createdAt, tone: 'danger', title: `Payment failed`, detail: `${p.method}` });
    else if (p.status === 'REFUNDED') events.push({ at: p.refundedAt ?? p.createdAt, tone: 'muted', title: `Refunded ${money(Number(p.refundedAmount ?? p.gross))}`, detail: '' });
    else if (p.status === 'REFUND_REQUESTED' as any) events.push({ at: p.createdAt, tone: 'warning', title: 'Refund requested — pending review' });
  }
  if (order.activatedAt) events.push({ at: order.activatedAt, tone: 'success', title: 'Provisioned', detail: `${order.assignments.length} ${order.assignments.length === 1 ? 'proxy' : 'proxies'} assigned` });
  else if (order.status === 'PROVISIONING') events.push({ at: order.updatedAt, tone: 'warning', title: 'Awaiting fulfillment', detail: 'Our team is preparing your proxies' });
  if (order.cancelledAt) events.push({ at: order.cancelledAt, tone: 'danger', title: 'Cancelled', detail: order.cancelledReason ?? '' });
  if (order.expiresAt && order.expiresAt < new Date()) events.push({ at: order.expiresAt, tone: 'muted', title: 'Expired' });
  else if (order.expiresAt) events.push({ at: order.expiresAt, tone: 'info', title: 'Expires', detail: fmtDate(order.expiresAt) });
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <ClientTopbar title="Order detail" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1416, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{order.id}</h2>
          <span className={`chip ${order.status.toLowerCase().replace('_','-')}`}>{order.status.toLowerCase()}</span>
          {order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CONFIRMED' && <span className={`chip ${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus.toLowerCase()} payment</span>}
          {order.autoRenew && <span className="chip muted">Auto-renew on</span>}
          {order.exception && <span className="chip warning">{order.exception.toLowerCase().replace(/_/g, ' ')}</span>}
          <div style={{ flex: 1 }} />
          <ClientOrderDetailActions
            orderId={order.id}
            status={order.status}
            paymentStatus={order.paymentStatus}
            hasPaidPayment={!!paidPayment}
            lastPaymentId={lastPaymentId}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
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
            {/* Split row per the original prototype: Activity + Assigned Proxies (1fr 1fr).
                When no proxies, Activity expands to full width. */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: order.assignments.length > 0 ? '1fr 1fr' : '1fr',
              gap: 16,
            }}>
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Activity</span></div>
                <div className="panel-body" style={{ padding: 0 }}>
                  <ul style={{ margin: 0, padding: '12px 0', listStyle: 'none' }}>
                    {events.map((e, i) => (
                      <li key={i} style={{ padding: '8px 20px', display: 'flex', gap: 12 }}>
                        <span style={{ marginTop: 5, flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: `var(--${e.tone === 'muted' ? 'muted' : e.tone})` }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmtTimelineStamp(e.at)}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, marginTop: 2 }}>{e.title}</div>
                          {e.detail && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{e.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
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
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Lifecycle</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Created</span><span className="kv-val">{fmtDate(order.createdAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Activated</span><span className="kv-val">{fmtDate(order.activatedAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val">{fmtDate(order.expiresAt)}{d !== null && d > 0 ? ` (${d}d left)` : ''}</span></div>
              <div className="kv-row">
                <span className="kv-label">Auto-renew</span>
                <span className="kv-val" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{order.autoRenew ? 'On' : 'Off'}</span>
                  <ClientAutoRenewToggle orderId={order.id} on={order.autoRenew} disabled={order.status === 'CANCELLED' || order.status === 'EXPIRED'} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
