import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextInvoiceId, nextAssignmentId } from '@/lib/id';

const Schema = z.object({ orderId: z.string() });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'Bad input' }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: parse.data.orderId },
    include: { plan: true, payments: true },
  });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.clientId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const awaitingPay = order.payments.find(p => p.status === 'AWAITING');
  const now = new Date();
  const willActivate = order.plan.autoProvision;
  const expiresAt = willActivate ? new Date(now.getTime() + order.plan.durationDays * 86_400_000) : null;

  await prisma.$transaction(async tx => {
    if (awaitingPay) {
      await tx.payment.update({ where: { id: awaitingPay.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: awaitingPay.id, orderId: order.id, clientId: order.clientId, amount: Number(order.amount) },
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: willActivate ? 'ACTIVE' : 'PROVISIONING',
        activatedAt: willActivate ? now : null,
        expiresAt,
        credentialsSentAt: willActivate ? now : null,
        credentialsChannel: willActivate ? 'EMAIL' : null,
      },
    });

    if (willActivate) {
      const need = order.qty;
      const candidates = await tx.proxy.findMany({
        where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY' },
        take: need,
      });
      for (const p of candidates) {
        const aid = await nextAssignmentId();
        await tx.assignment.create({ data: { id: aid, orderId: order.id, proxyId: p.id, actorId: 'ADM-SYS', assignedAt: now } });
        await tx.proxy.update({ where: { id: p.id }, data: { status: 'ASSIGNED', currentOrderId: order.id } });
      }
    }

    await tx.log.create({
      data: {
        actorId: order.clientId,
        action: 'PAYMENT.CONFIRM',
        objectType: 'PAYMENT',
        objectId: awaitingPay?.id ?? null,
        detail: `Crypto payment confirmed for order ${order.id}`,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
