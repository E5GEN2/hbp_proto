import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { appUrl } from '@/lib/app-url';
import { emailEnabled, sendEmail, passwordResetEmail } from '@/lib/email';

const Schema = z.object({ email: z.string().email().toLowerCase() });

const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_REQUESTS_PER_HOUR = 3;

export async function POST(req: Request) {
  // Without a mail key there is no way to deliver the link — say so instead
  // of a fake "email sent" dead-end.
  if (!emailEnabled()) {
    return NextResponse.json(
      { error: 'Password reset by email is temporarily unavailable — please contact support on Telegram.' },
      { status: 503 },
    );
  }

  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  const { email } = parse.data;

  // Same response whether or not the account exists — no user enumeration.
  const generic = NextResponse.json({ ok: true });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status === 'BLOCKED') return generic;

  const recent = await prisma.passwordResetToken.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_REQUESTS_PER_HOUR) return generic;

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  const link = appUrl(`/reset?token=${token}`);
  const sent = await sendEmail({ to: user.email, ...passwordResetEmail(link) });
  if (sent) {
    await prisma.log.create({
      data: {
        actorId: user.id, action: 'AUTH.RESET_REQUEST', objectType: 'AUTH', objectId: user.id,
        detail: 'Password reset email sent',
      },
    });
  }

  return generic;
}
