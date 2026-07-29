import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextPaymentId } from '@/lib/id';
import { enabledProviders } from '@/lib/runtime-flags';
import { npEnabled, npCreatePayment, npCoin, type NpDirectPayment } from '@/lib/nowpayments';
import { renewalUnitPrice } from '@/lib/renewal';
import { money } from '@/lib/money';

const Schema = z.object({ orderId: z.string(), payCoin: z.string() });

// Fixed-rate windows are short (~20 min) — an expired charge is a NORMAL
// outcome, not an edge case. This endpoint issues a fresh direct payment for
// an existing order so the client doesn't have to re-place it:
//   · NEW order (initial purchase): re-arms paymentStatus and replaces the
//     dead charge;
//   · settled order with a dead RENEWAL charge: re-issues the renewal charge
//     (the IPN renewal branch extends the order when it lands).
// A still-live AWAITING charge whose rate window has lapsed client-side (the
// 'expired' IPN simply hasn't arrived yet) is failed here first — otherwise
// the countdown-zero "Generate fresh address" button would always 409.
// Races: the partial unique index payments_one_awaiting_per_order is the
// durable guard (concurrent inserts die with P2002 → 409); in-tx updateMany
// guards catch cancel-vs-repay interleavings.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.emailVerified) return NextResponse.json({ error: 'Verify your email to continue' }, { status: 403 });
  const userId = session.user.id;

  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'Bad input' }, { status: 400 });
  const { orderId } = parse.data;

  if (!npEnabled()) return NextResponse.json({ error: 'Crypto payments are temporarily unavailable.' }, { status: 400 });
  const providers = await enabledProviders();
  if (!providers.crypto) return NextResponse.json({ error: 'Crypto payments are currently disabled.' }, { status: 400 });
  const coin = npCoin(parse.data.payCoin);
  if (!coin) return NextResponse.json({ error: 'Pick the cryptocurrency you want to pay with.' }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { plan: true } });
  if (!order || order.clientId !== userId) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.status === 'CANCELLED' || order.status === 'PENDING_RENEWAL') {
    return NextResponse.json({ error: 'This order is no longer awaiting payment.' }, { status: 400 });
  }
  const isNewOrder = order.status === 'NEW';
  if (!isNewOrder && !order.plan.renewalAllowed) {
    return NextResponse.json({ error: 'Renewals are not available for this plan.' }, { status: 400 });
  }

  const now = new Date();
  const awaiting = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING' } });
  // A charge that is still inside its rate window stays authoritative — the
  // client should pay IT, not mint another address.
  if (awaiting && !(awaiting.payAddress && awaiting.payExpiresAt && awaiting.payExpiresAt <= now)) {
    return NextResponse.json({ error: 'A payment is already awaiting confirmation for this order.' }, { status: 409 });
  }
  // Re-issue needs evidence a direct charge existed for this order — repay is
  // a recovery surface, not a way to originate charges (renewals originate in
  // /api/checkout/place).
  if (!awaiting) {
    const hadDirect = await prisma.payment.findFirst({
      where: { orderId: order.id, provider: 'NOWPayments', payAddress: { not: null } },
      select: { id: true },
    });
    if (!hadDirect) return NextResponse.json({ error: 'Nothing to re-issue for this order.' }, { status: 400 });
  }

  // NEW order → the original amount; renewal → the same discounted price the
  // renewal charge paths use (never client-supplied).
  const total = isNewOrder
    ? Number(order.amount)
    : renewalUnitPrice(Number(order.plan.price), order.plan.renewalDiscountPct) * order.qty;
  const paymentId = await nextPaymentId();

  let npPay: NpDirectPayment;
  try {
    npPay = await npCreatePayment({
      amountUsd: total,
      payCurrency: coin.code,
      paymentId,
      description: `${isNewOrder ? `Order ${order.id}` : `Renewal of order ${order.id}`} — ${order.qty} × ${order.plan.name} (re-issued)`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
  }

  try {
    await prisma.$transaction(async tx => {
      // Retire the lapsed AWAITING charge first (frees the partial unique
      // index slot). Guarded update: if an IPN or a concurrent repay already
      // flipped it, count 0 → somebody else owns this recovery — back off.
      if (awaiting) {
        const flipped = await tx.payment.updateMany({
          where: { id: awaiting.id, status: 'AWAITING' },
          data: { status: 'FAILED' },
        });
        if (flipped.count === 0) throw new Error('REPAY_RACE');
      }
      await tx.payment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          clientId: userId,
          provider: 'NOWPayments',
          method: 'Crypto',
          gross: total, fees: 0, net: total,
          status: 'AWAITING',
          externalRef: npPay.npPaymentId,
          payCurrency: npPay.payCurrency,
          payAmount: npPay.payAmount,
          payAddress: npPay.payAddress,
          payinExtraId: npPay.payinExtraId,
          payExpiresAt: npPay.expiresAt,
        },
      });
      if (isNewOrder) {
        // Re-arm the unpaid order — guarded so a concurrent cancel between the
        // pre-check and this tx can't be resurrected into AWAITING.
        const armed = await tx.order.updateMany({
          where: { id: order.id, status: 'NEW' },
          data: { paymentStatus: 'AWAITING' },
        });
        if (armed.count === 0) throw new Error('REPAY_RACE');
      }
      await tx.log.create({
        data: {
          actorId: userId, action: 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: paymentId,
          detail: `Re-issued crypto charge for ${order.id}${isNewOrder ? '' : ' (renewal)'} · ${money(total)} · ${npPay.payCurrency}`,
        },
      });
    });
  } catch (e: any) {
    if (e?.message === 'REPAY_RACE' || e?.code === 'P2002') {
      return NextResponse.json({ error: 'A payment is already awaiting confirmation for this order.' }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({
    ok: true,
    payment: {
      paymentId,
      payCurrency: npPay.payCurrency,
      payAmount: npPay.payAmount,
      payAddress: npPay.payAddress,
      payinExtraId: npPay.payinExtraId,
      payExpiresAt: npPay.expiresAt ? npPay.expiresAt.getTime() : null,
    },
  });
}
