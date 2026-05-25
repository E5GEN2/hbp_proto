import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';

export default async function RootPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/marketing');
  if (isAdminRole(session.user.role)) redirect('/admin');
  redirect('/dashboard');
}
