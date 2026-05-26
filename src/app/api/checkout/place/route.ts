import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextOrderId, nextPaymentId, nextInvoiceId, nextAssignmentId } from '@/lib/id';

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
  const wantsAutoProvision = isInstant && plan.autoProvision;

  const now = new Date();

  await prisma.$transaction(async tx => {
    // 1. Create payment first (always)
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

    // 2. Try to assign proxies if auto-provision wanted
    let assignedIds: string[] = [];
    if (wantsAutoProvision) {
      const candidates = await tx.proxy.findMany({
        where: { carrier: plan.carrier, region: plan.region, pool: plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: qty,
      });
      if (candidates.length < qty) {
        const more = await tx.proxy.findMany({
          where: { carrier: plan.carrier, region: plan.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
          take: qty - candidates.length,
        });
        candidates.push(...more);
      }
      assignedIds = candidates.slice(0, qty).map(c => c.id);
    }

    // 3. Decide final order state based on what actually happened
    //    - Not instant (crypto/awaiting) → NEW
    //    - Instant + autoProvision OFF (plan-level) → PROVISIONING (manual fulfillment)
    //    - Instant + autoProvision ON + fully assigned → ACTIVE
    //    - Instant + autoProvision ON + couldn't assign all → PROVISIONING + PAID_NOT_PROVISIONED
    const fullyAssigned = assignedIds.length >= qty;
    const finalStatus: 'NEW' | 'PROVISIONING' | 'ACTIVE' =
      !isInstant ? 'NEW'
      : !wantsAutoProvision ? 'PROVISIONING'
      : fullyAssigned ? 'ACTIVE'
      : 'PROVISIONING';
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    const finalExpires = finalStatus === 'ACTIVE' ? new Date(now.getTime() + plan.durationDays * 86_400_000) : null;
    const finalCredsSent = finalStatus === 'ACTIVE' ? now : null;
    const finalException = (wantsAutoProvision && !fullyAssigned)
      ? 'PAID_NOT_PROVISIONED' as const
      : null;
    const finalExcInfo = finalException
      ? `Pool exhausted — ${assignedIds.length}/${qty} proxies available at checkout`
      : null;

    // 4. Create the order with the correct final state
    await tx.order.create({
      data: {
        id: orderId,
        clientId: userId,
        planId: plan.id,
        qty, unitPrice, amount: total,
        region: plan.region,
        paymentStatus: isInstant ? 'PAID' : (paymentMethod === 'crypto' ? 'AWAITING' : 'PENDING'),
        status: finalStatus,
        autoRenew: autoExtend,
        autoProvision: plan.autoProvision,
        source: 'in-portal',
        activatedAt: finalActivated,
        expiresAt: finalExpires,
        credentialsSentAt: finalCredsSent,
        credentialsChannel: finalCredsSent ? 'EMAIL' : null,
        exception: finalException,
        excInfo: finalExcInfo,
      },
    });

    // 5. Persist assignments now that the order exists
    for (const pid of assignedIds) {
      const aid = await nextAssignmentId();
      await tx.assignment.create({
        data: { id: aid, orderId, proxyId: pid, actorId: 'ADM-SYS', assignedAt: now },
      });
      await tx.proxy.update({ where: { id: pid }, data: { status: 'ASSIGNED', currentOrderId: orderId } });
    }

    // 6. Invoice + balance debit (only for confirmed/paid)
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

    // 7. Audit + client notification
    await tx.log.create({
      data: {
        actorId: userId,
        action: 'ORDER.CREATE',
        objectType: 'ORDER',
        objectId: orderId,
        detail: `Order created via client portal · ${user.name} (${user.id}) · ${paymentMethod} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`,
      },
    });

    await tx.notification.create({
      data: {
        id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        title:
          finalStatus === 'ACTIVE'
            ? `Order ${orderId} activated — ${qty} ${qty === 1 ? 'proxy' : 'proxies'} ready`
            : finalException === 'PAID_NOT_PROVISIONED'
              ? `Order ${orderId} received — provisioning in progress (capacity hit)`
              : `Order ${orderId} received — fulfilment in progress`,
        kind:
          finalStatus === 'ACTIVE' ? 'SUCCESS'
          : finalException === 'PAID_NOT_PROVISIONED' ? 'WARNING'
          : 'INFO',
        link: `/orders/${orderId}`,
      },
    });
  });

  return NextResponse.json({ ok: true, orderId });
}
