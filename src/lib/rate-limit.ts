// Minimal in-memory sliding-window rate limiter. The app runs as a single
// long-lived server instance, so process memory is a sufficient store;
// counters reset on redeploy, which is fine for abuse throttling.
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;
const STALE_MS = 2 * 60 * 60 * 1000; // just above the largest window in use
const SWEEP_EVERY_MS = 60 * 1000;
let lastSweepAt = 0;

function sweep(now: number) {
  if (buckets.size <= MAX_KEYS || now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  for (const [key, hits] of buckets) {
    if ((hits[hits.length - 1] ?? 0) < now - STALE_MS) buckets.delete(key);
  }
}

/** Records a hit; returns 0 when allowed, otherwise seconds until the window frees up. */
export function hitRateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  sweep(now);
  const hits = (buckets.get(key) ?? []).filter(t => t > now - windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
  }
  hits.push(now);
  buckets.set(key, hits);
  return 0;
}

/**
 * Best-effort client IP. Railway's current staff guidance says the edge
 * strips client-supplied x-forwarded-for and writes the real connecting IP
 * as the FIRST entry — but staff statements have contradicted each other
 * over the years, so treat the contract as unverified: AUTH.REGISTER log
 * rows record the raw headers so it can be checked against real traffic
 * after deploy. First-hop worst case is limiter bypass (the pre-limiter
 * status quo); last-hop worst case would collapse all clients into one
 * bucket and lock registration globally — hence first-hop.
 */
export function clientIp(req: Request): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip')?.trim() || 'unknown';
}
