import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { nextUserId } from '@/lib/id';

const Schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parse = Schema.safeParse(json);
  if (!parse.success) {
    return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { name, email, password } = parse.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const id = await nextUserId();
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: { id, name, email, passwordHash, role: 'CLIENT', balance: 0 },
  });

  // Seed locked balance payment method
  await prisma.paymentMethod.create({
    data: {
      id: `pm_balance_${id.toLowerCase()}`,
      userId: id,
      kind: 'BALANCE',
      brand: 'Account balance',
      locked: true,
    },
  });

  return NextResponse.json({ ok: true, userId: id });
}
