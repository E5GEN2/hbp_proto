// Minimal in-memory sliding-window rate limiter. The app runs as a single
// long-lived server instance, so process memory is a sufficient store;
// counters reset on redeploy, which is fine for abuse throttling.
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;
const STALE_MS = 24 * 60 * 60 * 1000; // must exceed the largest window in use

function sweep(now: number) {
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] < now - STALE_MS) buckets.delete(key);
  }
}

/** Records a hit; returns 0 when allowed, otherwise seconds until the window frees up. */
export function hitRateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) sweep(now);
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
 * Client IP behind the Railway edge proxy. The LAST x-forwarded-for hop is the
 * one written by the trusted proxy — earlier entries can be spoofed by the
 * client to rotate identities past the limiter.
 */
export function clientIp(req: Request): string {
  const hops = req.headers.get('x-forwarded-for')?.split(',');
  const last = hops?.[hops.length - 1]?.trim();
  return last || req.headers.get('x-real-ip')?.trim() || 'unknown';
}
