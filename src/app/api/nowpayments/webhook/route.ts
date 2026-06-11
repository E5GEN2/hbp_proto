import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nextInvoiceId, nextAssignmentId } from '@/lib/id';
import { verifyIpnSignature } from '@/lib/nowpayments';

export const dynamic = 'force-dynamic';

/**
 * NOWPayments IPN webhook. Signature-verified (HMAC-SHA512 over the sorted
 * payload). On `payment_status === "finished"` we route by the `order_id` we
 * set on the invoice:
 *   ORD-…  -> confirm + provision the order (mirrors confirm-crypto)
 *   PAY-…  -> credit the balance deposit
 * Both paths are idempotent (NOWPayments retries IPNs).
 */
export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const signature = req.headers.get('x-nowpayments-sig') || '';
  if (!signature || !verifyIpnSignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const paymentStatus: string = payload.payment_status;
  const reference: string = String(payload.order_id || '');

  // Only act on terminal success. (waiting/confirming/partially_paid/expired
  // are acknowledged so NOWPayments stops retrying.)
  if (paymentStatus === 'finished') {
    try {
      if (reference.startsWith('ORD-')) {
        await fulfillOrder(reference);
      } else if (reference.startsWith('PAY-')) {
        await creditDeposit(reference);
      }
    } catch (e) {
      console.error('[nowpayments] webhook processing error', reference, e);
      return NextResponse.json({ error: 'Processing error' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Confirm a crypto order payment and provision it. Idempotent. */
async function fulfillOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, payments: true },
  });
  if (!order) return;
  if (order.paymentStatus === 'PAID') return; // already processed

  const now = new Date();
  const wantsAutoProvision = order.plan.autoProvision;

  await prisma.$transaction(async tx => {
    const awaitingPay = order.payments.find(p => p.status === 'AWAITING');
    if (awaitingPay) {
      await tx.payment.update({ where: { id: awaitingPay.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: awaitingPay.id, orderId: order.id, clientId: order.clientId, amount: Number(order.amount) },
      });
    }

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
    const finalStatus = wantsAutoProvision && fullyAssigned ? ('ACTIVE' as const) : ('PROVISIONING' as const);
    const finalActivated = finalStatus === 'ACTIVE' ? now : null;
    const finalExpires = finalStatus === 'ACTIVE' ? new Date(now.getTime() + order.plan.durationDays * 86_400_000) : null;
    const finalException = wantsAutoProvision && !fullyAssigned ? ('PAID_NOT_PROVISIONED' as const) : null;

    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: finalStatus,
        activatedAt: finalActivated,
        expiresAt: finalExpires,
        credentialsSentAt: finalActivated,
        credentialsChannel: finalActivated ? 'EMAIL' : null,
        exception: finalException,
        excInfo: finalException ? `Pool exhausted — ${assignedCount}/${order.qty} provisioned` : null,
      },
    });

    await tx.log.create({
      data: {
        actorId: order.clientId,
        action: 'PAYMENT.CONFIRM',
        objectType: 'PAYMENT',
        objectId: awaitingPay?.id ?? null,
        detail: `NOWPayments IPN confirmed ${order.id} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`,
      },
    });

    await tx.notification.create({
      data: {
        id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: order.clientId,
        title:
          finalStatus === 'ACTIVE'
            ? `Order ${order.id} activated — ${order.qty} ${order.qty === 1 ? 'proxy' : 'proxies'} ready`
            : `Order ${order.id} paid — provisioning in progress`,
        kind: finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
        link: `/orders/${order.id}`,
      },
    });
  });
}

/** Credit a confirmed crypto balance deposit. Idempotent. */
async function creditDeposit(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;
  if (payment.status !== 'AWAITING') return; // already processed / not a pending deposit
  if (payment.orderId) return; // deposits have no order

  const now = new Date();
  const amount = Number(payment.gross);

  await prisma.$transaction(async tx => {
    const me = await tx.user.findUnique({ where: { id: payment.clientId } });
    if (!me) return;

    await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });

    const newBal = Number(me.balance) + amount;
    await tx.user.update({ where: { id: payment.clientId }, data: { balance: newBal } });
    await tx.balanceLedgerEntry.create({
      data: { userId: payment.clientId, op: 'TOPUP', amount, balanceAfter: newBal, refPaymentId: payment.id, note: 'Crypto deposit (NOWPayments)' },
    });

    const invoiceId = await nextInvoiceId();
    await tx.invoice.create({ data: { id: invoiceId, paymentId: payment.id, orderId: null, clientId: payment.clientId, amount } });

    await tx.notification.create({
      data: {
        id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: payment.clientId,
        title: `Deposit of $${amount} confirmed · new balance $${newBal}`,
        kind: 'SUCCESS',
        link: '/billing',
      },
    });

    await tx.log.create({
      data: { actorId: payment.clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id, detail: `NOWPayments deposit confirmed · $${amount}` },
    });
  });
}
