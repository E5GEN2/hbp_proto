// Auto-renew charge execution (Phase 3, user sign-off 2026-07-06).
//
// Waterfall per product spec: client balance first; any remainder goes to the
// card on file. No real card processor is integrated yet — the card leg is
// chargeable only while ALLOW_MOCK_PAYMENTS permits (same rule as the manual
// card checkout); once Stripe lands, this is the slot it plugs into. If
// neither source covers the price, the sweep moves the order into the plan's
// grace window (or expires it) — see sweep.ts.

import { prisma } from './prisma';
import { nextPaymentId, nextInvoiceId } from './id';
import { renewalUnitPrice } from './renewal';
import { mockPaymentsAllowed } from './runtime-flags';
import { fmtDate } from './date';
import { money } from './money';
import { debitBalance, InsufficientBalance } from './balance';
import type { Prisma } from '@prisma/client';

export type OrderForAutoRenew = Prisma.OrderGetPayload<{ include: { plan: true; client: true } }>;

export type AutoRenewOutcome =
  | { renewed: true; newExpiry: Date; via: string }
  | { renewed: false; reason: string };

class AutoRenewFail extends Error {}

function notifId() {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function attemptAutoRenew(order: OrderForAutoRenew): Promise<AutoRenewOutcome> {
  if (!order.plan.renewalAllowed) return { renewed: false, reason: 'renewals are disabled for this plan' };

  // A renewal payment the client already started (e.g. crypto awaiting
  // confirmation) must not be stacked with an automatic charge.
  const pending = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'AWAITING' } });
  if (pending) return { renewed: false, reason: `renewal payment ${pending.id} already awaiting confirmation` };

  const price = renewalUnitPrice(Number(order.plan.price), order.plan.renewalDiscountPct) * order.qty;
  const paymentId = await nextPaymentId();
  const now = new Date();
  let newExpiry = now; // real value assigned in-tx from the FRESH expiry base
  let via = 'balance';

  try {
    await prisma.$transaction(async tx => {
      // Fresh in-tx re-read (review find): the sweep snapshot may be stale —
      // a client renewal committed in between moved expiresAt, and extending
      // from the stale base would swallow the period they just paid for. The
      // status guard mirrors the sweep's expiry-step TOCTOU re-read: never
      // charge an order that stopped being ACTIVE since the snapshot.
      const freshOrd = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, expiresAt: true, exception: true } });
      if (!freshOrd || freshOrd.status !== 'ACTIVE') {
        throw new AutoRenewFail(`order is ${freshOrd ? freshOrd.status.toLowerCase() : 'gone'} — no charge attempted`);
      }
      const base = freshOrd.expiresAt && freshOrd.expiresAt > now ? freshOrd.expiresAt : now;
      newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);

      const me = await tx.user.findUnique({ where: { id: order.clientId } });
      if (!me) throw new AutoRenewFail('client account not found');

      const balance = Number(me.balance);
      const balancePart = Math.round(Math.min(balance, price) * 100) / 100;
      const cardPart = Math.round((price - balancePart) * 100) / 100;

      let cardLabel: string | null = null;
      if (cardPart > 0) {
        const card = await tx.paymentMethod.findFirst({
          where: { userId: order.clientId, kind: 'CARD' },
          orderBy: [{ isDefault: 'desc' }, { addedAt: 'desc' }],
        });
        if (!card) {
          throw new AutoRenewFail(`insufficient balance (${money(balance)} of ${money(price)}) and no card on file`);
        }
        if (!mockPaymentsAllowed()) {
          throw new AutoRenewFail(`insufficient balance (${money(balance)} of ${money(price)}) — card charging is not available yet`);
        }
        cardLabel = `card •• ${card.last4 ?? '????'}`;
      }

      via = cardPart > 0
        ? (balancePart > 0 ? `balance ${money(balancePart)} + ${cardLabel} ${money(cardPart)}` : `${cardLabel}`)
        : 'balance';

      const fees = cardPart > 0 ? Math.round(cardPart * 3) / 100 : 0;
      await tx.payment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          clientId: order.clientId,
          provider: cardPart > 0 ? 'Stripe' : 'Balance',
          method: `Auto-renew · ${via}`,
          gross: price,
          fees,
          net: price - fees,
          status: 'CONFIRMED',
          confirmedAt: now,
          source: 'auto-renew',
        },
      });

      if (balancePart > 0) {
        // Guarded in-tx debit (P1-1): balancePart came from the read above —
        // if a concurrent spend drained the account in between, fail the
        // attempt cleanly and let the next sweep tick retry.
        let newBal: number;
        try { newBal = await debitBalance(tx, order.clientId, balancePart); }
        catch (e) {
          if (e instanceof InsufficientBalance) throw new AutoRenewFail('balance changed during charge');
          throw e;
        }
        await tx.balanceLedgerEntry.create({
          data: {
            userId: order.clientId, op: 'ORDER_DEBIT', amount: -balancePart, balanceAfter: newBal,
            refOrderId: order.id, refPaymentId: paymentId, note: `Auto-renew of ${order.id}`,
          },
        });
      }

      const invoiceId = await nextInvoiceId(tx);
      await tx.invoice.create({
        data: { id: invoiceId, paymentId, orderId: order.id, clientId: order.clientId, amount: price },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          expiresAt: newExpiry,
          status: 'ACTIVE',
          renewalBucket: 'RENEWED',
          lastReminderAt: null,
          autoRenewLastAttemptAt: null,
          exception: freshOrd.exception === 'RENEWAL_NOT_EXTENDED' ? null : freshOrd.exception,
        },
      });

      await tx.log.create({
        data: {
          actorId: null, action: 'ORDER.EXTEND', objectType: 'ORDER', objectId: order.id,
          detail: `Auto-renewed by sweep · ${via} · ${money(price)} · new expiry ${newExpiry.toISOString().slice(0, 10)}`,
        },
      });
      await tx.notification.create({
        data: {
          id: notifId(), userId: order.clientId,
          title: `Order ${order.id} auto-renewed — new expiry ${fmtDate(newExpiry)}`,
          kind: 'SUCCESS', link: `/orders/${order.id}`,
        },
      });
    });
  } catch (e) {
    if (e instanceof AutoRenewFail) return { renewed: false, reason: e.message };
    throw e;
  }

  return { renewed: true, newExpiry, via };
}
