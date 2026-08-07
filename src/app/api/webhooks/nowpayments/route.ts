import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { npVerifySignature } from '@/lib/nowpayments';
import { settleAwaitingPayment, failAwaitingPayment } from '@/lib/settle-payment';
import { sendAdminTelegram, adminCryptoAttentionAlert } from '@/lib/telegram';
import { appUrl } from '@/lib/app-url';

export const dynamic = 'force-dynamic';

// Money arrived but the charge won't auto-settle (underpaid, or funds hit an
// expired/failed charge) — push the exact payment to the ops chat so support
// acts from Telegram instead of hunting in the NOWPayments dashboard. Best-
// effort: a lookup/send failure must never fail the IPN ack.
async function alertAdminAttention(paymentId: string, reason: string, evt: any) {
  try {
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { orderId: true, client: { select: { id: true, name: true } } },
    });
    if (!p) return;
    const cur = String(evt?.pay_currency ?? '').toUpperCase();
    await sendAdminTelegram(adminCryptoAttentionAlert({
      paymentId,
      reason,
      clientName: p.client?.name ?? p.client?.id ?? '—',
      clientId: p.client?.id ?? '—',
      received: `${evt?.actually_paid ?? '?'} ${cur}`.trim(),
      expected: `${evt?.pay_amount ?? '?'} ${cur}`.trim(),
      orderRef: p.orderId ?? 'balance top-up',
      adminUrl: appUrl(`/admin/payments/${paymentId}`),
    }));
  } catch (e) {
    console.warn(`[nowpayments] admin attention alert failed for ${paymentId}`, e);
  }
}

// NOWPayments IPN. Authenticated by HMAC signature — no session. order_id on
// the invoice carries our payment id (PAY-#####), so settlement is a lookup.
// Non-2xx responses make NOWPayments retry, so transient errors return 500
// and permanently irrelevant events return 200.
export async function POST(req: Request) {
  if (!process.env.NOWPAYMENTS_IPN_SECRET) {
    return NextResponse.json({ error: 'IPN not configured' }, { status: 503 });
  }

  const raw = await req.text();
  if (!npVerifySignature(raw, req.headers.get('x-nowpayments-sig'))) {
    console.warn('[nowpayments] IPN with bad/missing signature rejected');
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }

  const paymentId = String(evt?.order_id ?? '');
  const status = String(evt?.payment_status ?? '');
  if (!paymentId.startsWith('PAY-')) {
    console.warn(`[nowpayments] IPN ignored — unrecognized order_id "${paymentId}" (status=${status})`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Prior state, read ONCE before we mirror npStatus — used to dedup alerts so
  // NOWPayments' repeated IPNs for the same event don't spam the ops chat.
  const before = await prisma.payment.findUnique({
    where: { id: paymentId }, select: { status: true, npStatus: true },
  });
  const paidRaw = Number(evt?.actually_paid);
  const fundsArrived = Number.isFinite(paidRaw) && paidRaw > 0;

  try {
    // Mirror the raw NP status onto the payment row for the in-portal pay
    // panel ("payment detected, waiting confirmations…"). Display-only —
    // settlement below still keys off our own payment.status alone. updateMany
    // so an unknown PAY- id is a no-op, not a P2025 throw.
    if (status) {
      await prisma.payment.updateMany({ where: { id: paymentId }, data: { npStatus: status } });
    }
    // finished = funds fully received and settled on NOWPayments' side.
    // resurrectFailed: a charge we already failed locally (rate window
    // expired / client regenerated the address but paid the old one) still
    // settles — the funds are on-chain; idempotency must not swallow real
    // money. If the order meanwhile settled via a NEWER charge, the renewal
    // branch simply extends the term — paid twice, value twice.
    if (status === 'finished') {
      const result = await settleAwaitingPayment(paymentId, 'NOWPayments IPN', { resurrectFailed: true });
      return NextResponse.json(result);
    }

    if (status === 'failed' || status === 'expired' || status === 'refunded') {
      // Funds landed on a charge that then died (the classic "paid the expired
      // address" case) — the money is REAL. Do NOT fail it (that tells the
      // client it didn't complete and buries the signal); park it in
      // MANUAL_REVIEW so it has a durable admin surface (awaiting-payments bell
      // + MarkPaid confirm) independent of Telegram, and alert. Only act on the
      // first transition (before.status AWAITING) so IPN retries don't re-fire.
      if (status !== 'refunded' && fundsArrived && before?.status === 'AWAITING') {
        await prisma.payment.updateMany({ where: { id: paymentId, status: 'AWAITING' }, data: { status: 'MANUAL_REVIEW' } });
        await prisma.log.create({
          data: {
            actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
            detail: `NOWPayments IPN: charge ${status} but funds arrived — received ${evt?.actually_paid ?? '?'} ${evt?.pay_currency ?? ''} of expected ${evt?.pay_amount ?? '?'} → manual review`,
          },
        });
        await alertAdminAttention(paymentId, `charge ${status} but funds arrived`, evt);
        return NextResponse.json({ ok: true, noted: 'manual_review' });
      }
      const result = await failAwaitingPayment(paymentId, `${status} (NOWPayments IPN)`);
      return NextResponse.json(result);
    }

    if (status === 'partially_paid') {
      // Money arrived but not enough — needs a human. Log it (admin activity
      // feed) AND push the exact payment to the ops Telegram chat so support
      // never has to hunt for it in the NOWPayments dashboard. Dedup: only on
      // the first partially_paid IPN (NP re-sends the same event).
      const firstTime = before?.npStatus !== 'partially_paid';
      if (firstTime) {
        await prisma.log.create({
          data: {
            actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
            detail: `NOWPayments IPN: partially paid — received ${evt?.actually_paid ?? '?'} ${evt?.pay_currency ?? ''} of expected ${evt?.pay_amount ?? '?'}`,
          },
        });
        await alertAdminAttention(paymentId, 'underpaid (rate drift / late payment)', evt);
      }
      return NextResponse.json({ ok: true, noted: 'partially_paid', firstTime });
    }

    // waiting / confirming / confirmed / sending — intermediate, nothing to do.
    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    console.error(`[nowpayments] IPN processing failed for ${paymentId} (${status})`, e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
