import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma-only / libpq-only URL parameters. pg ignores most of them and
// MISREADS sslmode (prefer/require/verify-ca all become verify-full, which
// rejects Railway's self-signed certificate), so they are lifted out of the
// connection string and translated below.
const PRISMA_URL_PARAMS = [
  'schema', 'sslmode', 'sslaccept', 'sslcert', 'sslidentity', 'sslpassword',
  'connection_limit', 'pool_timeout', 'connect_timeout', 'socket_timeout',
  'pgbouncer', 'statement_cache_size',
];

// Prisma 7 reaches Postgres through the pg driver adapter (no Rust query
// engine). The connection pool is pg's, not Prisma 6's: `connection_limit`
// still sets its size (default 10), and pg has no connect timeout by default —
// set to 12 s so an exhausted pool surfaces as Prisma's P2028 (maxWait 10 s
// below) rather than pg's bare "timeout exceeded when trying to connect".
function makeClient() {
  const raw = process.env.DATABASE_URL;
  // Unset: keep Prisma 5's behaviour — construction succeeds (pure modules
  // import this at load time, e.g. the assertion suites), the first query
  // fails. Loud here, fatal there.
  if (!raw) console.error('[prisma] DATABASE_URL is not set — every query will fail until it is');
  const url = new URL(raw || 'postgresql://unset@127.0.0.1:5432/unset');
  const q = url.searchParams;
  const schema = q.get('schema') ?? undefined;
  const sslmode = q.get('sslmode');
  const max = Number(q.get('connection_limit')) || 10;
  for (const k of PRISMA_URL_PARAMS) q.delete(k);
  // prefer / require: Prisma never verified the certificate either. pg does
  // not fall back to plaintext for `prefer` — the server must offer TLS
  // (Railway's public proxy does; the internal URL carries no sslmode and
  // connects in plaintext, as before).
  const ssl = !sslmode || sslmode === 'disable' ? undefined
    : sslmode === 'verify-full' || sslmode === 'verify-ca' ? true
    : { rejectUnauthorized: false };
  const adapter = new PrismaPg(
    { connectionString: url.toString(), connectionTimeoutMillis: 12_000, max, ssl },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    // Interactive-transaction budget. The default 5s aborted a live admin
    // Assign whose first statement (SELECT … FOR UPDATE on the order row)
    // waited ~6.6s on a lock (2026-08-22, P2028 "Transaction already closed").
    // Every money/lifecycle tx here is status-guarded + idempotent, so waiting
    // out contention is the correct behaviour — aborting is the bug. maxWait =
    // time to obtain a connection; timeout = total tx lifetime.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
