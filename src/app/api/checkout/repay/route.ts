import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextPaymentId } from '@/lib/id';
import { enabledProviders } from '@/lib/runtime-flags';
import { npEnabled, npCreatePayment, npCoin, CRYPTO_MIN_USD, type NpDirectPayment } from '@/lib/nowpayments';
import { renewalPricing } from '@/lib/renewal';
import { loadTierGraceHours, renewalClosed } from '@/lib/grace';
import { money } from '@/lib/money';

const Schema = z.object({ orderId: z.string().optional(), paymentId: z.string().optional(), payCoin: z.string() })
  .refine(v => Boolean(v.orderId) !== Boolean(v.paymentId), { message: 'Pass exactly one of orderId / paymentId' });

// Floating-rate charges live ~7 days, so a lapsed charge is rare now — but it
// stays a NORMAL, recoverable outcome (and the common one again if the
// fixed-rate trap in nowpayments.ts ever regresses to 10-minute windows).
// This endpoint issues a fresh direct payment so the client doesn't have to
// start over:
//   · {orderId}: NEW order (re-arms paymentStatus, replaces the dead charge)
//     or a settled order with a dead RENEWAL charge (re-issues it; the IPN
//     renewal branch extends the order when it lands);
//   · {paymentId}: a TOPUP deposit charge — same recovery for balance top-ups
//     (deposits used to be a dead end: repay was order-only, audit 2026-08-11).
// A still-live AWAITING charge whose window has lapsed client-side (the
// 'expired' IPN simply hasn't arrived yet — or, post-policy-change, never
// flips it at all) is failed here first — otherwise the countdown-zero
// "Get a fresh address" button would always 409.
// Races: the partial unique index payments_one_awaiting_per_order is the
// durable guard for orders (concurrent inserts die with P2002 → 409); in-tx
// updateMany guards catch cancel-vs-repay interleavings and are the only
// guard for deposits (orderId null is outside the index — same as the deposit
// wizard itself, which can already open several independent top-ups).
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

  // ── Deposit (TOPUP) re-issue ─────────────────────────────────────────────
  if (parse.data.paymentId) {
    const old = await prisma.payment.findUnique({ where: { id: parse.data.paymentId } });
    if (!old || old.clientId !== userId || old.orderId) return NextResponse.json({ error: 'Deposit not found' }, { status: 404 });
    // Only a dead-or-lapsed direct charge is re-issuable; CONFIRMED means the
    // money landed, MANUAL_REVIEW means funds are attached to THIS charge — a
    // fresh address there would invite paying twice.
    if (!(old.provider === 'NOWPayments' && old.payAddress) || !(old.status === 'AWAITING' || old.status === 'FAILED')) {
      return NextResponse.json({ error: 'This deposit cannot be re-issued.' }, { status: 400 });
    }
    const amount = Number(old.gross);
    if (amount < CRYPTO_MIN_USD) return NextResponse.json({ error: `Minimum crypto payment is $${CRYPTO_MIN_USD}.` }, { status: 400 });

    const newId = await nextPaymentId();
    let np: NpDirectPayment;
    try {
      np = await npCreatePayment({
        amountUsd: amount,
        payCurrency: coin.code,
        paymentId: newId,
        description: `Balance top-up (re-issued)`,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
    }

    try {
      await prisma.$transaction(async tx => {
        // Retire the old charge with a status-guarded updateMany (optimistic
        // concurrency — a plain re-read takes no row lock, so a concurrent
        // settle/park between read and create would slip through; audit C11).
        // A no-op flip (FAILED→FAILED) still yields count 1 while the row is
        // FAILED, and 0 the instant a settle/park moves it — the guard we want.
        const guardStatus = old.status === 'AWAITING' ? 'AWAITING' : 'FAILED';
        const flipped = await tx.payment.updateMany({ where: { id: old.id, status: guardStatus }, data: { status: 'FAILED' } });
        if (flipped.count === 0) throw new Error('REPAY_RACE'); // settled / parked meanwhile — back off
        await tx.payment.create({
          data: {
            id: newId,
            orderId: null,
            clientId: userId,
            kind: 'TOPUP',
            provider: 'NOWPayments',
            method: 'Crypto',
            gross: amount, fees: 0, net: amount,
            status: 'AWAITING',
            externalRef: np.npPaymentId,
            payCurrency: np.payCurrency,
            payAmount: np.payAmount,
            payAddress: np.payAddress,
            payinExtraId: np.payinExtraId,
            payExpiresAt: np.expiresAt,
          },
        });
        await tx.log.create({
          data: {
            actorId: userId, action: 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: newId,
            detail: `Re-issued crypto deposit charge (was ${old.id}) · ${money(amount)} · ${np.payCurrency}`,
          },
        });
      });
    } catch (e: any) {
      if (e?.message === 'REPAY_RACE') {
        return NextResponse.json({ error: 'This deposit just changed state — reload the page.' }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({
      ok: true,
      payment: {
        paymentId: newId,
        payCurrency: np.payCurrency,
        payAmount: np.payAmount,
        payAddress: np.payAddress,
        payinExtraId: np.payinExtraId,
        payExpiresAt: np.expiresAt ? np.expiresAt.getTime() : null,
      },
    });
  }

  if (!orderId) return NextResponse.json({ error: 'Bad input' }, { status: 400 }); // refine guarantees this; narrows the type

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, client: { select: { tier: true, graceHoursOverride: true } } },
  });
  if (!order || order.clientId !== userId) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.status === 'CANCELLED' || order.status === 'PENDING_RENEWAL') {
    return NextResponse.json({ error: 'This order is no longer awaiting payment.' }, { status: 400 });
  }
  const isNewOrder = order.status === 'NEW';
  if (!isNewOrder && !order.plan.renewalAllowed) {
    return NextResponse.json({ error: 'Renewals are not available for this plan.' }, { status: 400 });
  }
  // Repay re-issues a lapsed direct charge; for a RENEWAL charge it must honour
  // the same past-grace policy as place/clientRenewOrder, or it becomes a
  // bypass — re-issuing a renewal charge (at the discounted price) that
  // reactivates a policy-dead order. New-order charges are exempt (never
  // activated, no grace). renewalClosed = clock + live-assignment based
  // (renewal-policy PR).
  if (!isNewOrder) {
    const tierGrace = await loadTierGraceHours();
    const liveCount = await prisma.assignment.count({ where: { orderId: order.id, releasedAt: null } });
    if (renewalClosed(order.expiresAt, liveCount, order.client, tierGrace, Date.now())) {
      return NextResponse.json({ error: 'This order has fully expired — start a new order to get fresh proxies.' }, { status: 400 });
    }
  }

  // Funds already attached to a charge on this order (under verification) — a
  // fresh address would invite paying twice. Mirror the deposit branch + the
  // checkout page's holding screen (audit C6/C9). Re-checked inside the tx
  // below via the AWAITING-only guard, but this is the fast, friendly reject.
  const review = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'MANUAL_REVIEW' }, select: { id: true } });
  if (review) {
    return NextResponse.json({ error: 'A payment for this order is being verified — no need to pay again.' }, { status: 409 });
  }

  const awaiting = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING' } });
  // The client only reaches "get a fresh address" from the expired/failed
  // recovery view, so honor it for any AWAITING NOWPayments DIRECT charge —
  // do NOT gate on the server clock. A skewed client clock (device set fast)
  // would otherwise dead-end a paying customer: the client shows "expired" and
  // offers regenerate, but the server still sees the charge live → 409 with no
  // way forward. The old address is abandoned; a late 'finished' IPN on it
  // still settles via resurrectFailed. A non-direct AWAITING charge
  // (unexpected for crypto) is left untouched.
  if (awaiting && !(awaiting.provider === 'NOWPayments' && awaiting.payAddress)) {
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
    : renewalPricing(order.plan, order).total;
  // Flat crypto floor (NP per-coin minimums are unreliable) — see CRYPTO_MIN_USD.
  if (total < CRYPTO_MIN_USD) return NextResponse.json({ error: `Minimum crypto payment is $${CRYPTO_MIN_USD}.` }, { status: 400 });

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
      // Re-check for parked funds INSIDE the tx: between the pre-check above
      // and here, an IPN can park a charge in MANUAL_REVIEW (funds detected on
      // a dead charge). Issuing a fresh address then would invite paying twice
      // (re-review C7).
      const parked = await tx.payment.findFirst({
        where: { orderId: order.id, status: 'MANUAL_REVIEW' }, select: { id: true },
      });
      if (parked) throw new Error('REPAY_REVIEW');
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
    if (e?.message === 'REPAY_REVIEW') {
      return NextResponse.json({ error: 'A payment for this order is being verified — no need to pay again.' }, { status: 409 });
    }
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
