import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { underProvisionedCount } from '@/lib/provisioning';

// Flexible .dt column widths — canon Column System (prototype.html :root docs):
// each flex col = 100% × w / col-total; px anchors + % flexibles are then
// renormalized together by table-layout: fixed, exactly like the canon
// calc(var(--w) / var(--col-total) * 100%).
const FLEX_RO = (w: number) => `calc(100% * ${w} / 19)`;
const FLEX_CAP = (w: number) => `calc(100% * ${w} / 3)`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

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
      // OFFLINE health only coexists with FAULTY status (coherence invariant),
      // so counting FAULTY is exact — and matches the /admin/proxies?health=faulty
      // destination this widget links to (counter == page count).
      prisma.proxy.count({ where: { status: 'FAULTY' } }),
      prisma.proxy.count({ where: { status: 'MAINTENANCE' } }),
    ]),
  ]);

  // Read-only: Expiring Soon (24h/3d/7d) + Exceptions by type for the canon widgets
  const [expBuckets, excBuckets, underProvisioned] = await Promise.all([
    prisma.order.groupBy({ by: ['renewalBucket'], where: { renewalBucket: { in: ['H24', 'D3', 'D7'] } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['exception'], where: { exception: { not: null } }, _count: { _all: true } }),
    underProvisionedCount(),
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
                        <td className="col-id"><span className="cell-tip" data-tip={o.id}><Link href={`/admin/orders/${o.id}`} className="td-link">{o.id}</Link></span></td>
                        <td className="col-id"><span className="cell-tip" data-tip={o.client.id}><Link href={`/admin/clients/${o.client.id}`} className="td-link">{o.client.id}</Link></span></td>
                        <td className="col-text muted"><span className="cell-tip" data-tip={o.plan.name}>{o.plan.name}</span></td>
                        <td className="col-money">{money(Number(o.amount))}</td>
                        <td className="col-status"><span className={`chip ${o.paymentStatus.toLowerCase()}`}>{cap(o.paymentStatus.replace(/_/g, ' '))}</span></td>
                        <td className="col-status"><span className={`chip ${o.status.toLowerCase().replace(/_/g, '-')}`}>{cap(o.status.replace(/_/g, ' '))}</span></td>
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
                <span className="panel-title">Selling Capacity by Plan<span className="help-tip" data-tip="One Capacity State label per plan. Default is Available; the priority order for non-default states is Sold out → Blocked by grace → Waiting release → Low availability. Capacity State is contextual — separate from a plan's primary Status.">i</span></span>
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
                      <th className="col-num"><span className="th-label">Quota<span className="help-tip" data-tip="Total capacity this plan is configured to sell. Set manually on the plan. The hard ceiling.">i</span></span></th>
                      <th className="col-num"><span className="th-label">Allocated<span className="help-tip" data-tip="Capacity occupied by live orders. Includes orders in grace and unreleased assignments.">i</span></span></th>
                      <th className="col-num"><span className="th-label">Available<span className="help-tip" data-tip="What the client portal shows as sellable right now. Quota − Allocated. If 0, the plan is hidden from checkout.">i</span></span></th>
                      <th className="col-status"><span className="th-label">Capacity State<span className="help-tip" data-tip="Derived selling condition based on Available quota, allocated orders, grace blocks, and release timing. One label per plan: Available (default) · Low availability · Blocked by grace · Waiting release · Sold out. At most one per plan. Separate from the plan's primary Status (Active / Disabled).">i</span></span></th>
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
                <span className="panel-title">Exceptions<span className="help-tip" data-tip="Operational conditions requiring admin attention — orders stuck between lifecycle steps. Separate from each order's primary Status. Click any row to open them inside the Orders page, filtered to that exception type.">i</span></span>
                <Link className="panel-action" href="/admin/orders?view=exceptions">Resolve →</Link>
              </div>
              {/* One authoritative proxy-shortage row: ACTIVE paid orders below
                  their bought quantity. Subsumes "paid, not provisioned" (0
                  attached) and "replacement pending" (lost one) — those are the
                  same orders, so listing them separately double-reported. Links
                  to the matching Orders tab (counter == page count). */}
              <Link className="issue-row" href="/admin/orders?view=underprovisioned">
                <span className="issue-dot" style={{ background: 'var(--danger)' }} />
                <span className="issue-label">Active orders missing proxies</span>
                <span className="issue-count">{underProvisioned}</span>
              </Link>
              <Link className="issue-row" href="/admin/orders?view=exceptions&exc=renewal-not-extended">
                <span className="issue-dot" style={{ background: 'var(--warning)' }} />
                <span className="issue-label">Renewal paid but not extended</span>
                <span className="issue-count">{excN('RENEWAL_NOT_EXTENDED')}</span>
              </Link>
              <Link className="issue-row" href="/admin/orders?view=exceptions&exc=refund-pending">
                <span className="issue-dot" style={{ background: 'var(--violet)' }} />
                <span className="issue-label">Refund review requested</span>
                <span className="issue-count">{excN('REFUND_PENDING')}</span>
              </Link>
            </div>

            {/* Proxy Health */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Proxy Health<span className="help-tip" data-tip="Proxies needing attention. Click any row to open them inside the Proxies page, filtered to that issue type.">i</span></span>
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
