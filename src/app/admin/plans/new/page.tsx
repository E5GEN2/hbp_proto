import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { PlanForm } from '@/components/admin/PlanForm';

export const dynamic = 'force-dynamic';

export default async function AdminCreatePlanPage() {
  const catalog = await loadCatalog();
  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Plans', href: '/admin/plans' },
        { label: 'New plan' },
      ]} />
      <main style={{ padding: 24, overflowY: 'auto', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ marginBottom: 8 }}>
          <span className="chip muted">Draft · not yet published</span>
        </div>
        <PlanForm mode="create" initial={{}} catalog={catalog} />
      </main>
    </>
  );
}

async function loadCatalog() {
  const items = await prisma.catalogItem.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] });
  const group = (kind: string) => items.filter(i => i.kind === kind).map(i => ({ value: i.value }));
  return {
    carriers: group('CARRIER'),
    regions: group('REGION'),
    pools: group('POOL'),
    protocols: group('PROTOCOL'),
    rotations: group('ROTATION'),
    traffic: group('TRAFFIC'),
    durations: group('DURATION'),
    currencies: group('CURRENCY'),
  };
}
