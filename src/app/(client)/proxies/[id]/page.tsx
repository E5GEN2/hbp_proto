import Link from 'next/link';
import { planDisplayName } from '@/lib/catalog';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ClientProxyHeaderActions } from '@/components/client/ProxyDetailActions';
import { CredentialsBlock } from '@/components/client/CredentialsBlock';
import { WhitelistPanel } from '@/components/client/WhitelistPanel';
import { RotationUrlPanel } from '@/components/client/RotationUrlPanel';
import { ProxyLabelEdit } from '@/components/client/ProxyLabelEdit';
import { AutoRotationPicker } from '@/components/client/AutoRotationPicker';
import { fmtAdminStamp, daysLeft, fmtRel } from '@/lib/date';

const cap = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

export default async function ClientProxyDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const proxy = await prisma.proxy.findUnique({
    where: { id: params.id },
    include: {
      // Exclude SUSPENDED orders — a suspended proxy is hidden from the client
      // (creds withdrawn); direct URL access then 404s via the guard below.
      assignments: { where: { releasedAt: null, order: { status: { not: 'SUSPENDED' } } }, include: { order: { include: { plan: true, client: true } } }, take: 1 },
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
      <ClientTopbar breadcrumb={[{ label: 'Proxies', href: '/proxies' }, { label: `Proxy ${proxy.id}` }]} balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="detail-header">
            <div className="detail-header-left">
              <div className="detail-id">{proxy.id}</div>
              <div className="detail-chips">
                {proxy.status === 'MAINTENANCE'
                  ? <span className="chip maintenance">Maintenance</span>
                  : <span className={`chip ${proxy.health.toLowerCase()}`}>{cap(proxy.health)}</span>}
                {proxy.label && <span className="chip accent">{proxy.label}</span>}
              </div>
            </div>
            <div className="detail-actions">
              <ClientProxyHeaderActions
                proxyId={proxy.id}
                health={proxy.health}
                creds={{ ip: proxy.ip, port: proxy.port, username: proxy.username, password: proxy.password }}
              />
            </div>
          </div>

          <div className="grid-detail">
            <div className="grid-left">
              <CredentialsBlock proxies={[{
                id: proxy.id,
                ip: proxy.ip, port: proxy.port,
                username: proxy.username, password: proxy.password,
                carrier: proxy.carrier, region: proxy.region,
              }]} />
              <RotationUrlPanel rotationUrl={proxy.rotationUrl} />
              <WhitelistPanel proxyId={proxy.id} entries={proxy.whitelist.map(w => ({ id: w.id, ip: w.ip }))} />
            </div>

            <div className="grid-right">
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Info</span></div>
                <div className="panel-body">
                  <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val"><Link href={`/orders/${myAssignment.order.id}`} className="mono td-link">{myAssignment.order.id}</Link></span></div>
                  <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{planDisplayName(myAssignment.order.plan.durationDays)}</span></div>
                  <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{proxy.carrier} · {proxy.region}</span></div>
                  <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val mono">{fmtAdminStamp(myAssignment.order.expiresAt)}{d != null && d > 0 ? ` · ${d}d left` : ''}</span></div>
                  <div className="kv-row" style={{ alignItems: 'center' }}>
                    <span className="kv-label">Auto rotation</span>
                    <span className="kv-val"><AutoRotationPicker proxyId={proxy.id} current={proxy.autoRotateMin} /></span>
                  </div>
                  <div className="kv-row"><span className="kv-label">Last rotated</span><span className="kv-val mono">{proxy.lastRotated ? fmtRel(proxy.lastRotated) : 'Never'}</span></div>
                  <div className="kv-row"><span className="kv-label">Uptime · Latency</span><span className="kv-val mono">{proxy.uptime.toFixed(1)}%{proxy.latency != null ? ` · ${proxy.latency} ms` : ''}</span></div>
                  <div className="kv-row kv-row-stack">
                    <span className="kv-label">Label</span>
                    <ProxyLabelEdit proxyId={proxy.id} current={proxy.label} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
