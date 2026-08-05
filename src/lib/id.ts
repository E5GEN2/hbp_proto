import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

// ID allocation (audit B-5 close-out).
//
// ORD-/PAY-/TCK- ids are RANDOM by product rule: they must not leak volume or
// be guessable, only uniqueness is guaranteed. 5 crypto-random digits + a
// pre-check; the primary key is the hard guarantee. On the rare repeated draw
// the generator widens to 6+ digits instead of failing.
//
// PXY- is RANDOM PER BATCH (owner 2026-08-04): the FIRST proxy of a registration
// batch gets a random base, the REST run sequentially from it (PXY-48213,
// PXY-48214, …) — random base hides volume, the contiguous run keeps one
// order's proxies grouped and easy to read. See nextProxyIdBatch.
//
// INV/USR/ASN stay sequential — invoices deliberately so (accounting) — via
// Postgres sequences (migration 20260706090000), atomic under concurrency.
// (proxy_id_seq / ticket_id_seq are now unused, kept only to avoid a migration.)

type Db = PrismaClient | Prisma.TransactionClient;

// Web Crypto (globalThis.crypto) — available in Node 20 AND the edge bundle
// webpack builds for instrumentation.ts; the 'crypto' Node builtin is not.
// Uniform integer in [0, maxExclusive) via rejection sampling.
function uniformInt(maxExclusive: number) {
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

function randomDigits(len: number) {
  return uniformInt(10 ** len).toString().padStart(len, '0');
}

async function uniqueRandomId(prefix: string, exists: (id: string) => Promise<boolean>) {
  // 4 tries at 5 digits, then widen by a digit per attempt as a safety valve.
  for (let attempt = 0; attempt < 8; attempt++) {
    const len = 5 + Math.max(0, attempt - 3);
    const id = `${prefix}${randomDigits(len)}`;
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

// A batch of `count` proxy ids: FIRST random, the REST sequential from it
// (owner rule). The whole run keeps one digit-width and the entire range is
// checked free before returning (the PK is still the hard uniqueness guarantee).
export async function nextProxyIdBatch(db: Db = prisma, count: number): Promise<string[]> {
  if (count < 1) return [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const len = 5 + Math.max(0, attempt - 3);
    const span = 10 ** len;
    if (count > span - 1) throw new Error('Proxy batch too large for the id space');
    // base in [1, span-count] → base+count-1 < span, so no rollover / width jump.
    const base = 1 + uniformInt(span - count);
    const ids = Array.from({ length: count }, (_, k) => `PXY-${String(base + k).padStart(len, '0')}`);
    const clash = await db.proxy.findFirst({ where: { id: { in: ids } }, select: { id: true } });
    if (!clash) return ids;
  }
  throw new Error('Could not allocate a unique PXY id batch');
}

export async function nextProxyId(db: Db = prisma) {
  return (await nextProxyIdBatch(db, 1))[0];
}

export async function nextAssignmentId(db: Db = prisma) {
  const n = await nextFromSequence(db, 'assignment_id_seq');
  return `ASN-${String(n).padStart(5, '0')}`;
}

export function nextTicketId(db: Db = prisma) {
  return uniqueRandomId('TCK-', async id =>
    Boolean(await db.ticket.findUnique({ where: { id }, select: { id: true } })));
}

export function randomPaymentMethodId() {
  return `pm_${Math.random().toString(36).slice(2, 12)}`;
}
