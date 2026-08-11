import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { npVerifySignature } from '@/lib/nowpayments';
import { settleAwaitingPayment, failAwaitingPayment } from '@/lib/settle-payment';
import { sendAdminTelegram, adminCryptoAttentionAlert } from '@/lib/telegram';
import { appUrl } from '@/lib/app-url';
import { classifyIpn, type PaymentPhase } from '@/lib/crypto-window';

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
    // Single policy decision (unit-tested — see scripts/test-crypto-window.ts).
    const action = classifyIpn(status, fundsArrived, (before?.status ?? null) as PaymentPhase);

    switch (action) {
      case 'settle': {
        // finished = funds fully received and settled at NP. resurrectFailed: a
        // charge we already failed locally (window expired then paid, or the
        // client paid a regenerated-away address) still settles — the money is
        // on-chain; idempotency must not swallow it. If the order meanwhile
        // settled via a newer charge, the renewal branch just extends the term.
        const result = await settleAwaitingPayment(paymentId, 'NOWPayments IPN', { resurrectFailed: true });
        return NextResponse.json(result);
      }
      case 'manual_review': {
        // Funds landed on a charge that died (expired/failed with funds, or a
        // partial on an already-dead charge) — the money is REAL. Park it in
        // MANUAL_REVIEW for a durable admin surface (awaiting-payments bell +
        // MarkPaid) independent of Telegram, and alert. Accepted from AWAITING
        // *and* the locally-dead states: under the ~10-min window "charge
        // expired, then the transfer confirmed" is the routine late shape, and
        // the charge may already be FAILED (repay/failed-IPN) or CANCELLED (72h
        // sweep). The guarded updateMany is both the race guard and the dedup —
        // only the real flip logs and alerts; IPN retries no-op.
        const flipped = await prisma.payment.updateMany({
          where: { id: paymentId, status: { in: ['AWAITING', 'FAILED', 'CANCELLED'] } },
          data: { status: 'MANUAL_REVIEW' },
        });
        if (flipped.count > 0) {
          await prisma.log.create({
            data: {
              actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
              detail: `NOWPayments IPN: charge ${status} but funds arrived — received ${evt?.actually_paid ?? '?'} ${evt?.pay_currency ?? ''} of expected ${evt?.pay_amount ?? '?'} → manual review`,
            },
          });
          await alertAdminAttention(paymentId, `charge ${status} but funds arrived`, evt);
          return NextResponse.json({ ok: true, noted: 'manual_review' });
        }
        return NextResponse.json({ ok: true, already: true });
      }
      case 'fail': {
        // A real NP failure ('failed') or a refund — fail the AWAITING charge.
        // NOTE: 'expired' with no funds does NOT reach here (classifyIpn → noop):
        // the account force-expires every fixed-rate charge at ~10 min, so
        // failing an expired-no-funds charge punished normal wallet latency with
        // a FAILED row + alarming bell (the 2026-08-10 PAY-48127/74487 incident).
        // Such a charge stays AWAITING — the panel offers a fresh address and the
        // 72h sweep is the one reaper — unifying policy with the reconciler.
        const result = await failAwaitingPayment(paymentId, `${status} (NOWPayments IPN)`);
        return NextResponse.json(result);
      }
      case 'underpaid_alert': {
        // Underpaid on a still-live AWAITING charge: the client may send the
        // remainder — no state change, but a human should know. Log + ops
        // Telegram, deduped on the first partially_paid IPN (NP re-sends it).
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
      case 'noop':
      default:
        // expired-no-funds (open cart) / waiting / confirming / confirmed /
        // sending — nothing to do; npStatus already mirrored above.
        return NextResponse.json({ ok: true, status });
    }
  } catch (e: any) {
    console.error(`[nowpayments] IPN processing failed for ${paymentId} (${status})`, e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
