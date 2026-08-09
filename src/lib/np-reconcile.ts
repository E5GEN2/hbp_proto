import { prisma } from './prisma';
import { settleAwaitingPayment } from './settle-payment';
import { npGetPayment } from './np-api';
import { sendAdminTelegram, adminCryptoAttentionAlert } from './telegram';
import { appUrl } from './app-url';

// Reconcile crypto payments against NOWPayments' authoritative status — the
// safety net that makes settlement independent of IPN delivery/signatures.
//
// Why this exists: NOWPayments IPNs can silently fail (a signature-recipe or
// secret mismatch rejects every callback — the 2026-08-09 PAY-57160 incident,
// where the client paid but the order sat AWAITING because no IPN was ever
// accepted). This polls the NP API — authenticated by the API KEY, not the IPN
// secret — for every still-open crypto payment and drives it to the same
// terminal outcome the webhook would: settle `finished`, park funds-on-a-dead-
// charge for MANUAL_REVIEW, flag underpayments. settleAwaitingPayment is
// idempotent, so racing a (working) IPN is harmless.
//
// Scope:
//   • AWAITING payments older than a short grace (so we don't poll a charge the
//     client is still actively paying) — the stuck state this fixes.
//   • Recently-FAILED payments (< 8 days — NP addresses live ~7d): a real late
//     payment can still land after our 72h local expiry; `finished` here
//     resurrects it (resurrectFailed) so the money is never lost.

const AWAITING_GRACE_MS = 90_000;
const FAILED_LOOKBACK_MS = 8 * 86_400_000;
const MAX_PER_RUN = 50; // bound NP calls per sweep tick

export type ReconcileResult = { checked: number; settled: number; manualReview: number; underpaid: number; errors: number };

function notifId() {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function reconcileCryptoPayments(now = Date.now()): Promise<ReconcileResult> {
  const res: ReconcileResult = { checked: 0, settled: 0, manualReview: 0, underpaid: 0, errors: 0 };
  if (!process.env.NOWPAYMENTS_API_KEY) return res;

  const select = { id: true, externalRef: true, status: true, npStatus: true, orderId: true, clientId: true, client: { select: { id: true, name: true } } } as const;

  // AWAITING is the primary case (a stuck, unsettled payment) — poll ALL of it
  // first with its own budget. It's naturally bounded: the sweep's 72h timeout
  // (step 3) moves every AWAITING to a terminal state, so this set can't grow
  // unbounded or older than ~72h.
  const awaiting = await prisma.payment.findMany({
    where: { provider: 'NOWPayments', externalRef: { not: null }, status: 'AWAITING', createdAt: { lte: new Date(now - AWAITING_GRACE_MS) } },
    select, orderBy: { createdAt: 'asc' }, take: MAX_PER_RUN,
  });

  // Then, with whatever budget remains, re-check recently-FAILED charges for a
  // LATE payment (NP addresses live ~7d) — but ONLY those NP hasn't already
  // told us are terminally dead. Once we've mirrored a terminal npStatus
  // (failed/expired/refunded → no funds, will never become finished), the row
  // is excluded so it can't waste API calls every tick for 8 days or crowd out
  // AWAITING (review finding). Newest-first — a recent failure is likeliest to
  // still settle late.
  const remaining = MAX_PER_RUN - awaiting.length;
  const failed = remaining > 0
    ? await prisma.payment.findMany({
        where: {
          provider: 'NOWPayments', externalRef: { not: null }, status: 'FAILED',
          createdAt: { gte: new Date(now - FAILED_LOOKBACK_MS) },
          NOT: { npStatus: { in: ['failed', 'expired', 'refunded'] } },
        },
        select, orderBy: { createdAt: 'desc' }, take: remaining,
      })
    : [];

  const candidates = [...awaiting, ...failed];

  for (const p of candidates) {
    try {
      res.checked++;
      const np = await npGetPayment(p.externalRef!);
      if (!np) continue;
      const npStatus = String(np.payment_status ?? '');
      if (!npStatus) continue;

      // Mirror the NP status for admin visibility (display-only, like the
      // webhook). updateMany → a since-settled row is a harmless no-op.
      if (npStatus !== p.npStatus) {
        await prisma.payment.updateMany({ where: { id: p.id }, data: { npStatus } });
      }

      const paid = Number(np.actually_paid);
      const fundsArrived = Number.isFinite(paid) && paid > 0;

      if (npStatus === 'finished') {
        const r = await settleAwaitingPayment(p.id, 'NOWPayments reconcile', { resurrectFailed: true });
        if (!('already' in r)) res.settled++;
        continue;
      }

      // Funds landed on a charge that then died — real money, needs a human.
      // Mirror the webhook: park in MANUAL_REVIEW (durable admin surface) +
      // alert. Only from AWAITING (a FAILED row here had no funds by definition
      // of our local expiry, and MANUAL_REVIEW must not overwrite a settled row).
      if ((npStatus === 'failed' || npStatus === 'expired') && fundsArrived && p.status === 'AWAITING') {
        const upd = await prisma.payment.updateMany({ where: { id: p.id, status: 'AWAITING' }, data: { status: 'MANUAL_REVIEW' } });
        if (upd.count > 0) {
          res.manualReview++;
          await prisma.log.create({
            data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: p.id, detail: `Reconcile: NP charge ${npStatus} but funds arrived — received ${np.actually_paid ?? '?'} ${np.pay_currency ?? ''} of ${np.pay_amount ?? '?'} → manual review` },
          });
          await alertAttention(p, `charge ${npStatus} but funds arrived (reconcile)`, np);
        }
        continue;
      }

      // Underpaid — money arrived, not enough. Log + alert once (first time we
      // see it; dedup on the mirrored npStatus).
      if (npStatus === 'partially_paid' && p.npStatus !== 'partially_paid' && p.status === 'AWAITING') {
        res.underpaid++;
        await prisma.log.create({
          data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: p.id, detail: `Reconcile: partially paid — received ${np.actually_paid ?? '?'} ${np.pay_currency ?? ''} of ${np.pay_amount ?? '?'}` },
        });
        await alertAttention(p, 'underpaid (reconcile)', np);
      }
    } catch (e) {
      res.errors++;
      console.error(`[np-reconcile] failed for ${p.id}`, e);
    }
  }
  return res;
}

async function alertAttention(
  p: { id: string; orderId: string | null; client: { id: string; name: string | null } | null },
  reason: string,
  np: Record<string, any>,
) {
  try {
    const cur = String(np.pay_currency ?? '').toUpperCase();
    await sendAdminTelegram(adminCryptoAttentionAlert({
      paymentId: p.id,
      reason,
      clientName: p.client?.name ?? p.client?.id ?? '—',
      clientId: p.client?.id ?? '—',
      received: `${np.actually_paid ?? '?'} ${cur}`.trim(),
      expected: `${np.pay_amount ?? '?'} ${cur}`.trim(),
      orderRef: p.orderId ?? 'balance top-up',
      adminUrl: appUrl(`/admin/payments/${p.id}`),
    }));
  } catch (e) {
    console.warn(`[np-reconcile] attention alert failed for ${p.id}`, e);
  }
}
