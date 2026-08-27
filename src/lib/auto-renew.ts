// Auto-renew charge execution (Phase 3, 2026-07-06; balance-only per owner
// decision 2026-08-22).
//
// The charge comes from the client's PORTAL BALANCE, full price or nothing —
// cards are not implemented, so there is no card leg and no partial charge.
// Insufficient balance → the attempt fails cleanly and the sweep moves the
// order into the client's grace window (retrying every 24h) or expires it —
// see sweep.ts. When a real card processor lands, its slot is the
// InsufficientBalance branch below.

import { prisma } from './prisma';
import { nextPaymentId, nextInvoiceId } from './id';
import { fmtDate } from './date';
import { money } from './money';
import { debitBalance, InsufficientBalance } from './balance';
import { renewalBase, renewalPricing, consumeRenewalDiscountCycle } from './renewal';
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
  // confirmation) must not be stacked with an automatic charge — nor may one
  // whose funds arrived and are under verification (MANUAL_REVIEW), which
  // would charge the client twice for the same term (re-review C2).
  // AWAITING is scoped to STAMPED (renewal-originated) charges (R3, matches
  // clientRenewOrder): an AWAITING PURCHASE charge under manual-fulfillment
  // override is not a renewal in flight — the broad check auto-renew-starved
  // such orders every tick with a mislabelled reason.
  const pending = await prisma.payment.findFirst({
    where: { OR: [
      { orderId: order.id, status: 'MANUAL_REVIEW' },
      { orderId: order.id, status: 'AWAITING', renewalDiscountApplied: { not: null } },
      // A split-payment top-up in flight will extend this order from balance at
      // settle — don't also auto-charge it (split payment).
      { autoPayOrderId: order.id, status: 'AWAITING' },
    ] },
  });
  if (pending) return { renewed: false, reason: `payment ${pending.id} for this order is already ${pending.status === 'AWAITING' ? 'awaiting confirmation' : 'under verification'}` };

  // Per-order renewal discount (admin grant) replaces the plan and client
  // discounts while active; otherwise max(client, plan) applies. renewalPricing
  // is the single source for all of them (audit B-6 parity).
  const pricing = renewalPricing(order.plan, order, order.client);
  const price = pricing.total;
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
      // Serialize with the other renewal writers (R3) BEFORE reading state —
      // see clientRenewOrder: an uncommitted concurrent renewal is invisible
      // to plain reads; the row lock makes the loser wait and see it.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const parkedNow = await tx.payment.findFirst({
        where: { OR: [{ orderId: order.id, status: 'MANUAL_REVIEW' }, { orderId: order.id, status: 'AWAITING', renewalDiscountApplied: { not: null } }, { autoPayOrderId: order.id, status: 'AWAITING' }] },
        select: { id: true },
      });
      if (parkedNow) throw new AutoRenewFail(`renewal payment ${parkedNow.id} appeared concurrently — no charge attempted`);
      const freshOrd = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, expiresAt: true, exception: true } });
      if (!freshOrd || freshOrd.status !== 'ACTIVE') {
        throw new AutoRenewFail(`order is ${freshOrd ? freshOrd.status.toLowerCase() : 'gone'} — no charge attempted`);
      }
      // Anchor on the ORIGINAL expiry so an auto-renew that fires slightly
      // after the due instant (the sweep runs on a tick) produces a contiguous,
      // drift-free term rather than a fresh window from `now` (renewal-policy
      // PR). renewalBase floors to `now` when a full term from expiry would land
      // in the past (a sweep/app outage longer than one term, or grace >
      // duration) — CRITICAL here: without that floor a stale past-due expiry
      // would yield newExpiry ≤ now, the order would stay in the due set, and
      // the null-reset of autoRenewLastAttemptAt below would re-charge it every
      // tick. The floor guarantees newExpiry > now, so it charges exactly once.
      const base = renewalBase(freshOrd.expiresAt, order.plan.durationDays, now);
      newExpiry = new Date(base.getTime() + order.plan.durationDays * 86_400_000);

      const me = await tx.user.findUnique({ where: { id: order.clientId } });
      if (!me) throw new AutoRenewFail('client account not found');

      // Balance-only (owner decision 2026-08-22): full price from the portal
      // balance or no charge at all — cards are not implemented, so there is
      // no card leg and never a partial debit.
      const balance = Number(me.balance);
      if (balance < price) {
        throw new AutoRenewFail(`insufficient balance (${money(balance)} of ${money(price)}) — top up to renew`);
      }

      await tx.payment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          clientId: order.clientId,
          provider: 'Balance',
          method: 'Auto-renew · balance',
          gross: price,
          fees: 0,
          net: price,
          status: 'CONFIRMED',
          confirmedAt: now,
          source: 'auto-renew',
          // Charge-time snapshot: did the per-order discount price this charge?
          renewalDiscountApplied: pricing.source === 'order',
        },
      });

      // $0 renewal (100% per-order grant or 100% client discount): nothing to
      // debit — debitBalance treats <= 0 as invalid, and the generic Error it
      // throws would escape AutoRenewFail handling and wedge the whole sweep
      // tick (adversarial review R2). The $0 CONFIRMED payment row above still
      // books the renewal; no ledger row for money that never moved.
      if (price > 0) {
        // Guarded in-tx debit (P1-1): `balance` came from the read above — if
        // a concurrent spend drained the account in between, fail the attempt
        // cleanly (tx rolls back, payment row included) and let the next
        // sweep tick retry.
        let newBal: number;
        try { newBal = await debitBalance(tx, order.clientId, price); }
        catch (e) {
          if (e instanceof InsufficientBalance) throw new AutoRenewFail('balance changed during charge');
          throw e;
        }
        await tx.balanceLedgerEntry.create({
          data: {
            userId: order.clientId, op: 'ORDER_DEBIT', amount: -price, balanceAfter: newBal,
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
      // Consume one discount cycle ONLY when the discount priced this charge
      // (atomic guarded decrement — never below 0, never eats a concurrent
      // re-grant; indefinite/exhausted are excluded by the SQL guard).
      if (pricing.source === 'order') await consumeRenewalDiscountCycle(tx, order.id);

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
