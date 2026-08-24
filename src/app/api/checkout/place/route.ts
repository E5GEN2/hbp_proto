import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { nextOrderId, nextPaymentId, nextInvoiceId, nextAssignmentId } from '@/lib/id';
import { mockPaymentsAllowed, newOrdersFrozen, enabledProviders } from '@/lib/runtime-flags';
import { renewalBase, renewalPricing, purchaseUnitPrice, consumeRenewalDiscountCycle } from '@/lib/renewal';
import { fmtDate } from '@/lib/date';
import { money } from '@/lib/money';
import { debitBalance, InsufficientBalance } from '@/lib/balance';
import { npEnabled, npCreatePayment, npCoin, CRYPTO_MIN_USD, type NpDirectPayment } from '@/lib/nowpayments';
import { reprovisionRenewedOrder } from '@/lib/transitions';
import { loadTierGraceHours, renewalClosed } from '@/lib/grace';
import { sendAdminTelegram, adminNewOrderAlert } from '@/lib/telegram';
import { appUrl } from '@/lib/app-url';

const Schema = z.object({
  planId: z.string(),
  qty: z.number().int().min(1).max(100),
  autoExtend: z.boolean(),
  paymentMethod: z.enum(['balance', 'crypto', 'card']),
  // In-portal crypto: the coin the client picked. Validated against NP_COINS —
  // never forwarded to the processor raw.
  payCoin: z.string().optional(),
  // Explicit "yes, place another identical order" — clears the recent-duplicate
  // backstop below (owner ask 2026-07-31).
  confirmDuplicate: z.boolean().optional(),
  renewOf: z.string().optional(),
});

