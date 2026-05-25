import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientSidebar } from '@/components/client/Sidebar';

// All client pages need session + DB at request time
export const dynamic = 'force-dynamic';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (isAdminRole(session.user.role)) redirect('/admin');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, tier: true, balance: true },
  });
  if (!me) redirect('/login');

  return (
    <div className="theme-client" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex' }}>
      <ClientSidebar user={{ name: me.name, email: me.email, tier: me.tier }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
