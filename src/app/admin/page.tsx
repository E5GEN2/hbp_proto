import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

// Flexible .dt column widths (canon applyDtAnchors reproduced in pure CSS): each
// flex col = (100% − fixed anchors) × w / col-total. Recent Orders: anchor-id +
// anchor-date = 328px fixed, col-total 19. Capacity: anchor-text + 168px = 336px,
// col-total 3.
const FLEX_RO = (w: number) => `calc((100% - 328px) * ${w} / 19)`;
const FLEX_CAP = (w: number) => `calc((100% - 336px) * ${w} / 3)`;

const CAP_LABEL: Record<string, string> = {
  available: 'Available',
  'sold-out': 'Sold out',
  'blocked-grace': 'Blocked by grace',
  'waiting-release': 'Waiting release',
  low: 'Low availability',
};

export default async function AdminDashboardPage() {
  const [
    paidToday, revenue30dAgg, activeOrders, activeClients, expiringToday, inGrace,
    recentOrders, capacityRows, healthBuckets,
  ] = await Promise.all([
    prisma.payment.aggregate({
      _sum: { net: true },
      where: { status: { in: ['CONFIRMED', 'PAID'] }, confirmedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.payment.aggregate({
      _sum: { net: true },
      where: { status: { in: ['CONFIRMED', 'PAID'] }, confirmedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.order.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'ACTIVE' } }),
    prisma.order.count({
      where: { status: 'ACTIVE', expiresAt: { gte: new Date(new Date().setHours(0,0,0,0)), lte: new Date(new Date().setHours(23,59,59,999)) } },
    }),
    prisma.order.count({ where: { renewalBucket: 'GRACE' } }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { client: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } },
    }),
    prisma.plan.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { durationDays: 'asc' },
      take: 6,
    }),
    Promise.all([
      prisma.proxy.count({ where: { OR: [{ status: 'FAULTY' }, { health: 'OFFLINE' }] } }),
      prisma.proxy.count({ where: { status: 'MAINTENANCE' } }),
    ]),
  ]);

  // Read-only: Expiring Soon (24h/3d/7d) + Exceptions by type for the canon widgets
  const [expBuckets, excBuckets] = await Promise.all([
    prisma.order.groupBy({ by: ['renewalBucket'], where: { renewalBucket: { in: ['H24', 'D3', 'D7'] } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['exception'], where: { exception: { not: null } }, _count: { _all: true } }),
  ]);
  const expN = (b: 'H24' | 'D3' | 'D7') => expBuckets.find(x => x.renewalBucket === b)?._count._all ?? 0;
  const excN = (e: string) => excBuckets.find(x => x.exception === e)?._count._all ?? 0;

  const [faulty, maintenance] = healthBuckets;

  // capacity computation
  async function capacityFor(planId: string) {
    const a = await prisma.order.aggregate({
      _sum: { qty: true },
      where: { planId, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    return a._sum.qty ?? 0;
  }
  const capacity = await Promise.all(capacityRows.map(async p => {
    const allocated = await capacityFor(p.id);
    const displayAvail = Math.max(0, p.availableQuota - allocated);
    let state: string = 'available';
    if (displayAvail === 0 && p.availableQuota > 0) state = 'sold-out';
    else if (p.capacityState === 'BLOCKED_GRACE') state = 'blocked-grace';
    else if (p.capacityState === 'WAITING_RELEASE') state = 'waiting-release';
    else if (displayAvail / p.availableQuota < 0.15) state = 'low';
    return { plan: p, allocated, displayAvail, state };
  }));

  return (
    <>
      <AdminTopbar title="Dashboard" />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        {/* KPI row — Paid Today · Revenue 30D · Active Orders · Active Clients · Expiring Today · In Grace Period */}
        <div className="kpi-row" style={{ marginBottom: 16 }}>
          <Link className="kpi-card" href="/admin/payments?view=confirmed" title="Open Payments · Confirmed">
            <div className="kpi-label">Paid Today</div>
            <div className="kpi-value tone-success">{money(Number(paidToday._sum.net ?? 0))}</div>
            <div className="kpi-accent-bar full green" />
          </Link>
          <Link className="kpi-card" href="/admin/payments" title="Open Payments">
            <div className="kpi-label">Revenue 30D</div>
            <div className="kpi-value tone-success">{money(Number(revenue30dAgg._sum.net ?? 0))}</div>
            <div className="kpi-accent-bar full green" />
          </Link>
          <Link className="kpi-card" href="/admin/orders?view=active" title="Open Orders · Active">
            <div className="kpi-label">Active Orders</div>
            <div className="kpi-value tone-violet">{activeOrders}</div>
            <div className="kpi-accent-bar full violet" />
          </Link>
          <Link className="kpi-card" href="/admin/clients?status=active" title="Open Clients · Active">
            <div className="kpi-label">Active Clients</div>
            <div className="kpi-value tone-violet">{activeClients}</div>
            <div className="kpi-accent-bar full violet" />
          </Link>
          <Link className="kpi-card" href="/admin/renewals?view=24h" title="Open Renewals · Next 24h">
            <div className="kpi-label">Expiring Today</div>
            <div className="kpi-value tone-warning">{expiringToday}</div>
            <div className="kpi-accent-bar full orange" />
          </Link>
          <Link className="kpi-card" href="/admin/renewals?view=grace" title="Open Renewals · In grace">
            <div className="kpi-label">In Grace Period</div>
            <div className="kpi-value tone-danger">{inGrace}</div>
            <div className="kpi-accent-bar full red" />
          </Link>
        </div>

        <div className="grid-2col">
          <div className="grid-left">
            {/* Recent Orders */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Recent Orders</span>
                <Link className="panel-action" href="/admin/orders">View all →</Link>
              </div>
              <div className="table-wrap">
                <table className="dt">
                  <colgroup>
                    <col style={{ width: 'var(--anchor-id)' }} />
                    <col style={{ width: FLEX_RO(4) }} />
                    <col style={{ width: FLEX_RO(5) }} />
                    <col style={{ width: FLEX_RO(3) }} />
                    <col style={{ width: FLEX_RO(3) }} />
                    <col style={{ width: FLEX_RO(4) }} />
                    <col style={{ width: 'var(--anchor-date)' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="col-id">Order ID</th>
                      <th className="col-id">Client ID</th>
                      <th className="col-text">Plan</th>
                      <th className="col-money">Amount</th>
                      <th className="col-status">Payment</th>
                      <th className="col-status">Status</th>
                      <th className="col-date">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.length === 0 ? (
                      <tr><td colSpan={7}><div className="empty"><div className="empty-desc">No orders yet.</div></div></td></tr>
                    ) : recentOrders.map(o => (
                      <tr key={o.id}>
                        <td className="col-id"><Link href={`/admin/orders/${o.id}`} className="td-link">{o.id}</Link></td>
                        <td className="col-id"><Link href={`/admin/clients/${o.client.id}`} className="td-link">{o.client.id}</Link></td>
                        <td className="col-text">{o.plan.name}</td>
                        <td className="col-money">{money(Number(o.amount))}</td>
                        <td className="col-status"><span className={`chip ${o.paymentStatus.toLowerCase()}`}>{o.paymentStatus.toLowerCase()}</span></td>
                        <td className="col-status"><span className={`chip ${o.status.toLowerCase().replace('_', '-')}`}>{o.status.toLowerCase()}</span></td>
                        <td className="col-date">{fmtAdminStamp(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selling Capacity by Plan */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Selling Capacity by Plan<span className="help-tip" title="One Capacity State label per plan: Available (default) · Low availability · Blocked by grace · Waiting release · Sold out.">i</span></span>
                <Link className="panel-action" href="/admin/plans">Manage plans →</Link>
              </div>
              <div className="table-wrap">
                <table className="dt capacity-table">
                  <colgroup>
                    <col style={{ width: 'var(--anchor-text)' }} />
                    <col style={{ width: FLEX_CAP(1) }} />
                    <col style={{ width: FLEX_CAP(1) }} />
                    <col style={{ width: FLEX_CAP(1) }} />
                    <col style={{ width: 168 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="col-text">Plan</th>
                      <th className="col-num">Quota<span className="help-tip" title="Total capacity this plan is configured to sell.">i</span></th>
                      <th className="col-num">Allocated<span className="help-tip" title="Capacity occupied by live orders, including grace and unreleased assignments.">i</span></th>
                      <th className="col-num">Available<span className="help-tip" title="Quota − Allocated. What the client portal shows as sellable. If 0, hidden from checkout.">i</span></th>
                      <th className="col-status">Capacity State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capacity.length === 0 ? (
                      <tr><td colSpan={5}><div className="empty"><div className="empty-desc">No plans configured.</div></div></td></tr>
                    ) : capacity.map(c => (
                      <tr key={c.plan.id}>
                        <td className="col-text"><Link href={`/admin/plans/${c.plan.id}`} className="plan-link">{c.plan.name}</Link></td>
                        <td className="col-num">{c.plan.availableQuota}</td>
                        <td className="col-num">{c.allocated}</td>
                        <td className="col-num">{c.displayAvail}</td>
                        <td className="col-status"><span className={`cap-label ${c.state}`}>{CAP_LABEL[c.state] ?? c.state}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid-right">
            {/* Expiring Soon */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Expiring Soon</span>
                <Link className="panel-action" href="/admin/renewals">Open →</Link>
              </div>
              <Link className="expiring-segment" href="/admin/renewals?view=24h">
                <span className="issue-dot" style={{ background: 'var(--danger)' }} />
                <span className="exp-label">Next 24 hours</span>
                <span className="exp-count">{expN('H24')}</span>
              </Link>
              <Link className="expiring-segment" href="/admin/renewals?view=3d">
                <span className="issue-dot" style={{ background: 'var(--warning)' }} />
                <span className="exp-label">In 3 days</span>
                <span className="exp-count">{expN('D3')}</span>
              </Link>
              <Link className="expiring-segment" href="/admin/renewals?view=7d">
                <span className="issue-dot" style={{ background: 'var(--violet)' }} />
                <span className="exp-label">In 7 days</span>
                <span className="exp-count">{expN('D7')}</span>
              </Link>
            </div>

            {/* Exceptions */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Exceptions<span className="help-tip" title="Orders stuck between lifecycle steps and needing admin attention. Click a row to open Orders filtered to that exception.">i</span></span>
                <Link className="panel-action" href="/admin/orders?view=exceptions">Resolve →</Link>
              </div>
              <Link className="issue-row" href="/admin/orders?view=exceptions">
                <span className="issue-dot" style={{ background: 'var(--danger)' }} />
                <span className="issue-label">Paid but not provisioned</span>
                <span className="issue-count">{excN('PAID_NOT_PROVISIONED')}</span>
              </Link>
              <Link className="issue-row" href="/admin/orders?view=exceptions">
                <span className="issue-dot" style={{ background: 'var(--warning)' }} />
                <span className="issue-label">Renewal paid but not extended</span>
                <span className="issue-count">{excN('RENEWAL_NOT_EXTENDED')}</span>
              </Link>
              <Link className="issue-row" href="/admin/orders?view=exceptions">
                <span className="issue-dot" style={{ background: 'var(--violet)' }} />
                <span className="issue-label">Replacement requested, not done</span>
                <span className="issue-count">{excN('REPLACEMENT_PENDING')}</span>
              </Link>
            </div>

            {/* Proxy Health */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Proxy Health<span className="help-tip" title="Proxies needing attention. Click a row to open Proxies filtered to that issue.">i</span></span>
                <Link className="panel-action" href="/admin/proxies">Review →</Link>
              </div>
              <Link className="issue-row" href="/admin/proxies?health=faulty">
                <span className="issue-dot" style={{ background: 'var(--danger)' }} />
                <span className="issue-label">Faulty / offline</span>
                <span className="issue-count">{faulty}</span>
              </Link>
              <Link className="issue-row" href="/admin/proxies?health=maintenance">
                <span className="issue-dot" style={{ background: 'var(--warning)' }} />
                <span className="issue-label">Maintenance</span>
                <span className="issue-count">{maintenance}</span>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
