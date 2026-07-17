import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { ClientDetailActions } from '@/components/admin/toolbars/ClientDetailActions';
import { ClientOrdersTable } from '@/components/admin/ClientOrdersTable';
import { AdjustBalanceButton } from '@/components/admin/ActionButtons';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';
import { PAY_CHIP, PAY_LABEL } from '@/lib/payment-display';

const initials = (name: string) => name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export default async function AdminClientDetail({ params }: { params: { id: string } }) {
  const c = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      orders: {
        include: {
          plan: true,
          assignments: { where: { releasedAt: null }, select: { proxyId: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      payments: { orderBy: { createdAt: 'desc' }, include: { order: { select: { id: true } } } },
    },
  });
  if (!c || c.role !== 'CLIENT') notFound();

  const activeOrders = c.orders.filter(o => o.status === 'ACTIVE').length;
  const activeProxies = new Set(c.orders.flatMap(o => o.assignments.map(a => a.proxyId))).size;
  const ltv = c.payments.filter(p => p.status === 'CONFIRMED' || p.status === 'PAID').reduce((s, p) => s + Number(p.net), 0);

  const catalogItems = await prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } });
  const carriers = catalogItems.filter(i => i.kind === 'CARRIER').map(i => i.value);
  const regions = catalogItems.filter(i => i.kind === 'REGION').map(i => i.value);

  const editInitial = {
    name: c.name, telegram: c.telegram, country: c.country, tier: c.tier,
    preferredCarrier: c.preferredCarrier, preferredRegion: c.preferredRegion,
    emailRenewal: c.emailRenewal, emailIncidents: c.emailIncidents, emailMarketing: c.emailMarketing,
    telegramAll: c.telegramAll, preRenewalReminderHours: c.preRenewalReminderHours,
  };

  const status = c.status.toLowerCase();
  const riskChip = c.risk === 'NONE' ? <span className="chip released">Clean</span>
    : c.risk === 'REVIEW' ? <span className="chip review">Under review</span>
    : <span className="chip flag">Flagged</span>;

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Clients', href: '/admin/clients' },
        { label: `${c.id} · ${c.name}` },
      ]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div className="detail-page-shell">
        {/* Identity header */}
        <div className="detail-header">
          <div className="detail-header-left">
            <div className="client-detail-identity">
              <div className={`avatar lg client-avatar ${status}`}>{initials(c.name)}</div>
              <div className="client-detail-identity-body">
                <div className="client-detail-identity-name">
                  <span className="name-label mono">{c.id}</span>
                  {c.tier !== 'STANDARD' && <span className="client-tier">{c.tier === 'VIP' ? 'VIP' : 'Pro'}</span>}
                  <span className={`chip ${status}`}>{cap(status)}</span>
                  {c.risk !== 'NONE' && <span className={`chip ${c.risk === 'REVIEW' ? 'review' : 'flag'}`}>{c.risk === 'REVIEW' ? 'Review' : 'Flagged'}</span>}
                </div>
                <div className="client-detail-identity-meta">
                  <span className="t-primary">{c.name}</span>
                  <span className="sep">·</span>
                  {c.email}
                  {c.telegram && c.telegram !== '—' && <><span className="sep">·</span>{c.telegram}</>}
                </div>
              </div>
            </div>
          </div>
          <div className="detail-header-actions">
            <Link href={`/admin/proxies?client=${c.id}`} className="btn">Proxies{activeProxies > 0 ? ` (${activeProxies})` : ''}</Link>
            <ClientDetailActions clientId={c.id} initial={editInitial} blocked={c.status === 'BLOCKED'} risk={c.risk} carriers={carriers} regions={regions} />
          </div>
        </div>

        {/* Summary — 3 KPI tiles */}
        <div className="client-detail-summary" style={{ marginTop: 16 }}>
          <div className="mini-stat"><div className="mini-stat-label">Active orders</div><div className="mini-stat-value">{activeOrders}</div></div>
          <div className="mini-stat"><div className="mini-stat-label">Total orders</div><div className="mini-stat-value">{c.orders.length}</div></div>
          <div className="mini-stat"><div className="mini-stat-label">Lifetime value</div><div className="mini-stat-value">{money(ltv)}</div></div>
        </div>

        <div className="grid-detail" style={{ marginTop: 16 }}>
          <div className="grid-left">
            <ClientOrdersTable orders={c.orders.map(o => ({
              id: o.id,
              planName: o.plan.name,
              proxies: o.assignments.map(a => a.proxyId),
              periodStart: o.createdAt,
              periodEnd: o.expiresAt,
              amount: Number(o.amount),
              paymentStatus: o.paymentStatus,
              paymentId: o.payments[0]?.id ?? null,
              autoRenew: o.autoRenew,
              status: o.status,
              exception: o.exception,
            }))} />

            {/* Payments */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Payments</span></div>
              <div className="table-wrap">
                <table className="dt">
                  <colgroup>
                    <col style={{ width: 'calc(100% * 3 / 19)' }} />
                    <col style={{ width: 'calc(100% * 3 / 19)' }} />
                    <col style={{ width: 'calc(100% * 5 / 19)' }} />
                    <col style={{ width: 'calc(100% * 2 / 19)' }} />
                    <col style={{ width: 'calc(100% * 3 / 19)' }} />
                    <col style={{ width: 'calc(100% * 3 / 19)' }} />
                  </colgroup>
                  <thead><tr>
                    <th className="col-id">Payment ID</th>
                    <th className="col-id">Order ID</th>
                    <th className="col-text">Provider · Method</th>
                    <th className="col-money">Amount</th>
                    <th className="col-status">Status</th>
                    <th className="col-date">Date</th>
                  </tr></thead>
                  <tbody>
                    {c.payments.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: '18px 20px', textAlign: 'center', color: 'var(--muted)' }}>No payments.</td></tr>
                    ) : c.payments.slice(0, 10).map(p => (
                      <tr key={p.id}>
                        <td className="col-id"><Link href={`/admin/payments/${p.id}`} className="td-link">{p.id}</Link></td>
                        <td className="col-id">{p.order ? <Link href={`/admin/orders/${p.order.id}`} className="td-link">{p.order.id}</Link> : <span className="muted">—</span>}</td>
                        <td className="col-text muted">{p.provider} · {p.method}</td>
                        <td className="col-money">{money(Number(p.gross))}</td>
                        <td className="col-status"><span className={`chip ${PAY_CHIP[p.status] ?? 'expired'}`}>{PAY_LABEL[p.status] ?? p.status}</span></td>
                        <td className="col-date">{fmtAdminStamp(p.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <EntityNotesPanel objectType="CLIENT" objectId={c.id} />
          </div>

          <div className="grid-right">
            {/* Profile */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Profile</span></div>
              <div className="kv">
                <div className="kv-row"><span className="kv-key">Client ID</span><span className="kv-val">{c.id}</span></div>
                <div className="kv-row"><span className="kv-key">Country</span><span className="kv-val">{c.country ?? '—'}</span></div>
                <div className="kv-row"><span className="kv-key">Joined</span><span className="kv-val">{fmtAdminStamp(c.createdAt)}</span></div>
                <div className="kv-row"><span className="kv-key">Source</span><span className="kv-val">{c.acquisition ?? '—'}</span></div>
                <div className="kv-row"><span className="kv-key">Risk</span><span className="kv-val">{riskChip}</span></div>
              </div>
            </div>

            {/* Balance — Stage 1.5 (per handoff decisions) */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Balance</span></div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="mini-stat-value" style={{ fontSize: 22 }}>{money(Number(c.balance))}</div>
                <AdjustBalanceButton userId={c.id} />
              </div>
            </div>

            {/* Preferences (read-only here; edited via Edit client) */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Preferences</span></div>
              <div className="kv">
                <div className="preference-row"><span className="pref-label">Preferred carrier</span><span className="pref-control">{c.preferredCarrier ?? '—'}</span></div>
                <div className="preference-row"><span className="pref-label">Preferred region</span><span className="pref-control">{c.preferredRegion ?? '—'}</span></div>
                <div className="preference-row"><span className="pref-label">Email notifications</span><span className="pref-control"><span className={`toggle-v2${c.emailRenewal ? ' on' : ''}`} /></span></div>
                <div className="preference-row"><span className="pref-label">Telegram alerts</span><span className="pref-control"><span className={`toggle-v2${c.telegramAll ? ' on' : ''}`} /></span></div>
                <div className="preference-row"><span className="pref-label">Pre-renewal reminder</span><span className="pref-control">{c.preRenewalReminderHours}h</span></div>
              </div>
            </div>

            <EntityActivityWidget objectType="CLIENT" objectId={c.id} />
          </div>
        </div>
        </div>
      </main>
    </>
  );
}
