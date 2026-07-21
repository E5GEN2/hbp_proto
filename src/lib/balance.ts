// P1-1 (owner decision 2026-07-21): the balance model is snapshot + append-only
// ledger, HARDENED. Every users.balance mutation goes through these helpers:
//
//  · atomic {increment}/{decrement} — the old read-compute-set pattern lost
//    updates under concurrency: the ledger kept BOTH rows while balance kept
//    only the last absolute write → silent SUM(ledger) ≠ balance drift that
//    nothing would ever detect (the ledger is write-only).
//  · the spend-guard lives INSIDE the row update (WHERE balance >= amount) —
//    the old guards read the balance before (sometimes outside) the enclosing
//    transaction, so two concurrent spends could both pass and double-spend.
//
// The returned balanceAfter feeds the ledger row's running snapshot; when
// writers interleave, SUM(amount) stays the authoritative record.
//
// Reconciliation query (goes into the P4-1 invariant script):
//   SELECT u.id, u.balance, COALESCE(SUM(l.amount), 0) AS ledger_sum
//   FROM users u LEFT JOIN balance_ledger l ON l."userId" = u.id
//   GROUP BY u.id, u.balance
//   HAVING u.balance <> COALESCE(SUM(l.amount), 0);

import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export class InsufficientBalance extends Error {
  constructor() { super('Insufficient balance'); this.name = 'InsufficientBalance'; }
}

// Normalize to whole cents BEFORE the SQL sees the value: the columns are
// Decimal(12,2) and round independently per column — a sub-cent amount (e.g.
// admin-typed 16.995) would round one way in the balance decrement and the
// other way in the ledger row, permanently drifting SUM(ledger) vs balance
// by a cent (review find). Callers that accept RAW user input must normalize
// their local variable with roundCents() too, so the ledger row they write
// carries the exact value the helper applied.
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function cents(amount: number): number {
  const v = roundCents(amount);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid balance amount: ${amount}`);
  return v;
}

/** Atomically credit `amount` (> 0) to the user. Returns the fresh balance. */
export async function creditBalance(tx: Tx, userId: string, rawAmount: number): Promise<number> {
  const amount = cents(rawAmount);
  const u = await tx.user.update({
    where: { id: userId },
    data: { balance: { increment: amount } },
    select: { balance: true },
  });
  return Number(u.balance);
}

/**
 * Atomically debit `amount` (> 0) — the guard is part of the UPDATE, so a
 * concurrent spend can never push the balance negative. Throws
 * InsufficientBalance when the row no longer covers the amount.
 */
export async function debitBalance(tx: Tx, userId: string, rawAmount: number): Promise<number> {
  const amount = cents(rawAmount);
  const r = await tx.user.updateMany({
    where: { id: userId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (r.count === 0) throw new InsufficientBalance();
  // Own-tx read sees the decrement; a concurrent writer blocks on the row
  // lock until we commit, so this snapshot is consistent for the ledger row.
  const u = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
  return Number(u!.balance);
}
