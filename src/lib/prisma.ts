import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    // Interactive-transaction budget. The default 5s aborted a live admin
    // Assign whose first statement (SELECT … FOR UPDATE on the order row)
    // waited ~6.6s on a lock (2026-08-22, P2028 "Transaction already closed").
    // Every money/lifecycle tx here is status-guarded + idempotent, so waiting
    // out contention is the correct behaviour — aborting is the bug. maxWait =
    // time to obtain a connection; timeout = total tx lifetime.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
