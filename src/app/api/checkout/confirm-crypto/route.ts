import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextInvoiceId, nextAssignmentId } from '@/lib/id';
import { fmtDate } from '@/lib/date';

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

  // Idempotency: this endpoint is client-triggered — a repeat POST (double-click,
  // replay) must not re-assign proxies or re-extend. No AWAITING payment left
  // on the order → nothing to confirm.
  const awaitingPay = order.payments.find(p => p.status === 'AWAITING');
  if (!awaitingPay) {
    return NextResponse.json({ ok: true, already: true });
  }

  const now = new Date();

  // ── Renewal confirmation: the order itself is already settled (paymentStatus
  //    PAID/…) and the AWAITING row is a renewal charge from /place?renewOf.
  //    Confirming it EXTENDS the original order — no proxy assignment (B-2).
  if (order.paymentStatus !== 'AWAITING') {
    const base = order.expiresAt && order.expiresAt > now ? order.expiresAt : now;
    const newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);
    await prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: awaitingPay.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: awaitingPay.id, orderId: order.id, clientId: order.clientId, amount: Number(awaitingPay.gross) },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          expiresAt: newExpiry,
          status: order.status === 'EXPIRED' ? 'ACTIVE' : order.status,
          renewalBucket: 'RENEWED',
          lastReminderAt: null,
          exception: order.exception === 'RENEWAL_NOT_EXTENDED' ? null : order.exception,
        },
      });
      await tx.log.create({
        data: {
          actorId: order.clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: awaitingPay.id,
          detail: `Crypto renewal payment confirmed for ${order.id} — extended to ${newExpiry.toISOString().slice(0, 10)}`,
        },
      });
      await tx.notification.create({
        data: {
          id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: order.clientId,
          title: `Order ${order.id} renewed — new expiry ${fmtDate(newExpiry)}`,
          kind: 'SUCCESS', link: `/orders/${order.id}`,
        },
      });
    });
    return NextResponse.json({ ok: true, renewed: true });
  }

  const wantsAutoProvision = order.plan.autoProvision;

  await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: awaitingPay.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
    {
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: awaitingPay.id, orderId: order.id, clientId: order.clientId, amount: Number(order.amount) },
      });
    }

    // Try to assign proxies first
    let assignedCount = 0;
    if (wantsAutoProvision) {
      const candidates = await tx.proxy.findMany({
        where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY' },
        take: order.qty,
      });
      for (const p of candidates) {
        const aid = await nextAssignmentId();
        await tx.assignment.create({ data: { id: aid, orderId: order.id, proxyId: p.id, actorId: 'ADM-SYS', assignedAt: now } });
        await tx.proxy.update({ where: { id: p.id }, data: { status: 'ASSIGNED', currentOrderId: order.id } });
        assignedCount++;
      }
    }

    const fullyAssigned = assignedCount >= order.qty;
    const finalStatus =
      wantsAutoProvision && fullyAssigned ? 'ACTIVE' as const
      : 'PROVISIONING' as const;
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    const finalExpires = finalStatus === 'ACTIVE' ? new Date(now.getTime() + order.plan.durationDays * 86_400_000) : null;
    const finalException = wantsAutoProvision && !fullyAssigned ? 'PAID_NOT_PROVISIONED' as const : null;

    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: finalStatus,
        activatedAt: finalActivated,
        expiresAt: finalExpires,
        credentialsSentAt: finalActivated,
        credentialsChannel: null,
        exception: finalException,
        excInfo: finalException ? `Pool exhausted — ${assignedCount}/${order.qty} provisioned` : null,
      },
    });

    await tx.log.create({
      data: {
        actorId: order.clientId,
        action: 'PAYMENT.CONFIRM',
        objectType: 'PAYMENT',
        objectId: awaitingPay.id,
        detail: `Crypto payment confirmed for ${order.id} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
