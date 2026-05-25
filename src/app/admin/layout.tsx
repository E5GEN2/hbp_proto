import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminSidebar } from '@/components/admin/Sidebar';

// All admin pages need the DB at request time, never at build time
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login?return=/admin');
  if (!isAdminRole(session.user.role)) redirect('/dashboard');

  const newOrdersCount = await prisma.order.count({ where: { status: 'NEW' } });

  const me = { name: session.user.name ?? '—', email: session.user.email ?? '' };
  const badges = { '/admin/orders': newOrdersCount };

  return (
    <div className="theme-admin" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex' }}>
      <AdminSidebar user={me} badges={badges} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
