import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ClientProxyRequestReplacement } from '@/components/client/ProxyDetailActions';
import { CredentialsBlock } from '@/components/client/CredentialsBlock';
import { WhitelistPanel } from '@/components/client/WhitelistPanel';
import { RotationUrlPanel } from '@/components/client/RotationUrlPanel';
import { ProxyLabelEdit } from '@/components/client/ProxyLabelEdit';
import { Stage15Pill } from '@/components/ui/Stage15Badge';
import { fmtDate, daysLeft, fmtRel } from '@/lib/date';

export default async function ClientProxyDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const proxy = await prisma.proxy.findUnique({
    where: { id: params.id },
    include: {
      assignments: { where: { releasedAt: null }, include: { order: { include: { plan: true, client: true } } }, take: 1 },
      whitelist: { orderBy: { addedAt: 'asc' } },
    },
  });
  if (!proxy) notFound();
  const myAssignment = proxy.assignments[0];
  if (!myAssignment || myAssignment.order.clientId !== session!.user.id) notFound();
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const d = daysLeft(myAssignment.order.expiresAt);

  return (
    <>
      <ClientTopbar title="Proxy detail" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{proxy.id}</h2>
          <span className={`chip ${proxy.health.toLowerCase()}`}>{proxy.health.toLowerCase()}</span>
          {proxy.label && <span className="chip muted">{proxy.label}</span>}
          <div style={{ flex: 1 }} />
          <ClientProxyRequestReplacement proxyId={proxy.id} health={proxy.health} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CredentialsBlock proxies={[{
              id: proxy.id,
              ip: proxy.ip, port: proxy.port,
              username: proxy.username, password: proxy.password,
              rotateToken: proxy.rotateToken,
            }]} />
            <RotationUrlPanel rotateToken={proxy.rotateToken} proxyId={proxy.id} />
            <WhitelistPanel proxyId={proxy.id} entries={proxy.whitelist.map(w => ({ id: w.id, ip: w.ip }))} />
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Info</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val"><Link href={`/orders/${myAssignment.order.id}`} className="mono td-link">{myAssignment.order.id}</Link></span></div>
              <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{myAssignment.order.plan.name}</span></div>
              <div className="kv-row"><span className="kv-label">Region</span><span className="kv-val">{proxy.region}</span></div>
              <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val">{fmtDate(myAssignment.order.expiresAt)}{d && d > 0 ? ` (${d}d)` : ''}</span></div>
              <div className="kv-row"><span className="kv-label">Auto rotation <Stage15Pill /></span><span className="kv-val">{proxy.autoRotateMin ? `${proxy.autoRotateMin} min` : '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Last rotated</span><span className="kv-val">{proxy.lastRotated ? fmtRel(proxy.lastRotated) : '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Uptime · Latency</span><span className="kv-val">{proxy.uptime.toFixed(1)}% · {proxy.latency ?? '—'}ms</span></div>
              <div style={{ marginTop: 12 }}>
                <label className="form-label">Label</label>
                <ProxyLabelEdit proxyId={proxy.id} current={proxy.label} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
