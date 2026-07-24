import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { VerifyCard } from './VerifyCard';

// Email-verification gate (owner revision 2026-07-22, items 2-3). Two entry
// modes: (a) the fresh registrant lands here in-session and types the 6-digit
// code; (b) the magic link opens here with ?token= — that works even in a
// different browser (the token itself proves mailbox ownership).
// ?return= carries the purchase intent (Buy now → checkout) through the gate.

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ searchParams }: { searchParams: { token?: string; return?: string } }) {
  const session = await getServerSession(authOptions);
  // Only same-site paths — a foreign URL in ?return would be an open redirect.
  const ret = searchParams.return && searchParams.return.startsWith('/') && !searchParams.return.startsWith('//')
    ? searchParams.return
    : '/dashboard';
  const token = searchParams.token ?? null;

  if (!token) {
    if (!session) redirect('/login');
    if (session.user.role !== 'CLIENT' || session.user.emailVerified) redirect(ret);
  }

  return (
    <VerifyCard
      email={session?.user.email ?? null}
      token={token}
      ret={ret}
      hasSession={!!session}
      alreadyVerified={!!session?.user.emailVerified}
    />
  );
}
