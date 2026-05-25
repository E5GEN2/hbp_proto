import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { TogglePlanButton } from '@/components/admin/ActionButtons';

export default async function AdminPlansPage() {
  const plans = await prisma.plan.findMany({ where: { deletedAt: null }, orderBy: { durationDays: 'asc' } });
  const allocations = await prisma.order.groupBy({
    by: ['planId'],
    where: { status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    _sum: { qty: true },
  });
  const allocMap = new Map(allocations.map(a => [a.planId, a._sum.qty ?? 0]));

  return (
    <>
      <AdminTopbar title="Plans" action={<Link className="btn primary" href="/admin/plans/new">+ Create plan</Link>} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Plan</th><th>Carrier</th><th>Region</th><th>Pool</th><th>Duration</th><th>Price</th><th>Quota</th><th>Allocated</th><th>Available</th><th>Status</th><th>Visibility</th><th>Actions</th></tr></thead>
            <tbody>
              {plans.map(p => {
                const allocated = allocMap.get(p.id) ?? 0;
                const avail = Math.max(0, p.availableQuota - allocated);
                const state = avail === 0 && p.availableQuota > 0 ? 'sold-out' : (avail / Math.max(p.availableQuota, 1) < 0.15 ? 'low' : 'available');
                return (
                  <tr key={p.id}>
                    <td><Link href={`/admin/plans/${p.id}`} className="td-link">{p.name}</Link></td>
                    <td>{p.carrier}</td>
                    <td>{p.region}</td>
                    <td>{p.pool}</td>
                    <td className="mono">{p.durationDays} days</td>
                    <td className="mono">{money(Number(p.price))}</td>
                    <td className="mono">{p.availableQuota}</td>
                    <td className="mono">{allocated}</td>
                    <td className="mono">{avail} <span className={`chip ${state === 'low' || state === 'sold-out' ? state.replace('-','') : 'muted'} sm`} style={{ marginLeft: 6 }}>{state}</span></td>
                    <td><span className={`chip ${p.active ? 'success' : 'muted'}`}>{p.active ? 'Active' : 'Disabled'}</span></td>
                    <td><span className={`chip ${p.visibility === 'PUBLIC' ? 'muted' : 'info'}`}>{p.visibility.toLowerCase()}</span></td>
                    <td><TogglePlanButton planId={p.id} active={p.active} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
