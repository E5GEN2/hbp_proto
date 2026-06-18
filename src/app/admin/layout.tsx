import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminSidebar } from '@/components/admin/Sidebar';
import { AdminOrderOptionsProvider } from '@/components/admin/shell/NewOrderContext';

// All admin pages need the DB at request time, never at build time
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login?return=/admin');
  if (!isAdminRole(session.user.role)) redirect('/dashboard');

  // Read-only: NEW-orders badge + options for the global New Order modal
  // (canon's topbar New Order is available on every admin page).
  const [newOrdersCount, allClients, allPlans, allocRows] = await Promise.all([
    prisma.order.count({ where: { status: 'NEW' } }),
    prisma.user.findMany({
      where: { role: 'CLIENT', status: { not: 'BLOCKED' } },
      select: { id: true, name: true, email: true, balance: true },
      orderBy: { name: 'asc' }, take: 200,
    }),
    prisma.plan.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.order.groupBy({
      by: ['planId'],
      where: { status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
      _sum: { qty: true },
    }),
  ]);

  const allocByPlan = new Map(allocRows.map(a => [a.planId, a._sum.qty ?? 0]));
  const clientOpts = allClients.map(c => ({ id: c.id, name: c.name, email: c.email, balance: Number(c.balance) }));
  const planOpts = allPlans.map(p => ({
    id: p.id, name: p.name, price: Number(p.price), durationDays: p.durationDays,
    carrier: p.carrier, region: p.region,
    available: Math.max(0, p.availableQuota - (allocByPlan.get(p.id) ?? 0)),
  }));

  const me = { name: session.user.name ?? '—', email: session.user.email ?? '', role: session.user.role };
  const badges = { '/admin/orders': newOrdersCount };

  return (
    <div className="theme-admin" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex' }}>
      <AdminSidebar user={me} badges={badges} />
      <AdminOrderOptionsProvider value={{ clients: clientOpts, plans: planOpts }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </AdminOrderOptionsProvider>
    </div>
  );
}
