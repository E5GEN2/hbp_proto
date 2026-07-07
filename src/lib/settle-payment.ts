// Single place where an AWAITING crypto payment turns into value: balance
// top-up, new-order activation, or renewal extension. Called from the
// NOWPayments IPN webhook (real money) and from the legacy mock confirm
// endpoint (dev only) — both paths settle identically and idempotently.

import { prisma } from './prisma';
import { nextInvoiceId, nextAssignmentId } from './id';
import { fmtDate } from './date';
import { sendEmail, orderPaidEmail, orderRenewedEmail, depositConfirmedEmail } from './email';

export type SettleResult =
  | { ok: true; already: true }
  | { ok: true; kind: 'deposit' | 'order' | 'renewal' };

function notifId() {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function settleAwaitingPayment(paymentId: string, via: string): Promise<SettleResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { client: true } });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  // Idempotency: IPN retries and double-clicks must not re-credit.
  if (payment.status !== 'AWAITING') return { ok: true, already: true };

  const now = new Date();
  const clientId = payment.clientId;
  const clientEmail = payment.client.email;

  // ── Balance top-up (payment carries no order) ─────────────────────────────
  if (!payment.orderId) {
    const amount = Number(payment.gross);
    let newBal = 0;
    await prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
      const me = await tx.user.findUnique({ where: { id: clientId } });
      if (!me) throw new Error(`User ${clientId} not found for deposit ${payment.id}`);
      newBal = Number(me.balance) + amount;
      await tx.user.update({ where: { id: clientId }, data: { balance: newBal } });
      await tx.balanceLedgerEntry.create({
        data: { userId: clientId, op: 'TOPUP', amount, balanceAfter: newBal, refPaymentId: payment.id, note: `Deposit crypto (${via})` },
      });
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({ data: { id: invoiceId, paymentId: payment.id, orderId: null, clientId, amount } });
      await tx.notification.create({
        data: { id: notifId(), userId: clientId, title: `Deposit of $${amount} added to your balance · new bal $${newBal}`, kind: 'SUCCESS', link: '/billing' },
      });
      await tx.log.create({
        data: { actorId: clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id, detail: `Crypto deposit confirmed via ${via} · $${amount.toFixed(2)}` },
      });
    });
    await sendEmail({ to: clientEmail, ...depositConfirmedEmail(`$${amount.toFixed(2)}`, `$${newBal.toFixed(2)}`) });
    return { ok: true, kind: 'deposit' };
  }

  const order = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { plan: true } });
  if (!order) throw new Error(`Order ${payment.orderId} not found for payment ${payment.id}`);

  // ── Renewal: the order itself is already settled (paymentStatus PAID/…) and
  //    the AWAITING row is a renewal charge. Confirming it EXTENDS the original
  //    order — no proxy assignment (B-2). ─────────────────────────────────────
  if (order.paymentStatus !== 'AWAITING') {
    const base = order.expiresAt && order.expiresAt > now ? order.expiresAt : now;
    const newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);
    await prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: payment.id, orderId: order.id, clientId: order.clientId, amount: Number(payment.gross) },
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
          actorId: order.clientId, action: 'PAYMENT.CONFIRM', objectType: 'PAYMENT', objectId: payment.id,
          detail: `Crypto renewal payment confirmed via ${via} for ${order.id} — extended to ${newExpiry.toISOString().slice(0, 10)}`,
        },
      });
      await tx.notification.create({
        data: {
          id: notifId(), userId: order.clientId,
          title: `Order ${order.id} renewed — new expiry ${fmtDate(newExpiry)}`,
          kind: 'SUCCESS', link: `/orders/${order.id}`,
        },
      });
    });
    await sendEmail({ to: clientEmail, ...orderRenewedEmail(order.id, fmtDate(newExpiry)) });
    return { ok: true, kind: 'renewal' };
  }

  // ── New order: mark paid, then provision (assign proxies if the plan wants
  //    auto-provisioning and the pool has capacity). ─────────────────────────
  const wantsAutoProvision = order.plan.autoProvision;
  let finalActive = false;

  await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
    {
      const invoiceId = await nextInvoiceId();
      await tx.invoice.create({
        data: { id: invoiceId, paymentId: payment.id, orderId: order.id, clientId: order.clientId, amount: Number(order.amount) },
      });
    }

    let assignedCount = 0;
    if (wantsAutoProvision) {
      // Pool-first, then widen to any pool of the same carrier+region — the
      // crypto path used to skip straight to the wide query, diluting the
      // plan's own pool (P2 #3). Mirrors markPaymentPaid / checkout/place.
      const candidates = await tx.proxy.findMany({
        where: { carrier: order.plan.carrier, region: order.region, pool: order.plan.pool, status: 'AVAILABLE', health: 'HEALTHY' },
        take: order.qty,
      });
      if (candidates.length < order.qty) {
        const more = await tx.proxy.findMany({
          where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY', id: { notIn: candidates.map(c => c.id) } },
          take: order.qty - candidates.length,
        });
        candidates.push(...more);
      }
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
    finalActive = finalStatus === 'ACTIVE';
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
        objectId: payment.id,
        detail: `Crypto payment confirmed via ${via} for ${order.id} · status=${finalStatus}${finalException ? ' · ' + finalException : ''}`,
      },
    });

    await tx.notification.create({
      data: {
        id: notifId(), userId: order.clientId,
        title: finalStatus === 'ACTIVE'
          ? `Order ${order.id} activated — ${order.qty} ${order.qty === 1 ? 'proxy' : 'proxies'} ready`
          : `Order ${order.id} paid — provisioning in progress`,
        kind: finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
        link: `/orders/${order.id}`,
      },
    });
  });

  await sendEmail({ to: clientEmail, ...orderPaidEmail(order.id, finalActive) });
  return { ok: true, kind: 'order' };
}

// IPN told us the charge died (expired / failed / refunded before credit).
// Only an AWAITING payment flips — a settled one is left alone.
export async function failAwaitingPayment(paymentId: string, reason: string): Promise<{ ok: true; changed: boolean }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'AWAITING') return { ok: true, changed: false };

  await prisma.$transaction(async tx => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    if (payment.orderId) {
      const order = await tx.order.findUnique({ where: { id: payment.orderId } });
      // Only a brand-new unpaid order flips to FAILED; a settled order with a
      // dead renewal charge keeps its own paymentStatus.
      if (order && order.paymentStatus === 'AWAITING') {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } });
      }
    }
    await tx.log.create({
      data: {
        actorId: payment.clientId, action: 'PAYMENT.FAIL', objectType: 'PAYMENT', objectId: payment.id,
        detail: `Crypto payment ${reason}`,
      },
    });
  });
  return { ok: true, changed: true };
}
