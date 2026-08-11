import { prisma } from './prisma';
import { settleAwaitingPayment } from './settle-payment';
import { npGetPayment } from './np-api';
import { sendAdminTelegram, adminCryptoAttentionAlert } from './telegram';
import { appUrl } from './app-url';
import { RESURRECTABLE_STATUSES } from './crypto-window';

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

  // AWAITING is the primary case (a stuck, unsettled payment) — poll it first
  // with its own budget. Now that abandoned charges stay AWAITING for up to 72h
  // (expired IPNs no longer fail them), the set can hold many dead carts whose
  // npStatus is already 'expired'/'failed'; polling those oldest-first every
  // tick could starve genuinely-live charges of the 50-call budget (audit C3).
  // Prioritise LIVE-looking rows (npStatus null/waiting/confirming/…) — a
  // freshly-detected transfer must never wait behind a week of dead carts —
  // then spend any leftover budget on the already-expired ones (to catch late
  // funds landing on them). A dead cart polled once per few ticks is fine; a
  // live payment polled late is a stuck order.
  const liveish = await prisma.payment.findMany({
    where: {
      provider: 'NOWPayments', externalRef: { not: null }, status: 'AWAITING',
      createdAt: { lte: new Date(now - AWAITING_GRACE_MS) },
      // ⚠️ NULL-SAFETY (the PR #150 lesson, re-learned here): a bare
      // `NOT { npStatus: { in: [...] } }` compiles to SQL `NOT (npStatus IN
      // (...))`, which is NULL for a NULL npStatus → the row is dropped. A
      // never-polled charge has npStatus NULL and is the MOST live case there
      // is (no IPN has ever arrived — precisely the PAY-57160 stuck-payment
      // class this reconciler exists for). It would fall out of BOTH this
      // query and the dead-cart one below and never be reconciled. Spell the
      // null branch out explicitly.
      OR: [
        { npStatus: null },
        { npStatus: { notIn: ['expired', 'failed'] } },
      ],
    },
    select, orderBy: { createdAt: 'asc' }, take: MAX_PER_RUN,
  });
  const awaitingBudget = MAX_PER_RUN - liveish.length;
  const deadCarts = awaitingBudget > 0
    ? await prisma.payment.findMany({
        where: {
          provider: 'NOWPayments', externalRef: { not: null }, status: 'AWAITING',
          createdAt: { lte: new Date(now - AWAITING_GRACE_MS) },
          npStatus: { in: ['expired', 'failed'] },
        },
        select, orderBy: { createdAt: 'asc' }, take: awaitingBudget,
      })
    : [];
  const awaiting = [...liveish, ...deadCarts];

  // Then, with whatever budget remains, re-check recently-FAILED charges. Two
  // things can still happen to a locally-FAILED charge while the NP address
  // lives (~7d): a late `finished` (resurrect-settle), and — the routine shape
  // under the account's ~10-min fixed-rate kill — funds LANDING on a charge
  // whose npStatus is already terminal ('expired' with actually_paid>0). The
  // old version excluded terminal-npStatus rows to save API budget, which
  // permanently foreclosed the second case: the webhook mirrors 'expired'
  // BEFORE any local flip, so every dead charge was excluded and late money
  // became invisible outside the NP dashboard (audit 2026-08-11, P0). Poll
  // them all while inside the lookback; the budget cap + newest-first ordering
  // keep the cost bounded, and AWAITING always goes first.
  //   CANCELLED is polled alongside FAILED: the sweep no longer produces
  //   cancelled charges, but a client/admin cancel still does, and NP has no
  //   cancel API — that address stays payable for ~7 days, so a cancelled
  //   charge can genuinely reach `finished`. Settle resurrects it into the
  //   cancelled-order park (re-review C1/C2), which needs someone to notice
  //   it in the first place; this is that someone when IPNs are down.
  //   MANUAL_REVIEW too: a parked charge whose transfer later completes at NP
  //   should auto-resolve (settle resurrects it and activates the order, or
  //   re-parks silently if the order is cancelled). Without it, parking a row
  //   removed it from every poller and only a human could ever finish it —
  //   exactly the stuck state this reconciler exists to prevent.
  const remaining = MAX_PER_RUN - awaiting.length;
  const failed = remaining > 0
    ? await prisma.payment.findMany({
        where: {
          provider: 'NOWPayments', externalRef: { not: null },
          // Exactly the set settle can revive — one source of truth, so a
          // status added there can never be forgotten here (re-review C7).
          status: { in: [...RESURRECTABLE_STATUSES] },
          createdAt: { gte: new Date(now - FAILED_LOOKBACK_MS) },
        },
        select, orderBy: { createdAt: 'desc' }, take: remaining,
      })
    : [];

  // De-dup by id: the two AWAITING reads are separate statements, so a row
  // whose npStatus flips between them can land in both lists — polling it
  // twice in one tick would double-count and re-alert (re-review C12).
  const seen = new Set<string>();
  const candidates = [...awaiting, ...failed].filter(p => !seen.has(p.id) && seen.add(p.id));

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
        // A settle onto a cancelled order parks instead of crediting — count
        // it where ops actually look for it (re-review C11).
        if ('kind' in r && r.kind === 'review') res.manualReview++;
        else if (!('already' in r)) res.settled++;
        continue;
      }

      // Funds landed on a charge that then died — real money, needs a human.
      // Mirror the webhook: park in MANUAL_REVIEW (durable admin surface) +
      // alert. From AWAITING *and* FAILED — a FAILED row here can absolutely
      // carry funds now (the 10-min kill fails charges minutes before an
      // in-flight transfer confirms; repay retirement does the same). The
      // guarded updateMany dedups: once parked, later ticks no-op.
      if ((npStatus === 'failed' || npStatus === 'expired') && fundsArrived
          && (p.status === 'AWAITING' || p.status === 'FAILED' || p.status === 'CANCELLED')) {
        const upd = await prisma.payment.updateMany({ where: { id: p.id, status: { in: ['AWAITING', 'FAILED', 'CANCELLED'] } }, data: { status: 'MANUAL_REVIEW' } });
        if (upd.count > 0) {
          res.manualReview++;
          await prisma.log.create({
            data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: p.id, detail: `Reconcile: NP charge ${npStatus} but funds arrived — received ${np.actually_paid ?? '?'} ${np.pay_currency ?? ''} of ${np.pay_amount ?? '?'} → manual review` },
          });
          await alertAttention(p, `charge ${npStatus} but funds arrived (reconcile)`, np);
        }
        continue;
      }

      // Underpaid — money arrived, not enough. On a live AWAITING charge: log
      // + alert once (dedup on the mirrored npStatus), no state change — the
      // client may still send the remainder. On a locally-FAILED charge that
      // is funds-on-a-dead-charge → park for review (mirrors the webhook).
      if (npStatus === 'partially_paid' && (p.status === 'FAILED' || p.status === 'CANCELLED')) {
        const upd = await prisma.payment.updateMany({ where: { id: p.id, status: { in: ['FAILED', 'CANCELLED'] } }, data: { status: 'MANUAL_REVIEW' } });
        if (upd.count > 0) {
          res.manualReview++;
          await prisma.log.create({
            data: { actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: p.id, detail: `Reconcile: partial funds on a dead charge — received ${np.actually_paid ?? '?'} ${np.pay_currency ?? ''} of ${np.pay_amount ?? '?'} → manual review` },
          });
          await alertAttention(p, 'partial funds on a dead charge (reconcile)', np);
        }
        continue;
      }
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
