import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { ProxyRegisterForm } from '@/components/admin/ProxyRegisterForm';

export const dynamic = 'force-dynamic';

export default async function AdminRegisterProxyPage() {
  const items = await prisma.catalogItem.findMany({
    where: { kind: { in: ['CARRIER', 'REGION', 'POOL'] } },
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
  });
  const catalog = {
    carriers: items.filter(i => i.kind === 'CARRIER').map(i => i.value),
    regions: items.filter(i => i.kind === 'REGION').map(i => i.value),
    pools: items.filter(i => i.kind === 'POOL').map(i => i.value),
  };
  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Proxies', href: '/admin/proxies' },
        { label: 'Register proxy' },
      ]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <ProxyRegisterForm catalog={catalog} />
      </main>
    </>
  );
}
