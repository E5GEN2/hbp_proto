import Link from 'next/link';
import type { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { PlanShowcase } from '@/components/client/PlanShowcase';
import { collapseLiveByDuration } from '@/lib/plan-tiers';
import { money } from '@/lib/money';
import { daysLeft, fmtAdminStamp } from '@/lib/date';

const PAID = ['PAID', 'CONFIRMED', 'FREE'];

function statusLabel(s: string) {
  return s === 'PENDING_RENEWAL' ? 'Pending renewal' : s.charAt(0) + s.slice(1).toLowerCase();
}
function statusClass(s: string) {
  return s.toLowerCase().replace(/_/g, '-');
}


export default async function ClientDashboard() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });

  const [orders, activeOrders, expiringSoon, proxies, refundedPayments, faulty] = await Promise.all([
    prisma.order.findMany({
      where: { clientId: userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { plan: true },
    }),
    prisma.order.count({ where: { clientId: userId, status: 'ACTIVE' } }),
    prisma.order.findMany({
      where: { clientId: userId, status: 'ACTIVE', expiresAt: { lte: new Date(Date.now() + 7 * 86_400_000) } },
      orderBy: { expiresAt: 'asc' },
      include: { plan: true },
    }),
    prisma.assignment.count({ where: { order: { clientId: userId, status: { not: 'SUSPENDED' } }, releasedAt: null } }),
    prisma.payment.findMany({ where: { clientId: userId, status: 'REFUNDED' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.assignment.findMany({
      where: { order: { clientId: userId, status: { not: 'SUSPENDED' } }, releasedAt: null, proxy: { health: { not: 'HEALTHY' } } },
      include: { proxy: true },
      take: 10,
    }),
  ]);

  const hasOrders = orders.length > 0;
  const recentOrders = orders.slice(0, 5);

  // ── Activity feed (synthesized from orders / refunds / proxy health) ──
  type Ev = { at: Date; dot: string; title: ReactNode; detail: ReactNode };
  const events: Ev[] = [];
  for (const o of orders) {
    const planLbl = `Mobile ${o.plan.durationDays}d ${o.plan.carrier}`;
    // Terminal cancel note first — the placed/paid history stays below it.
    if (o.status === 'CANCELLED') {
      const reason = o.cancelledReason ? ` — ${o.cancelledReason.charAt(0).toLowerCase()}${o.cancelledReason.slice(1)}` : '';
      events.push({ at: o.cancelledAt ?? o.createdAt, dot: 'muted',
        title: <>Order <span className="td-link">{o.id}</span> cancelled</>,
        detail: `${planLbl} · ${money(Number(o.amount))}${reason}.` });
    }
    if (PAID.includes(o.paymentStatus)) {
      if (o.activatedAt) {
        events.push({ at: o.activatedAt, dot: 'violet',
          title: <>Order <span className="td-link">{o.id}</span> provisioned</>,
          detail: `${o.qty} mobile ${o.qty === 1 ? 'proxy' : 'proxies'} in ${o.region}.` });
      }
      events.push({ at: o.createdAt, dot: 'success',
        title: <>Order <span className="td-link">{o.id}</span> paid</>,
        detail: `${planLbl} · ${money(Number(o.amount))}.` });
    } else if (o.paymentStatus === 'AWAITING' || o.paymentStatus === 'PENDING') {
      events.push({ at: o.createdAt, dot: 'warning',
        title: <>Order <span className="td-link">{o.id}</span> placed</>,
        detail: `${planLbl} · ${money(Number(o.amount))} — awaiting payment.` });
    } else if (o.paymentStatus === 'FAILED') {
      events.push({ at: o.createdAt, dot: 'danger',
        title: <>Payment failed on <span className="td-link">{o.id}</span></>,
        detail: `${planLbl} · ${money(Number(o.amount))} — retry from Billing.` });
    } else if (o.paymentStatus === 'CANCELLED') {
      // Placement entry for an order cancelled before payment — no
      // "awaiting payment" tail, the cancel note above closes the story.
      events.push({ at: o.createdAt, dot: 'muted',
        title: <>Order <span className="td-link">{o.id}</span> placed</>,
        detail: `${planLbl} · ${money(Number(o.amount))}.` });
    }
  }
  for (const p of refundedPayments) {
    events.push({ at: p.refundedAt ?? p.createdAt, dot: 'muted',
      title: <>Payment <span className="td-link">{p.id}</span> refunded</>,
      detail: `${money(Number(p.refundedAmount ?? p.gross))} returned to ${p.method}.` });
  }
  for (const a of faulty) {
    const px = a.proxy;
    events.push({ at: a.assignedAt ?? new Date(), dot: px.health === 'OFFLINE' ? 'danger' : 'warning',
      title: <>Health alert on <span className="td-link">{px.id}</span></>,
      detail: <>Status flipped to <span className={`chip ${px.health.toLowerCase()}`}>{px.health.toLowerCase()}</span>{px.health === 'OFFLINE' ? ' — replacement available.' : '.'}</> });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <ClientTopbar title="Dashboard" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div className="dash-body" style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          {/* KPI strip */}
          <div className="kpi-strip">
            <Link className="kpi-card" href="/orders">
              <div className="kpi-label">Active orders</div>
              <div className="kpi-value">{activeOrders}</div>
              <div className="kpi-accent-bar green" />
            </Link>
            <Link className="kpi-card" href="/proxies">
              <div className="kpi-label">Total proxies</div>
              <div className="kpi-value">{proxies}</div>
              <div className="kpi-accent-bar blue" />
            </Link>
            <Link className="kpi-card" href="/orders">
              <div className="kpi-label">Expiring soon</div>
              <div className="kpi-value">{expiringSoon.length}</div>
              <div className={`kpi-accent-bar ${expiringSoon.length > 0 ? 'red' : 'green'}`} />
            </Link>
          </div>

          {!hasOrders ? (
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Choose your plan</span></div>
              <div className="panel-body">
                <EmptyPlans />
              </div>
            </div>
          ) : (
            <>
              {/* Recent orders + Expiring soon */}
              <div className="card-2col">
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Recent orders</span>
                    <Link className="panel-action" href="/orders">View all</Link>
                  </div>
                  <div className="widget-list">
                    {recentOrders.length === 0 ? (
                      <div className="empty" style={{ padding: '32px 20px' }}><div className="empty-desc">No orders yet.</div></div>
                    ) : recentOrders.map(o => (
                      <Link key={o.id} className="widget-row" href={`/orders/${o.id}`}>
                        <span className="widget-label"><span className="td-link">{o.id}</span> · {o.plan.durationDays}d Mobile · {o.region}</span>
                        <span className="widget-meta"><span className={`chip ${statusClass(o.status)}`}>{statusLabel(o.status)}</span></span>
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-header"><span className="panel-title">Expiring soon</span></div>
                  <div className="widget-list scroll">
                    {expiringSoon.length === 0 ? (
                      <div className="empty" style={{ padding: '32px 20px' }}><div className="empty-desc">No orders expiring in the next 7 days.</div></div>
                    ) : expiringSoon.map(o => {
                      const d = daysLeft(o.expiresAt) ?? 0;
                      const tone = d <= 2 ? 'danger' : d <= 5 ? 'warning' : 'success';
                      return (
                        <Link key={o.id} className="widget-row" href={`/orders/${o.id}`}>
                          <span className={`widget-dot ${tone}`} />
                          <span className="widget-label">{o.plan.durationDays}d Mobile · {o.region}</span>
                          <span className="widget-meta">{d}d left</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Recent activity + Buy CTA */}
              <div className="dash-2col-2-1">
                <div className="panel">
                  <div className="panel-header"><span className="panel-title">Recent activity</span></div>
                  <div className="timeline activity-scroll">
                    {events.length === 0 ? (
                      <div className="empty" style={{ padding: '48px 20px' }}><div className="empty-desc">No recent activity yet.</div></div>
                    ) : events.slice(0, 25).map((e, i) => (
                      <div className="tl-item" key={i}>
                        <span className={`tl-dot ${e.dot}`} />
                        <div className="tl-body">
                          <span className="tl-stamp">{fmtAdminStamp(e.at)}</span>
                          <span className="tl-title">{e.title}</span>
                          <span className="tl-detail">{e.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="buy-cta-panel">
                  <div className="buy-cta-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </div>
                  <div className="buy-cta-title">Need more proxies?</div>
                  <div className="buy-cta-text">Browse plans and pick the right tier for your next project.</div>
                  <Link href="/catalog" className="btn primary">Browse plans</Link>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

async function EmptyPlans() {
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { durationDays: 'asc' },
  });
  // Same cards as the marketing site + catalog — one card per duration
  // (location variants collapse; Location is chosen inside checkout).
  const lite = collapseLiveByDuration(plans
    .filter(p => p.capacityState !== 'SOLD_OUT')
    .map(p => ({ durationDays: p.durationDays, price: Number(p.price) })));
  return <PlanShowcase plans={lite} hrefFor={d => `/checkout?duration=${d}`} />;
}
