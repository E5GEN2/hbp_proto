import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { ClientsToolbar } from '@/components/admin/toolbars/ClientsToolbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { fmtAdminStamp } from '@/lib/date';
import { money } from '@/lib/money';

const PER_PAGE = 12;

const initials = (name: string) => name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const PAY_EVENT: Record<string, string> = {
  CONFIRMED: 'Payment confirmed', PAID: 'Payment confirmed', AWAITING: 'Payment awaiting',
  PENDING: 'Payment awaiting', FAILED: 'Payment failed', REFUNDED: 'Refund issued',
  REFUND_REQUESTED: 'Refund requested', MANUAL_REVIEW: 'Manual review',
};

// Canon Clients .dt anchor scheme: 360px Client + 164px Client ID + 240px Last
// event = 764px fixed; middle cols share the slack by --w weights (col-total 9).
const FLEX = (w: number) => `calc((100% - 764px) * ${w} / 9)`;

export default async function AdminClientsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.status ?? 'all';
  const tier = searchParams.tier ?? '';
  const risk = searchParams.risk ?? '';
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const where: any = { role: 'CLIENT' };
  if (view !== 'all') where.status = view.toUpperCase();
  if (tier) where.tier = tier;
  if (risk) where.risk = risk;
  if (q) {
    where.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { telegram: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [clients, total, allCount, activeCount, churnedCount, blockedCount] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { orders: true } },
        orders: { take: 1, orderBy: { createdAt: 'desc' }, select: { createdAt: true } },
        payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { createdAt: true, status: true } },
      },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'CHURNED' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'BLOCKED' } }),
  ]);

  // Per-client aggregates for the visible page (active orders + LTV)
  const ids = clients.map(c => c.id);
  const [activeGrp, ltvGrp] = await Promise.all([
    ids.length ? prisma.order.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }) : [],
    ids.length ? prisma.payment.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: { in: ['CONFIRMED', 'PAID'] } }, _sum: { net: true } }) : [],
  ]);
  const activeMap = new Map(activeGrp.map(g => [g.clientId, g._count._all] as const));
  const ltvMap = new Map(ltvGrp.map(g => [g.clientId, Number(g._sum.net ?? 0)] as const));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  const tabs = [
    { v: 'all', l: 'All', n: allCount },
    { v: 'active', l: 'Active', n: activeCount },
    { v: 'churned', l: 'Churned', n: churnedCount },
    { v: 'blocked', l: 'Blocked', n: blockedCount },
  ];

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Clients' }]} action={<ClientsToolbar />} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q' },
            { kind: 'select', name: 'tier', label: 'Tier: all', size: 'sm', options: [
              { value: 'STANDARD', label: 'Standard' }, { value: 'PRO', label: 'Pro' }, { value: 'VIP', label: 'VIP' },
            ]},
            { kind: 'select', name: 'risk', label: 'Risk: all', size: 'sm', options: [
              { value: 'NONE', label: 'None' }, { value: 'REVIEW', label: 'Under review' }, { value: 'FLAG', label: 'Flagged' },
            ]},
          ]}
          exportLabel="Export CSV"
        />

        <div className="panel">
          <div className="tabs">
            {tabs.map(t => {
              const tsp = new URLSearchParams(sp);
              tsp.set('status', t.v); tsp.delete('page');
              return (
                <Link key={t.v} href={`/admin/clients?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                  {t.l}<span className="tab-count">{t.n}</span>
                </Link>
              );
            })}
          </div>

          <div className="table-wrap">
            <table className="dt">
              <colgroup>
                <col style={{ width: 360 }} />
                <col style={{ width: 'var(--anchor-id)' }} />
                <col style={{ width: FLEX(2) }} />
                <col style={{ width: FLEX(2) }} />
                <col style={{ width: FLEX(3) }} />
                <col style={{ width: FLEX(2) }} />
                <col style={{ width: 240 }} />
              </colgroup>
              <thead><tr>
                <th className="col-text">Client</th>
                <th className="col-id">Client ID</th>
                <th className="col-num">Orders<span className="help-tip" data-tip="Active orders / total orders.">i</span></th>
                <th className="col-money">LTV<span className="help-tip" data-tip="Lifetime value — sum of all confirmed payments, before refunds.">i</span></th>
                <th className="col-status">Status<span className="help-tip" data-tip="Primary client lifecycle status: Active / Churned / Blocked. Distinct from Risk.">i</span></th>
                <th className="col-status">Risk<span className="help-tip" data-tip="Risk is a manual ops/support flag — a contextual state, separate from client Status. Clean clients show as —. Review means manual attention. Flagged means serious concern such as chargeback, abuse, fraud pattern, or policy issue.">i</span></th>
                <th className="col-text">Last event</th>
              </tr></thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty"><div className="empty-desc">No clients match these filters.</div></div></td></tr>
                ) : clients.map(c => {
                  const status = c.status.toLowerCase();
                  const activeOrders = activeMap.get(c.id) ?? 0;
                  const ltv = ltvMap.get(c.id) ?? 0;
                  const lastOrder = c.orders[0];
                  const lastPay = c.payments[0];
                  let ev: { date: Date; label: string } | null = null;
                  if (lastOrder) ev = { date: lastOrder.createdAt, label: 'Order created' };
                  if (lastPay && (!ev || lastPay.createdAt > ev.date)) ev = { date: lastPay.createdAt, label: PAY_EVENT[lastPay.status] ?? 'Payment' };
                  return (
                    <tr key={c.id}>
                      <td className="col-text">
                        <div className="client-cell">
                          <div className={`avatar client-avatar ${status}`}>{initials(c.name)}</div>
                          <div className="client-cell-body">
                            <div className="client-cell-name">
                              <Link href={`/admin/clients/${c.id}`} className="client-name-link cell-tip" data-tip={c.name}>{c.name}</Link>
                              {c.tier !== 'STANDARD' && <span className="client-tier">{c.tier === 'VIP' ? 'VIP' : 'Pro'}</span>}
                            </div>
                            <div className="client-cell-contact cell-tip" data-tip={`${c.email}${c.telegram && c.telegram !== '—' ? ` · ${c.telegram}` : ''}`}>{c.email}{c.telegram && c.telegram !== '—' && <><span className="sep">·</span>{c.telegram}</>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="col-id"><span className="cell-tip" data-tip={c.id}><Link href={`/admin/clients/${c.id}`} className="client-link">{c.id}</Link></span></td>
                      <td className="col-num">{activeOrders}<span className="muted"> / {c._count.orders}</span></td>
                      <td className="col-money">{money(ltv)}</td>
                      <td className="col-status"><span className={`chip ${status}`}>{cap(status)}</span></td>
                      <td className="col-status">
                        {c.risk === 'NONE' ? <span className="risk-clean">—</span>
                          : c.risk === 'REVIEW' ? <span className="chip review">Review</span>
                          : <span className="chip flag">Flagged</span>}
                      </td>
                      {ev
                        ? <td className="col-text"><span className="cell-tip" data-tip={`${fmtAdminStamp(ev.date)} · ${ev.label}`}><span className="td-mono">{fmtAdminStamp(ev.date)}</span> <span className="muted">· {ev.label}</span></span></td>
                        : <td className="col-text muted">—</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/clients" search={sp} />
        </div>
      </main>
    </>
  );
}
