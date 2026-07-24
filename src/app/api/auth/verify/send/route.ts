// Resend the email-verification challenge for the SIGNED-IN unverified client.
// Issue-side throttles: in-memory per-IP bucket (cheap first layer) + DB count
// per user (3/hour — survives redeploys), mirroring /api/auth/forgot.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emailEnabled } from '@/lib/email';
import { clientIp, hitRateLimit } from '@/lib/rate-limit';
import { issueVerification } from '@/lib/email-verification';

const RESEND_LIMIT = 5; // per IP per 10 minutes
const RESEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_ISSUES_PER_HOUR = 3; // per user, DB-counted

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.emailVerified) return NextResponse.json({ ok: true, already: true });

  if (!emailEnabled()) {
    return NextResponse.json(
      { error: 'Verification email is temporarily unavailable — please contact support on Telegram.' },
      { status: 503 },
    );
  }

  const wait = hitRateLimit(`verify:resend:${clientIp(req)}`, RESEND_LIMIT, RESEND_WINDOW_MS);
  if (wait) {
    return NextResponse.json(
      { error: 'Too many requests — please try again later.' },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    );
  }
  const recent = await prisma.emailVerificationToken.count({
    where: { userId: session.user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_ISSUES_PER_HOUR) {
    return NextResponse.json(
      { error: 'Too many codes requested — please try again in an hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  const sent = await issueVerification(session.user.id, session.user.email);
  if (!sent) {
    return NextResponse.json({ error: 'Could not send the email — please try again.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
