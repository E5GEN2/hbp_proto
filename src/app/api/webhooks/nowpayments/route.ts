import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { npVerifySignature } from '@/lib/nowpayments';
import { settleAwaitingPayment, failAwaitingPayment } from '@/lib/settle-payment';

export const dynamic = 'force-dynamic';

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

  try {
    // finished = funds fully received and settled on NOWPayments' side.
    if (status === 'finished') {
      const result = await settleAwaitingPayment(paymentId, 'NOWPayments IPN');
      return NextResponse.json(result);
    }

    if (status === 'failed' || status === 'expired' || status === 'refunded') {
      const result = await failAwaitingPayment(paymentId, `${status} (NOWPayments IPN)`);
      return NextResponse.json(result);
    }

    if (status === 'partially_paid') {
      // Money arrived but not enough — needs a human. Surface it in the log
      // stream the admin panel already shows.
      await prisma.log.create({
        data: {
          actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
          detail: `NOWPayments IPN: partially paid — received ${evt?.actually_paid ?? '?'} ${evt?.pay_currency ?? ''} of expected ${evt?.pay_amount ?? '?'}`,
        },
      });
      return NextResponse.json({ ok: true, noted: 'partially_paid' });
    }

    // waiting / confirming / confirmed / sending — intermediate, nothing to do.
    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    console.error(`[nowpayments] IPN processing failed for ${paymentId} (${status})`, e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
