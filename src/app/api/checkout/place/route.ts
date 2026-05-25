import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextOrderId, nextPaymentId, nextInvoiceId, nextProxyId, nextAssignmentId } from '@/lib/id';

const Schema = z.object({
  planId: z.string(),
  qty: z.number().int().min(1).max(100),
  autoExtend: z.boolean(),
  paymentMethod: z.enum(['balance', 'crypto', 'card']),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Bad input' }, { status: 400 });
  const { planId, qty, autoExtend, paymentMethod } = parse.data;

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || plan.deletedAt) return NextResponse.json({ error: 'Plan unavailable' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const unitPrice = Number(plan.price);
  const total = unitPrice * qty;

  // Check capacity
  const alloc = await prisma.order.aggregate({
    _sum: { qty: true },
    where: { planId, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
  });
  if (plan.availableQuota - (alloc._sum.qty ?? 0) < qty) {
    return NextResponse.json({ error: 'Capacity unavailable for requested quantity' }, { status: 400 });
  }

  if (paymentMethod === 'balance' && Number(user.balance) < total) {
    return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
  }

  const orderId = await nextOrderId();
  const paymentId = await nextPaymentId();

  const isInstant = paymentMethod === 'balance' || paymentMethod === 'card';
  const willActivate = isInstant && plan.autoProvision;

  const now = new Date();
  const expiresAt = willActivate ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;

  await prisma.$transaction(async tx => {
    await tx.order.create({
      data: {
        id: orderId,
        clientId: userId,
        planId: plan.id,
        qty, unitPrice, amount: total,
        region: plan.region,
        paymentStatus: isInstant ? 'PAID' : (paymentMethod === 'crypto' ? 'AWAITING' : 'PENDING'),
        status: willActivate ? 'ACTIVE' : (isInstant ? 'PROVISIONING' : 'NEW'),
        autoRenew: autoExtend,
        autoProvision: plan.autoProvision,
        source: 'in-portal',
        activatedAt: willActivate ? now : null,
        expiresAt,
        credentialsSentAt: willActivate ? now : null,
        credentialsChannel: willActivate ? 'EMAIL' : null,
      },
    });

    await tx.payment.create({
      data: {
        id: paymentId,
        orderId,
        clientId: userId,
        provider: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? 'CoinPayments' : 'Stripe',
        method: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? 'USDT-TRC20' : 'Visa •• 4242',
        gross: total,
        fees: isInstant ? total * 0.03 : 0,
        net: isInstant ? total * 0.97 : total,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
      },
    });

    if (isInstant) {
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId, orderId, clientId: userId, amount: total },
      });
      if (paymentMethod === 'balance') {
        const newBal = Number(user.balance) - total;
        await tx.user.update({ where: { id: userId }, data: { balance: newBal } });
        await tx.balanceLedgerEntry.create({
          data: { userId, op: 'ORDER_DEBIT', amount: total * -1, balanceAfter: newBal, refOrderId: orderId, refPaymentId: paymentId },
        });
      }
    }

    if (willActivate) {
      // Assign proxies from the matching pool
      const candidates = await tx.proxy.findMany({
        where: { carrier: plan.carrier, region: plan.region, pool: plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: qty,
      });
      if (candidates.length < qty) {
        // Try fallback: just match carrier+region
        const more = await tx.proxy.findMany({
          where: { carrier: plan.carrier, region: plan.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
          take: qty - candidates.length,
        });
        candidates.push(...more);
      }
      for (const p of candidates.slice(0, qty)) {
        const aid = await nextAssignmentId();
        await tx.assignment.create({
          data: { id: aid, orderId, proxyId: p.id, actorId: 'ADM-SYS', assignedAt: now },
        });
        await tx.proxy.update({ where: { id: p.id }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
      }
    }

    await tx.log.create({
      data: {
        actorId: userId,
        action: 'ORDER.CREATE',
        objectType: 'ORDER',
        objectId: orderId,
        detail: `Order created via client portal · ${user.name} (${user.id}) · ${paymentMethod}`,
      },
    });

    await tx.notification.create({
      data: {
        id: `n${Date.now()}`,
        userId,
        title: willActivate ? `Order ${orderId} confirmed — proxies ready` : `Order ${orderId} received`,
        kind: willActivate ? 'SUCCESS' : 'INFO',
      },
    });
  });

  return NextResponse.json({ ok: true, orderId });
}
