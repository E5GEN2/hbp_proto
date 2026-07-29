import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Poll target for the in-portal pay panel. Reads OUR payment row only — the
// IPN webhook is the sole writer (settlement + npStatus mirror), so this
// endpoint never talks to NOWPayments and can be polled cheaply.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Uniform with the sibling payment routes (defense-in-depth; ownership scope
  // below is the load-bearing check).
  if (!session.user.emailVerified) return NextResponse.json({ error: 'Verify your email to continue' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id.startsWith('PAY-')) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const p = await prisma.payment.findUnique({
    where: { id },
    select: { clientId: true, status: true, npStatus: true, orderId: true },
  });
  // Own payments only — 404 for both "missing" and "not yours" (no oracle).
  if (!p || p.clientId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ status: p.status, npStatus: p.npStatus, orderId: p.orderId });
}
