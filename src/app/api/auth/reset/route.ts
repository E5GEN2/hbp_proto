import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const Schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export async function POST(req: Request) {
  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) {
    return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { token, password } = parse.data;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt < new Date() || row.user.status === 'BLOCKED') {
    return NextResponse.json(
      { error: 'This reset link is invalid or has expired. Request a new one.' },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // Any other outstanding links die with this one.
    prisma.passwordResetToken.deleteMany({ where: { userId: row.userId, usedAt: null } }),
    prisma.log.create({
      data: {
        actorId: row.userId, action: 'AUTH.PASSWORD_RESET', objectType: 'AUTH', objectId: row.userId,
        detail: 'Password reset via email link',
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
