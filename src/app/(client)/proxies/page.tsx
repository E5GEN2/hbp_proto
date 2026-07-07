import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ProxiesList, type ProxyRow } from '@/components/client/ProxiesList';

export default async function ClientProxiesPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const assignments = await prisma.assignment.findMany({
    // A SUSPENDED order withdraws client access — its proxy credentials must
    // not appear anywhere in the portal (product decision 2026-07-07). Covers
    // both suspend paths (single-order Suspend + block-with-suspend) via
    // order.status, so it holds even where assignment.suspendedAt isn't stamped.
    where: { order: { clientId: userId, status: { not: 'SUSPENDED' } }, releasedAt: null },
    include: { proxy: true, order: true },
  });

  const rows: ProxyRow[] = assignments
    .map(a => ({
      id: a.proxy.id,
      orderId: a.order.id,
      carrier: a.proxy.carrier,
      region: a.proxy.region,
      autoRotateMin: a.proxy.autoRotateMin,
      uptime: a.proxy.uptime,
      speedMbps: a.proxy.speedMbps,
      health: a.proxy.health.toLowerCase() as ProxyRow['health'],
      ip: a.proxy.ip,
      port: a.proxy.port,
      username: a.proxy.username,
      password: a.proxy.password,
    }))
    .sort((x, y) => x.id.localeCompare(y.id));

  return (
    <>
      <ClientTopbar title="Proxies" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Proxies</span>
            </div>
            <ProxiesList rows={rows} />
          </div>
        </div>
      </main>
    </>
  );
}
