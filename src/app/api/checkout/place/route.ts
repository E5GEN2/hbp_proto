import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextOrderId, nextPaymentId, nextInvoiceId, nextAssignmentId } from '@/lib/id';
import { mockPaymentsAllowed, newOrdersFrozen, enabledProviders } from '@/lib/runtime-flags';
import { renewalUnitPrice } from '@/lib/renewal';
import { fmtDate } from '@/lib/date';
import { money } from '@/lib/money';
import { debitBalance, InsufficientBalance } from '@/lib/balance';
import { npEnabled, npCreateInvoice } from '@/lib/nowpayments';
import { reprovisionRenewedOrder } from '@/lib/transitions';
import { appUrl } from '@/lib/app-url';

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
  // Crypto needs either a real processor (NOWPayments) or the dev mock.
  if (paymentMethod === 'crypto' && !npEnabled() && !mockPaymentsAllowed()) {
    return NextResponse.json({ error: 'Crypto payments are temporarily unavailable — use balance or contact support.' }, { status: 400 });
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

  // One unpaid self-serve order per plan: a stale tab or back-button retry
  // must not stack duplicates. The client resolves it on the completion page
  // (/checkout?resume=…) — pay the existing invoice or cancel the order.
  const unpaid = await prisma.order.findFirst({
    where: { clientId: userId, planId, status: 'NEW', paymentStatus: 'AWAITING' },
    orderBy: { createdAt: 'desc' },
  });
  if (unpaid) {
    return NextResponse.json({
      error: `You already have an unpaid order (${unpaid.id}) for this plan — complete its payment or cancel it first.`,
      orderId: unpaid.id,
    }, { status: 409 });
  }

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

  // Real crypto: create the hosted NOWPayments invoice BEFORE persisting
  // anything — if the processor is down, no dangling order is left behind.
  // The IPN webhook settles by order_id = our payment id.
  let paymentUrl: string | null = null;
  let externalRef: string | null = null;
  if (paymentMethod === 'crypto' && npEnabled()) {
    try {
      const inv = await npCreateInvoice({
        amountUsd: total,
        paymentId,
        description: `Order ${orderId} — ${qty} × ${plan.name}`,
        successUrl: appUrl(`/orders/${orderId}`),
        cancelUrl: appUrl('/checkout'),
      });
      paymentUrl = inv.invoiceUrl;
      externalRef = inv.invoiceId;
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
    }
  }

  const now = new Date();

  try {
  await prisma.$transaction(async tx => {
    // 0. Authoritative capacity re-check INSIDE the transaction (audit B-5) —
    //    the pre-check above ran before the (slow) processor call, so a
    //    concurrent order could have taken the last seats in between.
    const allocNow = await tx.order.aggregate({
      _sum: { qty: true },
      where: { planId, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    if (plan.availableQuota - (allocNow._sum.qty ?? 0) < qty) {
      throw new Error('CAPACITY_EXHAUSTED');
    }

    // 1. Try to assign proxies if auto-provision wanted
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

    // 2. Decide final order state based on what actually happened
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

    // 3. Create the order with the correct final state
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

    // 4. Create the payment AFTER the order — payments.orderId carries an
    //    immediate (non-deferred) FK, so the parent row must exist first.
    await tx.payment.create({
      data: {
        id: paymentId,
        orderId,
        clientId: userId,
        provider: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? (npEnabled() ? 'NOWPayments' : 'CoinPayments') : 'Stripe',
        method: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? (npEnabled() ? 'Crypto' : 'USDT-TRC20') : 'Visa •• 4242',
        gross: total,
        // Fees only where a processor charges them — balance payments carry none
        fees: paymentMethod === 'card' ? total * 0.03 : 0,
        net: paymentMethod === 'card' ? total * 0.97 : total,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
        externalRef,
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
        // Guarded in-tx debit (P1-1): the pre-check at the top of the route
        // read the balance OUTSIDE this tx — two concurrent checkouts could
        // both pass it and double-spend.
        const newBal = await debitBalance(tx, userId, total);
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
            : `Order ${orderId} received — your proxies are being prepared`,
        kind: finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
        link: `/orders/${orderId}`,
      },
    });
  });
  } catch (e: any) {
    if (e?.message === 'CAPACITY_EXHAUSTED') {
      return NextResponse.json({ error: 'Capacity unavailable for requested quantity' }, { status: 400 });
    }
    if (e instanceof InsufficientBalance) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true, orderId, ...(paymentUrl ? { paymentUrl } : {}) });
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

  // Real crypto renewal: hosted invoice first (same contract as new orders) —
  // the IPN webhook extends the order once the transfer lands.
  let paymentUrl: string | null = null;
  let externalRef: string | null = null;
  if (paymentMethod === 'crypto' && npEnabled()) {
    try {
      const inv = await npCreateInvoice({
        amountUsd: total,
        paymentId,
        description: `Renewal of order ${order.id} — ${order.qty} × ${order.plan.name}`,
        successUrl: appUrl(`/orders/${order.id}`),
        cancelUrl: appUrl(`/orders/${order.id}`),
      });
      paymentUrl = inv.invoiceUrl;
      externalRef = inv.invoiceId;
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
    }
  }

  try {
  await prisma.$transaction(async tx => {
    await tx.payment.create({
      data: {
        id: paymentId,
        orderId: order.id,
        clientId: userId,
        provider: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? (npEnabled() ? 'NOWPayments' : 'CoinPayments') : 'Stripe',
        method: paymentMethod === 'balance' ? 'Balance' : paymentMethod === 'crypto' ? (npEnabled() ? 'Crypto' : 'USDT-TRC20') : 'Visa •• 4242',
        gross: total,
        fees: paymentMethod === 'card' ? total * 0.03 : 0,
        net: paymentMethod === 'card' ? total * 0.97 : total,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
        externalRef,
      },
    });

    if (!isInstant) {
      await tx.log.create({
        data: {
          actorId: userId, action: 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: paymentId,
          detail: `Renewal payment for ${order.id} awaiting crypto confirmation · ${money(total)}`,
        },
      });
      return;
    }

    const invoiceId = await nextInvoiceId();
    await tx.invoice.create({ data: { id: invoiceId, paymentId, orderId: order.id, clientId: userId, amount: total } });
    if (paymentMethod === 'balance') {
      // Guarded in-tx debit (P1-1) — userBalance was captured before this tx.
      const newBal = await debitBalance(tx, userId, total);
      await tx.balanceLedgerEntry.create({
        data: { userId, op: 'ORDER_DEBIT', amount: -total, balanceAfter: newBal, refOrderId: order.id, refPaymentId: paymentId, note: `Renewal of ${order.id}` },
      });
    }

    // Fresh in-tx re-read (review find): `order` predates this tx — a
    // concurrent one-click renewal / auto-renew tick may have already moved
    // expiresAt, and the stale base would swallow that paid period.
    const freshOrd = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, expiresAt: true, activatedAt: true, exception: true } });
    if (!freshOrd) throw new Error('Order not found');
    if (freshOrd.status === 'CANCELLED') throw new Error('Order was cancelled — renewal aborted');

    // An EXPIRED order has had its proxies auto-released to the pool — a bare
    // term shift would reactivate it with nothing assigned. Re-provision
    // (fresh proxies pool-first; short pool -> PAID_NOT_PROVISIONED with the
    // clock held for manual Assign).
    const repro = freshOrd.status === 'EXPIRED' ? await reprovisionRenewedOrder(tx, order, userId, now) : null;
    if (repro) {
      await tx.order.update({ where: { id: order.id }, data: repro.data });
      await tx.log.create({
        data: {
          actorId: userId, action: 'ORDER.EXTEND', objectType: 'ORDER', objectId: order.id,
          detail: `Renewed via checkout · ${paymentMethod} · ${money(total)} · re-provisioned ${repro.assignedCount}/${order.qty}${repro.fullyAssigned ? '' : ' · PAID_NOT_PROVISIONED'}`,
        },
      });
      await tx.notification.create({
        data: {
          id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId,
          title: repro.fullyAssigned
            ? `Order ${order.id} renewed — ${order.qty} fresh ${order.qty === 1 ? 'proxy' : 'proxies'} assigned`
            : `Order ${order.id} renewed — proxies are being provisioned`,
          kind: 'SUCCESS', link: `/orders/${order.id}`,
        },
      });
      return;
    }

    const base = freshOrd.expiresAt && freshOrd.expiresAt > now ? freshOrd.expiresAt : now;
    const newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);
    await tx.order.update({
      where: { id: order.id },
      data: {
        expiresAt: newExpiry,
        status: freshOrd.status === 'EXPIRED' ? 'ACTIVE' : freshOrd.status,
        activatedAt: freshOrd.activatedAt ?? now,
        renewalBucket: 'RENEWED',
        lastReminderAt: null,
        exception: freshOrd.exception === 'RENEWAL_NOT_EXTENDED' ? null : freshOrd.exception,
      },
    });

    await tx.log.create({
      data: {
        actorId: userId, action: 'ORDER.EXTEND', objectType: 'ORDER', objectId: order.id,
        detail: `Renewed via checkout · ${paymentMethod} · ${money(total)} · new expiry ${newExpiry.toISOString().slice(0, 10)}`,
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

  } catch (e: any) {
    // The in-tx guarded debit replaced the pre-tx balance check (P1-1) — a
    // concurrent spend between the two reads now fails cleanly instead of
    // silently double-spending.
    if (e instanceof InsufficientBalance) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true, orderId: order.id, renewed: isInstant, ...(paymentUrl ? { paymentUrl } : {}) });
}
