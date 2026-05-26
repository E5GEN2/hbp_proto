import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { fmtAdminStamp } from '@/lib/date';
import { MarkFaultyButton, ReleaseProxyButton } from '@/components/admin/ActionButtons';
import { AddNoteToolbar } from '@/components/admin/toolbars/AddNoteToolbar';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

export default async function AdminProxyDetail({ params }: { params: { id: string } }) {
  const proxy = await prisma.proxy.findUnique({
    where: { id: params.id },
    include: {
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: { order: { include: { client: { select: { id: true, name: true } }, plan: { select: { name: true } } } } },
      },
    },
  });
  if (!proxy) notFound();

  const activeAssignment = proxy.assignments.find(a => a.releasedAt === null);

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Dashboard', href: '/admin' },
        { label: 'Proxies', href: '/admin/proxies' },
        { label: proxy.id },
      ]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{proxy.id}</h2>
          <span className={`chip ${proxy.status.toLowerCase()}`}>{proxy.status.toLowerCase()}</span>
          <span className={`chip ${proxy.health.toLowerCase()}`}>{proxy.health.toLowerCase()}</span>
          <div style={{ flex: 1 }} />
          {proxy.status !== 'FAULTY' && <MarkFaultyButton proxyId={proxy.id} />}
          {(proxy.status === 'ASSIGNED' || proxy.status === 'FAULTY') && <ReleaseProxyButton proxyId={proxy.id} />}
          <AddNoteToolbar objectType="PROXY" objectId={proxy.id} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <KpiTile label="Uptime 30D" value={`${proxy.uptime.toFixed(1)}%`} />
          <KpiTile label="Speed" value={`${proxy.speedMbps} Mbps`} />
          <KpiTile label="Avg latency" value={proxy.latency ? `${proxy.latency} ms` : '—'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Technical details</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Proxy ID</span><span className="kv-val mono">{proxy.id}</span></div>
              <div className="kv-row"><span className="kv-label">Hardware ID</span><span className="kv-val mono">{proxy.modem}</span></div>
              <div className="kv-row"><span className="kv-label">IMEI</span><span className="kv-val mono">{proxy.imei ?? '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{proxy.carrier} · {proxy.region}</span></div>
              <div className="kv-row"><span className="kv-label">Pool</span><span className="kv-val">{proxy.pool}</span></div>
              <div className="kv-row"><span className="kv-label">Host : Port</span><span className="kv-val mono">{proxy.ip}:{proxy.port}</span></div>
              <div className="kv-row"><span className="kv-label">Registered</span><span className="kv-val">{fmtAdminStamp(proxy.registeredAt)}</span></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Current assignment</span></div>
            <div className="panel-body">
              {activeAssignment ? (
                <>
                  <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val"><Link href={`/admin/orders/${activeAssignment.order.id}`} className="mono td-link">{activeAssignment.order.id}</Link></span></div>
                  <div className="kv-row"><span className="kv-label">Client</span><span className="kv-val"><Link href={`/admin/clients/${activeAssignment.order.client.id}`} className="mono td-link">{activeAssignment.order.client.id}</Link></span></div>
                  <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{activeAssignment.order.plan.name}</span></div>
                  <div className="kv-row"><span className="kv-label">Assigned</span><span className="kv-val">{fmtAdminStamp(activeAssignment.assignedAt)}</span></div>
                  <div className="kv-row"><span className="kv-label">Expires with order</span><span className="kv-val">{fmtAdminStamp(activeAssignment.order.expiresAt)}</span></div>
                </>
              ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>No current assignment — proxy is in pool.</div>}
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header"><span className="panel-title">Assignment history</span></div>
          <table className="table">
            <thead><tr><th>Assignment</th><th>Order</th><th>Client</th><th>Assigned</th><th>Released</th><th>Reason</th></tr></thead>
            <tbody>
              {proxy.assignments.length === 0
                ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No history yet.</div></div></td></tr>
                : proxy.assignments.map(a => (
                  <tr key={a.id}>
                    <td className="mono">{a.id}</td>
                    <td><Link href={`/admin/orders/${a.order.id}`} className="mono td-link">{a.order.id}</Link></td>
                    <td><Link href={`/admin/clients/${a.order.client.id}`} className="mono td-link">{a.order.client.id}</Link></td>
                    <td>{fmtAdminStamp(a.assignedAt)}</td>
                    <td>{fmtAdminStamp(a.releasedAt)}</td>
                    <td>{a.reasonDetail ?? (a.reason?.toLowerCase().replace(/_/g, ' ') ?? '—')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16, alignItems: 'start' }}>

          <EntityNotesPanel objectType="PROXY" objectId={proxy.id} />

          <EntityActivityWidget objectType="PROXY" objectId={proxy.id} />
        </div>
      </main>
    </>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{value}</div>
    </div>
  );
}
