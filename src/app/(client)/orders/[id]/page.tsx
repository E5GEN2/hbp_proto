import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ClientOrderDetailActions } from '@/components/client/OrderDetailActions';
import { money } from '@/lib/money';
import { daysLeft, fmtAdminStamp } from '@/lib/date';



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
  const dl = daysLeft(order.expiresAt);
  const expiringActive = order.status === 'ACTIVE' && dl != null && dl > 0 && dl <= 7;
  const isPaid = ['PAID', 'CONFIRMED', 'FREE'].includes(order.paymentStatus);
  const lastPay = order.payments[0] ?? null;

  // Activity timeline (synthesized from order + payments)
  type Event = { at: Date; tone: string; title: string; detail?: string };
  const events: Event[] = [];
  events.push({ at: order.createdAt, tone: 'info', title: 'Order placed', detail: `${order.plan.durationDays}-day Mobile · ${order.qty} ${order.qty === 1 ? 'proxy' : 'proxies'} · ${money(Number(order.amount))}` });
  for (const p of [...order.payments].reverse()) {
    if (p.status === 'CONFIRMED' || p.status === 'PAID') events.push({ at: p.confirmedAt ?? p.createdAt, tone: 'success', title: 'Payment confirmed', detail: `${p.method} · ${p.provider}` });
    else if (p.status === 'AWAITING' || p.status === 'PENDING') events.push({ at: p.createdAt, tone: 'warning', title: 'Awaiting payment', detail: 'Complete checkout to provision proxies.' });
    else if (p.status === 'FAILED') events.push({ at: p.createdAt, tone: 'danger', title: 'Payment failed', detail: 'Retry from this order or contact support.' });
    else if (p.status === 'REFUNDED') events.push({ at: p.refundedAt ?? p.createdAt, tone: 'muted', title: `Refunded ${money(Number(p.refundedAmount ?? p.gross))}` });
  }
  if (order.activatedAt) events.push({ at: order.activatedAt, tone: 'violet', title: 'Provisioned', detail: `${order.assignments.length} mobile ${order.assignments.length === 1 ? 'proxy is' : 'proxies are'} live.` });
  else if (order.status === 'PROVISIONING') events.push({ at: order.updatedAt, tone: 'warning', title: 'Awaiting fulfillment', detail: 'Our team is preparing your proxies. Typical delivery within 24 hours.' });
  if (order.cancelledAt) events.push({ at: order.cancelledAt, tone: 'danger', title: 'Cancelled', detail: order.cancelledReason ?? 'No charge was made.' });
  // Newest first — same convention as the dashboard feed and the admin
  // Activity widget (EntityActivityWidget).
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const tlDot = (tone: string) => (tone && tone !== 'muted' ? tone : '');

  return (
    <>
      <ClientTopbar breadcrumb={[{ label: 'Orders', href: '/orders' }, { label: `Order ${order.id}` }]} balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="detail-header">
            <div className="detail-header-left">
              <div className="detail-id">{order.id}</div>
              <div className="detail-chips">
                <span className={`chip ${order.status.toLowerCase().replace('_', '-')}`}>{order.status.charAt(0) + order.status.slice(1).toLowerCase().replace('_', ' ')}</span>
                {!isPaid && order.status !== 'CANCELLED' && <span className={`chip ${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus.charAt(0) + order.paymentStatus.slice(1).toLowerCase()} payment</span>}
                {order.status === 'ACTIVE' && order.autoRenew && <span className="chip muted">Auto-renew on</span>}
              </div>
            </div>
            <div className="detail-actions">
              <ClientOrderDetailActions
                orderId={order.id}
                status={order.status}
                paymentStatus={order.paymentStatus}
                autoRenew={order.autoRenew}
                expiringActive={expiringActive}
              />
            </div>
          </div>

          <div className="grid-detail">
            <div className="grid-left">
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Order snapshot</span></div>
                <div className="panel-body">
                  <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{order.plan.durationDays}-day Mobile</span></div>
                  <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{order.plan.carrier} · {order.region}</span></div>
                  <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{order.qty} {order.qty === 1 ? 'proxy' : 'proxies'}</span></div>
                  <div className="kv-row"><span className="kv-label">Amount</span><span className="kv-val mono">{money(Number(order.amount))}</span></div>
                  <div className="kv-row">
                    <span className="kv-label">Payment</span>
                    <span className="kv-val">
                      {lastPay ? <><span className="muted">{lastPay.method} · {fmtAdminStamp(lastPay.createdAt)}</span> <span style={{ marginLeft: 8 }}><span className={`chip ${isPaid ? 'paid' : order.paymentStatus.toLowerCase()}`}>{isPaid ? 'Paid' : order.paymentStatus.charAt(0) + order.paymentStatus.slice(1).toLowerCase()}</span></span></> : <span className="chip muted">—</span>}
                    </span>
                  </div>
                </div>
              </div>

              <div className="order-detail-split">
                <div className="panel">
                  <div className="panel-header"><span className="panel-title">Activity</span></div>
                  <div className="timeline-mini activity-scroll">
                    {events.map((e, i) => (
                      <div className="timeline-mini-row" key={i}>
                        <span className={`timeline-mini-dot ${tlDot(e.tone)}`} />
                        <div className="timeline-mini-body">
                          <span className="timeline-mini-title">{e.title}</span>
                          {e.detail && <span className="timeline-mini-detail">{e.detail}</span>}
                        </div>
                        <span className="timeline-mini-stamp">{fmtAdminStamp(e.at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {order.assignments.length > 0 && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">Assigned Proxies</span>
                      <Link href={`/proxies?order=${order.id}`} className="panel-action">My Proxies →</Link>
                    </div>
                    <div className="widget-list activity-scroll">
                      {order.assignments.map(a => (
                        <Link key={a.id} className="widget-row" href={`/proxies/${a.proxy.id}`}>
                          <span className="widget-label"><span className="td-link">{a.proxy.id}</span></span>
                          <span className="widget-meta"><span className={`chip ${a.proxy.health.toLowerCase()}`}>{a.proxy.health.charAt(0) + a.proxy.health.slice(1).toLowerCase()}</span></span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid-right">
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Lifecycle</span></div>
                <div className="panel-body">
                  <div className="kv-row"><span className="kv-label">Created</span><span className="kv-val">{fmtAdminStamp(order.createdAt)}</span></div>
                  <div className="kv-row"><span className="kv-label">Activated</span><span className="kv-val">{order.activatedAt ? fmtAdminStamp(order.activatedAt) : '—'}</span></div>
                  <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val">{order.expiresAt ? fmtAdminStamp(order.expiresAt) : '—'}</span></div>
                  <div className="kv-row"><span className="kv-label">Auto-renew</span><span className="kv-val"><span className={`chip ${order.autoRenew ? 'active' : 'muted'}`}>{order.autoRenew ? 'On' : 'Off'}</span></span></div>
                  {order.cancelledAt && <div className="kv-row"><span className="kv-label">Cancelled</span><span className="kv-val">{fmtAdminStamp(order.cancelledAt)}</span></div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
