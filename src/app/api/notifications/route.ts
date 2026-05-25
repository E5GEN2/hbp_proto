import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const [notifs, user] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { notifLastReadAt: true, balance: true } }),
  ]);

  const lastRead = user?.notifLastReadAt ?? new Date(0);
  const unread = notifs.filter(n => n.createdAt > lastRead).length;
  return NextResponse.json({ notifs, unread, balance: Number(user?.balance ?? 0) });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await prisma.user.update({
    where: { id: session.user.id },
    data: { notifLastReadAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
