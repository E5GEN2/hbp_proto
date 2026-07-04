import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { npEnabled } from '@/lib/nowpayments';
import { mockPaymentsAllowed } from '@/lib/runtime-flags';
import { settleAwaitingPayment } from '@/lib/settle-payment';

const Schema = z.object({ orderId: z.string() });

// DEV-ONLY mock confirmation ("I've sent the payment" button). With NOWPayments
// configured, real settlement arrives via the IPN webhook and this endpoint is
// sealed — otherwise any client could self-confirm a crypto charge (audit B-3).
export async function POST(req: Request) {
  if (npEnabled() || !mockPaymentsAllowed()) {
    return NextResponse.json(
      { error: 'Crypto payments are confirmed automatically once the transaction is received.' },
      { status: 403 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'Bad input' }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: parse.data.orderId },
    include: { payments: true },
  });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.clientId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Idempotency: repeat POST (double-click, replay) must not re-assign proxies
  // or re-extend — no AWAITING payment left → nothing to confirm.
  const awaitingPay = order.payments.find(p => p.status === 'AWAITING');
  if (!awaitingPay) {
    return NextResponse.json({ ok: true, already: true });
  }

  const result = await settleAwaitingPayment(awaitingPay.id, 'mock confirm');
  return NextResponse.json(result);
}
