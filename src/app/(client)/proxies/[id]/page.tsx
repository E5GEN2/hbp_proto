import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ClientProxyRequestReplacement } from '@/components/client/ProxyDetailActions';

export default async function ClientProxyDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const proxy = await prisma.proxy.findUnique({
    where: { id: params.id },
    include: {
      assignments: { where: { releasedAt: null }, include: { order: { include: { plan: true, client: true } } }, take: 1 },
      whitelist: true,
    },
  });
  if (!proxy) notFound();
  const myAssignment = proxy.assignments[0];
  if (!myAssignment || myAssignment.order.clientId !== session!.user.id) notFound();
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });

  return (
    <>
      <ClientTopbar title="Proxy detail" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{proxy.id}</h2>
          <span className={`chip ${proxy.health.toLowerCase()}`}>{proxy.health.toLowerCase()}</span>
          <div style={{ flex: 1 }} />
          <ClientProxyRequestReplacement proxyId={proxy.id} health={proxy.health} />
          <button className="btn">Copy credentials</button>
          <button className="btn">Rotate IP</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Credentials</span></div>
            <div className="panel-body">
              <pre className="mono" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 8, fontSize: 12, margin: 0 }}>
{proxy.ip}:{proxy.port}:{proxy.username}:{proxy.password}
              </pre>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Info</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val"><Link href={`/orders/${myAssignment.order.id}`} className="mono td-link">{myAssignment.order.id}</Link></span></div>
              <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{myAssignment.order.plan.name}</span></div>
              <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{proxy.carrier} · {proxy.region}</span></div>
              <div className="kv-row"><span className="kv-label">Auto rotation</span><span className="kv-val">{proxy.autoRotateMin ? `${proxy.autoRotateMin} min` : '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Uptime · Latency</span><span className="kv-val">{proxy.uptime.toFixed(1)}% · {proxy.latency ?? '—'}ms</span></div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
