import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextOrderId, nextPaymentId, nextInvoiceId, nextAssignmentId } from '@/lib/id';
import { mockPaymentsAllowed, newOrdersFrozen, enabledProviders } from '@/lib/runtime-flags';
import { renewalUnitPrice } from '@/lib/renewal';
import { fmtDate } from '@/lib/date';

const Schema = z.object({
  planId: z.string(),
  qty: z.number().int().min(1).max(100),
  autoExtend: z.boolean(),
  paymentMethod: z.enum(['balance', 'crypto', 'card']),
  renewOf: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Bad input' }, { status: 400 });
  const { planId, qty, autoExtend, paymentMethod, renewOf } = parse.data;

  if (paymentMethod === 'card' && !mockPaymentsAllowed()) {
    return NextResponse.json({ error: 'Card payments are not available yet — use balance or crypto.' }, { status: 400 });
  }

  // Admin provider toggles (Settings → Payment Providers) gate NEW charges,
  // renewals included; balance is internal and always available (audit B-4).
  const providers = await enabledProviders();
  if (paymentMethod === 'card' && !providers.stripe) {
    return NextResponse.json({ error: 'Card payments are currently disabled — use balance or crypto.' }, { status: 400 });
  }
  if (paymentMethod === 'crypto' && !providers.crypto) {
    return NextResponse.json({ error: 'Crypto payments are currently disabled — use balance or card.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Renewal: the payment EXTENDS the original order — no new order, no new
  //    proxies (audit B-2 / LIFECYCLE_CONTRACT l.82). Terms come from the
  //    original order server-side; freeze applies to NEW orders only.
  if (renewOf) {
    return handleRenewal({ renewOf, userId, userBalance: Number(user.balance), paymentMethod });
  }

  if (await newOrdersFrozen()) {
    return NextResponse.json({ error: 'Ordering is temporarily paused — please try again later.' }, { status: 403 });
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || plan.deletedAt) return NextResponse.json({ error: 'Plan unavailable' }, { status: 400 });

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
        // Fees only where a processor charges them — balance payments carry none
        fees: paymentMethod === 'card' ? total * 0.03 : 0,
        net: paymentMethod === 'card' ? total * 0.97 : total,
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
        // credentialsSentAt = credentials made available in the portal; no email
        // pipeline exists yet, so no channel is claimed (DECISIONS.md §9)
        credentialsSentAt: finalCredsSent,
        credentialsChannel: null,
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

// Renewal branch. Instant methods (balance/card) extend immediately; crypto
// creates an AWAITING payment on the original order and the extension happens
// in /api/checkout/confirm-crypto once the client confirms.
async function handleRenewal({ renewOf, userId, userBalance, paymentMethod }: {
  renewOf: string;
  userId: string;
  userBalance: number;
  paymentMethod: 'balance' | 'crypto' | 'card';
}) {
  const order = await prisma.order.findUnique({ where: { id: renewOf }, include: { plan: true } });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.status === 'CANCELLED' || order.status === 'PENDING_RENEWAL') {
    return NextResponse.json({ error: 'This order cannot be renewed' }, { status: 400 });
  }
  if (!order.plan.renewalAllowed) {
    return NextResponse.json({ error: 'Renewals are not available for this plan' }, { status: 400 });
  }
  // One pending renewal payment at a time — a second POST while crypto is
  // awaiting confirmation must not stack another charge.
  const pending = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING' } });
  if (pending) {
    return NextResponse.json({ error: `A renewal payment (${pending.id}) is already awaiting confirmation.` }, { status: 409 });
  }

  // Renewal discount (audit B-6) — same helper as the client UI and the
  // one-click balance renewal, so all three surfaces agree to the cent.
  const total = renewalUnitPrice(Number(order.plan.price), order.plan.renewalDiscountPct) * order.qty;
  const isInstant = paymentMethod === 'balance' || paymentMethod === 'card';
  if (paymentMethod === 'balance' && userBalance < total) {
    return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
  }

  const paymentId = await nextPaymentId();
  const now = new Date();

  await prisma.$transaction(async tx => {
    await tx.payment.create({
      data: {
        id: paymentId,
        orderId: order.id,
        clientId: userId,
        provider: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? 'CoinPayments' : 'Stripe',
        method: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? 'USDT-TRC20' : 'Visa •• 4242',
        gross: total,
        fees: paymentMethod === 'card' ? total * 0.03 : 0,
        net: paymentMethod === 'card' ? total * 0.97 : total,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
      },
    });

    if (!isInstant) {
      await tx.log.create({
        data: {
          actorId: userId, action: 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: paymentId,
          detail: `Renewal payment for ${order.id} awaiting crypto confirmation · $${total.toFixed(2)}`,
        },
      });
      return;
    }

    const invoiceId = await nextInvoiceId();
    await tx.invoice.create({ data: { id: invoiceId, paymentId, orderId: order.id, clientId: userId, amount: total } });
    if (paymentMethod === 'balance') {
      const newBal = userBalance - total;
      await tx.user.update({ where: { id: userId }, data: { balance: newBal } });
      await tx.balanceLedgerEntry.create({
        data: { userId, op: 'ORDER_DEBIT', amount: -total, balanceAfter: newBal, refOrderId: order.id, refPaymentId: paymentId, note: `Renewal of ${order.id}` },
      });
    }

    const base = order.expiresAt && order.expiresAt > now ? order.expiresAt : now;
    const newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);
    await tx.order.update({
      where: { id: order.id },
      data: {
        expiresAt: newExpiry,
        status: order.status === 'EXPIRED' ? 'ACTIVE' : order.status,
        activatedAt: order.activatedAt ?? now,
        renewalBucket: 'RENEWED',
        lastReminderAt: null,
        exception: order.exception === 'RENEWAL_NOT_EXTENDED' ? null : order.exception,
      },
    });

    await tx.log.create({
      data: {
        actorId: userId, action: 'ORDER.EXTEND', objectType: 'ORDER', objectId: order.id,
        detail: `Renewed via checkout · ${paymentMethod} · $${total.toFixed(2)} · new expiry ${newExpiry.toISOString().slice(0, 10)}`,
      },
    });
    await tx.notification.create({
      data: {
        id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId,
        title: `Order ${order.id} renewed — new expiry ${fmtDate(newExpiry)}`,
        kind: 'SUCCESS', link: `/orders/${order.id}`,
      },
    });
  });

  return NextResponse.json({ ok: true, orderId: order.id, renewed: isInstant });
}