// What the client pay panel renders — every field comes from OUR stored
// payment row / the NP create response, never from client input.
function payPanelPayload(paymentId: string, np: NpDirectPayment) {
  return {
    paymentId,
    payCurrency: np.payCurrency,
    payAmount: np.payAmount,
    payAddress: np.payAddress,
    payinExtraId: np.payinExtraId,
    payExpiresAt: np.expiresAt ? np.expiresAt.getTime() : null,
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.emailVerified) return NextResponse.json({ error: 'Verify your email to continue' }, { status: 403 });
  const userId = session.user.id;

  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Bad input' }, { status: 400 });
  const { planId, qty, autoExtend, paymentMethod, renewOf } = parse.data;

  // Whitelist-validate the coin up front (both the new-order and the renewal
  // branch create the NP charge with it).
  const coin = paymentMethod === 'crypto' && npEnabled() ? npCoin(parse.data.payCoin) : null;
  if (paymentMethod === 'crypto' && npEnabled() && !coin) {
    return NextResponse.json({ error: 'Pick the cryptocurrency you want to pay with.' }, { status: 400 });
  }

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
    return handleRenewal({ renewOf, userId, userBalance: Number(user.balance), paymentMethod, coin });
  }

  if (await newOrdersFrozen()) {
    return NextResponse.json({ error: 'Ordering is temporarily paused — please try again later.' }, { status: 403 });
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || plan.deletedAt) return NextResponse.json({ error: 'Plan unavailable' }, { status: 400 });

  // One unpaid self-serve order per plan: a stale tab or back-button retry
  // must not stack duplicates. The client resolves it on the completion page
  // (/checkout?resume=…) — pay the existing invoice or cancel the order.
  // Keyed on a LIVE AWAITING charge, not order.paymentStatus alone: an order
  // whose charge went to MANUAL_REVIEW (funds under verification) keeps
  // paymentStatus AWAITING but has nothing the client can pay — 409ing here
  // dead-locked them out of buying the plan at all (audit C7).
  const unpaid = await prisma.order.findFirst({
    where: { clientId: userId, planId, status: 'NEW', paymentStatus: 'AWAITING', payments: { some: { status: 'AWAITING' } } },
    orderBy: { createdAt: 'desc' },
  });
  if (unpaid) {
    return NextResponse.json({
      error: `You already have an unpaid order (${unpaid.id}) for this plan — complete its payment or cancel it first.`,
      orderId: unpaid.id,
    }, { status: 409 });
  }

  // Accidental double-charge backstop (owner ask 2026-07-31): an IDENTICAL
  // order (same plan, qty, region) that was PAID moments ago is almost always a
  // double-submit or a stale-tab re-buy — the 409 above only covers UNPAID
  // dupes. Require one explicit confirm rather than silently charging twice.
  if (!parse.data.confirmDuplicate) {
    const recentPaid = await prisma.order.findFirst({
      where: {
        clientId: userId, planId, qty, region: plan.region,
        paymentStatus: 'PAID',
        createdAt: { gte: new Date(Date.now() - 120_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (recentPaid) {
      return NextResponse.json({
        error: `You placed an identical order (${recentPaid.id}) less than 2 minutes ago.`,
        recentOrderId: recentPaid.id, needsConfirm: true,
      }, { status: 409 });
    }
  }

  // Client-level discount (owner decision 2026-08-22): the client's special
  // price applies to NEW purchases too. purchaseUnitPrice rounds to exact
  // cents; the checkout UI prices its planSummaries with the same helper, so
  // the displayed price always equals the charged one (audit B-6 rule).
  const unitPrice = purchaseUnitPrice(Number(plan.price), user.clientDiscountPct);
  const total = Math.round(unitPrice * qty * 100) / 100;

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

  // Real crypto: create the NOWPayments direct payment BEFORE persisting
  // anything — if the processor is down, no dangling order is left behind.
  // The IPN webhook settles by order_id = our payment id. The client pays on
  // OUR page (no redirect): the response carries address/amount/expiry.
  let npPay: NpDirectPayment | null = null;
  if (coin) {
    // Flat crypto floor (NP per-coin minimums are unreliable) — see CRYPTO_MIN_USD.
    if (total < CRYPTO_MIN_USD) return NextResponse.json({ error: `Minimum crypto payment is $${CRYPTO_MIN_USD}. Pay from balance or increase the quantity.` }, { status: 400 });
    try {
      npPay = await npCreatePayment({
        amountUsd: total,
        payCurrency: coin.code,
        paymentId,
        description: `Order ${orderId} — ${qty} × ${plan.name}`,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
    }
  }
  const externalRef = npPay ? npPay.npPaymentId : null;

  const now = new Date();

  // Admin TG alert for instantly-paid orders (balance/card) — built inside the
  // tx, sent after commit. Crypto orders alert from settle-payment instead.
  let adminAlert: string | null = null;

  try {
  await prisma.$transaction(async tx => {
    // 0. Authoritative capacity re-check INSIDE the transaction (audit B-5) —
    //    the pre-check above ran before the (slow) processor call, so a
    //    concurrent order could have taken the last seats in between. Lock the
    //    plan row first so the recheck serializes against any other order-
    //    create on this plan (admin New Order + concurrent client checkouts) —
    //    the aggregate is read-then-write, so without the lock two checkouts
    //    both read the same free-seat count and oversell.
    await tx.$queryRaw`SELECT id FROM plans WHERE id = ${planId} FOR UPDATE`;
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
        // Direct-payment display fields (NULL for balance/card/legacy)
        payCurrency: npPay?.payCurrency ?? null,
        payAmount: npPay?.payAmount ?? null,
        payAddress: npPay?.payAddress ?? null,
        payinExtraId: npPay?.payinExtraId ?? null,
        payExpiresAt: npPay?.expiresAt ?? null,
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
        // Honest per state (the else branch used to claim "proxies are being
        // prepared" for an UNPAID crypto order, where nothing is provisioned
        // until the transfer lands). isInstant ⇒ balance/card paid this instant
        // (order is ACTIVE or PROVISIONING); !isInstant ⇒ crypto/other, order is
        // NEW awaiting payment.
        title:
          finalStatus === 'ACTIVE'
            ? `Order ${orderId} activated — ${qty} ${qty === 1 ? 'proxy' : 'proxies'} ready`
            : isInstant
              ? `Order ${orderId} confirmed — your proxies are being prepared`
              : `Order ${orderId} placed — complete payment to start provisioning`,
        kind: finalStatus === 'ACTIVE' ? 'SUCCESS' : 'INFO',
        link: `/orders/${orderId}`,
      },
    });

    if (isInstant) {
      adminAlert = adminNewOrderAlert({
        orderId,
        clientName: user.name ?? user.id,
        clientId: user.id,
        planName: plan.name,
        qty,
        amount: money(total),
        method: paymentMethod === 'balance' ? 'Balance' : 'Card',
        status: finalStatus,
        assigned: assignedIds.length,
        adminUrl: appUrl(`/admin/orders/${orderId}`),
      });
    }
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

  if (adminAlert) await sendAdminTelegram(adminAlert);

  return NextResponse.json({ ok: true, orderId, ...(npPay ? { payment: payPanelPayload(paymentId, npPay) } : {}) });
}

// Renewal branch. Instant methods (balance/card) extend immediately; crypto
// creates an AWAITING payment on the original order and the extension happens
// in /api/checkout/confirm-crypto once the client confirms.
async function handleRenewal({ renewOf, userId, userBalance, paymentMethod, coin }: {
  renewOf: string;
  userId: string;
  userBalance: number;
  paymentMethod: 'balance' | 'crypto' | 'card';
  coin: ReturnType<typeof npCoin>; // whitelist-validated by the caller (non-null when crypto+npEnabled)
}) {
  const order = await prisma.order.findUnique({
    where: { id: renewOf },
    include: { plan: true, client: { select: { tier: true, graceHoursOverride: true, clientDiscountPct: true } } },
  });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (order.status === 'CANCELLED' || order.status === 'PENDING_RENEWAL') {
    return NextResponse.json({ error: 'This order cannot be renewed' }, { status: 400 });
  }
  if (!order.plan.renewalAllowed) {
    return NextResponse.json({ error: 'Renewals are not available for this plan' }, { status: 400 });
  }
  // No term — nothing to extend (R1+R3, mirrors clientRenewOrder): activatedAt
  // null = never delivered; expiresAt null with activatedAt set = clock-held
  // after a short-pool renewal reprovision. Either way a renewal would stamp
  // expiresAt on a non-ACTIVE row and burn paid days before delivery.
  if (!order.activatedAt || !order.expiresAt) {
    return NextResponse.json({ error: 'This order has no active term to extend — renewal opens once its proxies are delivered.' }, { status: 400 });
  }
  // Once past grace AND its proxies are released the order can no longer be
  // renewed contiguously — the client buys a fresh order instead. renewalClosed
  // is clock + live-assignment based (not order.status); the checkout renewal
  // page shows the same "buy again" affordance, this is the server backstop
  // (renewal-policy PR).
  const tierGrace = await loadTierGraceHours();
  const liveCount = await prisma.assignment.count({ where: { orderId: order.id, releasedAt: null } });
  if (renewalClosed(order.expiresAt, liveCount, order.client, tierGrace, Date.now())) {
    return NextResponse.json({ error: 'This order has fully expired — start a new order to get fresh proxies.' }, { status: 400 });
  }
  // Funds already attached to a charge on this order and under verification —
  // a second charge would bill the client twice for one renewal. Same rule the
  // repay endpoint and the resume screen enforce (re-review C2).
  const parked = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'MANUAL_REVIEW' }, select: { id: true } });
  if (parked) {
    return NextResponse.json({ error: 'A payment for this order is being verified — no need to pay again.', orderId: order.id }, { status: 409 });
  }
  // One pending renewal payment at a time — a second POST while crypto is
  // awaiting confirmation must not stack another charge. Scoped to STAMPED
  // (renewal-originated) charges (R3, matches clientRenewOrder/auto-renew).
  const pending = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING', renewalDiscountApplied: { not: null } } });
  if (pending) {
    // orderId → CheckoutFlow's 409 handler routes to /checkout?resume=… where
    // the payment-aware panel re-opens the pending charge (review find).
    return NextResponse.json({ error: `A renewal payment (${pending.id}) is already awaiting confirmation.`, orderId: order.id }, { status: 409 });
  }
  // Crypto keeps the BROAD block: payments_one_awaiting_per_order allows only
  // one AWAITING row per order, so creating a second (even for a renewal on an
  // order whose PURCHASE charge is still AWAITING under manual-fulfillment
  // override) would die on the index — 409 with honest copy instead.
  if (paymentMethod === 'crypto') {
    const anyAwaiting = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING' }, select: { id: true } });
    if (anyAwaiting) {
      return NextResponse.json({ error: `A payment (${anyAwaiting.id}) on this order is already awaiting confirmation — complete or cancel it first.`, orderId: order.id }, { status: 409 });
    }
  }

  // Renewal discounts (audit B-6) — renewalPricing is the ONE source for every
  // renewal charge and display (a per-order admin grant replaces the plan and
  // client discounts while active; else max(client, plan) applies), so all
  // surfaces agree to the cent.
  const pricing = renewalPricing(order.plan, order, order.client);
  const total = pricing.total;
  const isInstant = paymentMethod === 'balance' || paymentMethod === 'card';
  if (paymentMethod === 'balance' && userBalance < total) {
    return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
  }

  const paymentId = await nextPaymentId();
  const now = new Date();

  // Real crypto renewal: direct payment first (same contract as new orders) —
  // the IPN webhook extends the order once the transfer lands.
  let npPay: NpDirectPayment | null = null;
  if (coin) {
    // Flat crypto floor (NP per-coin minimums are unreliable) — see CRYPTO_MIN_USD.
    if (total < CRYPTO_MIN_USD) return NextResponse.json({ error: `Minimum crypto payment is $${CRYPTO_MIN_USD}. Pay from balance or increase the quantity.` }, { status: 400 });
    try {
      npPay = await npCreatePayment({
        amountUsd: total,
        payCurrency: coin.code,
        paymentId,
        description: `Renewal of order ${order.id} — ${order.qty} × ${order.plan.name}`,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Crypto payment processor is unavailable.' }, { status: 502 });
    }
  }
  const externalRef = npPay ? npPay.npPaymentId : null;

  try {
  await prisma.$transaction(async tx => {
    // Serialize ALL renewal writers on the order row (R3) — see
    // clientRenewOrder: an uncommitted concurrent renewal is invisible to
    // plain reads under READ COMMITTED; the lock makes the loser wait and
    // then SEE the winner's committed charge in the re-check below.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    const parkedNow = await tx.payment.findFirst({
      where: { orderId: order.id, OR: [{ status: 'MANUAL_REVIEW' }, { status: 'AWAITING', renewalDiscountApplied: { not: null } }] },
      select: { id: true },
    });
    if (parkedNow) throw new Error('RENEWAL_RACE');
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
        payCurrency: npPay?.payCurrency ?? null,
        payAmount: npPay?.payAmount ?? null,
        payAddress: npPay?.payAddress ?? null,
        payinExtraId: npPay?.payinExtraId ?? null,
        payExpiresAt: npPay?.expiresAt ?? null,
        // Charge-time snapshot: the cycle is consumed at settle ONLY when the
        // per-order discount priced THIS charge (review R1).
        renewalDiscountApplied: pricing.source === 'order',
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
      // Consume one discount cycle ONLY when the discount priced this charge
      // (atomic guarded decrement; instant path — same tx as the charge).
      if (pricing.source === 'order') await consumeRenewalDiscountCycle(tx, order.id);
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

    // Anchor on the ORIGINAL expiry (renewal-policy PR): a checkout renewal
    // extends contiguously from the due date, not `now`. Renewal-closed orders
    // are refused before the charge (see the renewalClosed guard at the top of
    // handleRenewal); renewalBase additionally floors to `now` if a full term
    // from expiry would be wholly in the past, so no past-dated charged term.
    const base = renewalBase(freshOrd.expiresAt, order.plan.durationDays, now);
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
    if (pricing.source === 'order') await consumeRenewalDiscountCycle(tx, order.id);

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
    // Two concurrent crypto renewals: the pre-tx pending-check is blind to an
    // uncommitted sibling — payments_one_awaiting_per_order catches the loser.
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'A renewal payment is already awaiting confirmation.', orderId: order.id }, { status: 409 });
    }
    // In-tx re-check after the order-row lock (R3): the concurrent renewal
    // writer won the race — its charge is committed, ours rolls back.
    if (e?.message === 'RENEWAL_RACE') {
      return NextResponse.json({ error: 'A renewal for this order was just started elsewhere — reload to see its state.', orderId: order.id }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true, orderId: order.id, renewed: isInstant, ...(npPay ? { payment: payPanelPayload(paymentId, npPay) } : {}) });
}
