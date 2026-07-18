import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { fmtAdminStamp } from '@/lib/date';
import { MarkFaultyButton, ReleaseProxyButton, ReturnToPoolButton, MarkHealthyButton, MaintenanceButton, ReplaceProxyButton } from '@/components/admin/ActionButtons';
import { AddNoteToolbar } from '@/components/admin/toolbars/AddNoteToolbar';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export default async function AdminProxyDetail({ params }: { params: { id: string } }) {
  const proxy = await prisma.proxy.findUnique({
    where: { id: params.id },
    include: {
      assignments: {
        where: { releasedAt: null },
        take: 1,
        include: { order: { include: { client: { select: { id: true, name: true } }, plan: { select: { name: true } } } } },
      },
      whitelist: { orderBy: { addedAt: 'asc' }, include: { user: { select: { name: true } } } },
    },
  });
  if (!proxy) notFound();

  const active = proxy.assignments[0];
  const dataGb = (proxy.trafficUsedMB / 1024).toFixed(1);
  const curlExample = `curl -x http://${proxy.ip}:${proxy.port} https://api.ipify.org`;
  const healthChip = proxy.health === 'HEALTHY' ? 'healthy' : 'faulty';

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Proxies', href: '/admin/proxies' },
        { label: proxy.id },
      ]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div className="detail-page-shell">
        <div className="detail-header">
          <div className="detail-header-left">
            <div className="detail-id">{proxy.id}</div>
            <div className="detail-chips">
              <span className={`chip ${proxy.status.toLowerCase()}`}>{cap(proxy.status)}</span>
              <span className={`chip ${healthChip}`}>{cap(proxy.health)}</span>
            </div>
          </div>
          <div className="detail-header-actions">
            <AddNoteToolbar objectType="PROXY" objectId={proxy.id} label="Add note" />
            {(proxy.status === 'AVAILABLE' || proxy.status === 'ASSIGNED' || proxy.status === 'MAINTENANCE') && (
              <MaintenanceButton proxyId={proxy.id} inMaintenance={proxy.status === 'MAINTENANCE'} />
            )}
            {proxy.status === 'RELEASED' && <ReturnToPoolButton proxyId={proxy.id} />}
            {proxy.status === 'FAULTY' && <MarkHealthyButton proxyId={proxy.id} />}
            {active && (proxy.status === 'ASSIGNED' || proxy.status === 'FAULTY') && <ReplaceProxyButton proxyId={proxy.id} orderId={active.orderId} />}
            {(proxy.status === 'ASSIGNED' || proxy.status === 'FAULTY') && <ReleaseProxyButton proxyId={proxy.id} />}
            {proxy.status !== 'FAULTY' && <MarkFaultyButton proxyId={proxy.id} />}
          </div>
        </div>

        {/* KPI strip — Uptime 30d · Data 30D · Avg latency */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
          <div className="mini-stat"><div className="mini-stat-label">Uptime 30d</div><div className="mini-stat-value" style={{ color: proxy.uptime >= 95 ? 'var(--success)' : 'var(--warning)' }}>{proxy.uptime}%</div></div>
          <div className="mini-stat"><div className="mini-stat-label">Data 30D</div><div className="mini-stat-value">{dataGb} GB</div></div>
          <div className="mini-stat"><div className="mini-stat-label">Avg latency</div><div className="mini-stat-value">{proxy.latency ? `${proxy.latency}ms` : '—'}</div></div>
        </div>

        <div className="grid-detail" style={{ marginTop: 16 }}>
          <div className="grid-left">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Technical details</span></div>
              <div className="kv">
                <div className="kv-row"><span className="kv-key">Proxy ID</span><span className="kv-val">{proxy.id}</span></div>
                <div className="kv-row"><span className="kv-key">Carrier · Region</span><span className="kv-val">{proxy.carrier} · {proxy.region}</span></div>
                <div className="kv-row"><span className="kv-key">Pool</span><span className="kv-val">{proxy.pool}</span></div>
                <div className="kv-row"><span className="kv-key">Hardware ID</span><span className="kv-val">{proxy.modem}</span></div>
                <div className="kv-row"><span className="kv-key">Host</span><span className="kv-val mono">{proxy.ip}</span></div>
                <div className="kv-row"><span className="kv-key">Port</span><span className="kv-val mono">{proxy.port}</span></div>
                <div className="kv-row"><span className="kv-key">Username</span><span className="kv-val mono">{proxy.username}</span></div>
                <div className="kv-row"><span className="kv-key">Password</span><span className="kv-val mono">{proxy.password}</span></div>
                <div className="kv-row"><span className="kv-key">Rotation URL</span><span className="kv-val mono">{proxy.rotationUrl ?? <span className="muted">—</span>}</span></div>
                <div className="kv-row"><span className="kv-key">Protocols</span><span className="kv-val">HTTPS, SOCKS5</span></div>
                <div className="kv-row"><span className="kv-key">Curl</span><span className="kv-val wrap">{curlExample}</span></div>
              </div>
            </div>

            {/* Whitelist — Stage 1.5 (per handoff decisions); read-only */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Whitelist</span></div>
              {proxy.whitelist.length === 0 ? (
                <div className="kv">
                  <div className="kv-row"><span className="kv-val muted" style={{ textAlign: 'left' }}>No IP restrictions — all source IPs allowed.</span></div>
                </div>
              ) : (
                <div className="kv">
                  {proxy.whitelist.map(w => (
                    <div key={w.id} className="kv-row">
                      <span className="kv-key mono">{w.ip}</span>
                      <span className="kv-val">{w.user?.name ?? w.addedBy} · {fmtAdminStamp(w.addedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <EntityNotesPanel objectType="PROXY" objectId={proxy.id} />
          </div>

          <div className="grid-right">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Current assignment</span></div>
              <div className="kv">
                {active ? (
                  <>
                    <div className="kv-row"><span className="kv-key">Order</span><span className="kv-val"><Link href={`/admin/orders/${active.order.id}`} className="td-link">{active.order.id}</Link></span></div>
                    <div className="kv-row"><span className="kv-key">Client</span><span className="kv-val"><Link href={`/admin/clients/${active.order.client.id}`} className="client-link mono">{active.order.client.id}</Link> <span className="muted">· {active.order.client.name}</span></span></div>
                    <div className="kv-row"><span className="kv-key">Plan</span><span className="kv-val">{active.order.plan.name}</span></div>
                    <div className="kv-row"><span className="kv-key">Expires with order</span><span className="kv-val">{active.order.expiresAt ? fmtAdminStamp(active.order.expiresAt) : '—'}</span></div>
                  </>
                ) : (
                  <div className="kv-row"><span className="kv-key">Assignment</span><span className="kv-val muted">Not currently assigned</span></div>
                )}
              </div>
            </div>

            <EntityActivityWidget objectType="PROXY" objectId={proxy.id} />
          </div>
        </div>
        </div>
      </main>
    </>
  );
}
