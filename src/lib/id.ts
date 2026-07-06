import crypto from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

// ID allocation (audit B-5 close-out).
//
// ORD-/PAY- ids are RANDOM by product rule (2026-07-06): they must not leak
// order volume or be guessable, only uniqueness is guaranteed. 8 crypto-random
// digits + a pre-check; the primary key is the hard guarantee — the collision
// window between check and insert is ~1e-8 and would surface as a failed
// request, never as a duplicate.
//
// Everything else (INV/USR/PXY/ASN/TCK) stays sequential — invoices deliberately
// so (accounting) — via Postgres sequences (migration 20260706090000), which
// are atomic under concurrency, unlike the old table-scan max+1.

type Db = PrismaClient | Prisma.TransactionClient;

function randomDigits(len: number) {
  return crypto.randomInt(0, 10 ** len).toString().padStart(len, '0');
}

async function uniqueRandomId(prefix: string, exists: (id: string) => Promise<boolean>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `${prefix}${randomDigits(8)}`;
    if (!(await exists(id))) return id;
  }
  throw new Error(`Could not allocate a unique ${prefix} id`);
}

export function nextOrderId() {
  return uniqueRandomId('ORD-', async id =>
    Boolean(await prisma.order.findUnique({ where: { id }, select: { id: true } })));
}

export function nextPaymentId() {
  return uniqueRandomId('PAY-', async id =>
    Boolean(await prisma.payment.findUnique({ where: { id }, select: { id: true } })));
}

// Sequences are non-transactional by design (gaps on rollback are fine);
// passing a tx client just reuses its connection.
async function nextFromSequence(db: Db, seq: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT nextval('${seq}')::int AS n`);
  return rows[0].n;
}

export async function nextInvoiceId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'invoice_id_seq');
  return `INV-${String(n).padStart(5, '0')}`;
}

export async function nextUserId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'user_id_seq');
  return `USR-${String(n).padStart(5, '0')}`;
}

export async function nextProxyId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'proxy_id_seq');
  return `PXY-${String(n).padStart(5, '0')}`;
}

export async function nextAssignmentId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'assignment_id_seq');
  return `ASN-${String(n).padStart(5, '0')}`;
}

export async function nextTicketId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'ticket_id_seq');
  return `TCK-${String(n).padStart(5, '0')}`;
}

export function randomPaymentMethodId() {
  return `pm_${Math.random().toString(36).slice(2, 12)}`;
}
