// Sign-in audit (AUTH.LOGIN / AUTH.LOGIN_FAILED) — pure helpers so the row
// format is unit-tested (scripts/test-auth-audit.ts) without a DB or NextAuth.
//
// Why it exists (Railway incident 2026-10-21): the logs table had REGISTER /
// VERIFY / RESET rows but never a sign-in, so "who signed in, from where, and
// who kept failing" could not be answered from our own data. These rows feed
// the admin Logs → Auth tab and the client page's activity feed.
//
// Limits, stated honestly: only CREDENTIAL sign-ins pass through authorize().
// A session token forged with a leaked NEXTAUTH_SECRET never does — rotating
// the secret is the only answer to that, not a log line.

export const AUTH_LOGIN = 'AUTH.LOGIN';
export const AUTH_LOGIN_FAILED = 'AUTH.LOGIN_FAILED';

export type LoginFailure = 'unknown_email' | 'wrong_password' | 'blocked';

const UA_MAX = 80;

/** User-agent trimmed for a log line: control characters and whitespace runs
    collapsed (no log-line injection), capped at UA_MAX. */
export function trimUa(ua: string | undefined | null): string {
  const clean = (ua ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '—';
  return clean.length > UA_MAX ? clean.slice(0, UA_MAX - 1) + '…' : clean;
}

const DOMAIN_MAX = 64;

/** `n***@example.com` — enough to recognise a typo'd own address in the
    admin log, not enough to harvest addresses from it. The address is
    attacker-controlled (the credentials form has no length limit), so the
    tail is sanitised like a user-agent and capped at DOMAIN_MAX. */
export function maskEmail(email: string): string {
  const clean = (email ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, '').slice(0, 254);
  const at = clean.indexOf('@');
  if (at <= 0) return '***';
  const domain = clean.slice(at + 1);
  const tail = domain.length > DOMAIN_MAX ? domain.slice(0, DOMAIN_MAX - 1) + '…' : domain;
  return `${clean[0]}***@${tail}`;
}

function roleLabel(role: string): string {
  return role.toLowerCase().replace(/_/g, ' ');
}

export function loginDetail(o: { ip: string; ua?: string | null; role: string }): string {
  return `Signed in from ${o.ip} · ${roleLabel(o.role)} · ${trimUa(o.ua)}`;
}

const FAILURE_TEXT: Record<Exclude<LoginFailure, 'unknown_email'>, string> = {
  wrong_password: 'wrong password',
  blocked: 'account blocked',
};

// unknown_email carries the masked address (the only way to tell a typo from
// an attack on a known account); the other two already point at a user row
// via objectId, so the address is not repeated.
export function loginFailedDetail(o: { ip: string; ua?: string | null; reason: LoginFailure; email: string }): string {
  const why = o.reason === 'unknown_email' ? `unknown email ${maskEmail(o.email)}` : FAILURE_TEXT[o.reason];
  return `Sign-in failed from ${o.ip} · ${why} · ${trimUa(o.ua)}`;
}

/** authorize()'s req.headers is a plain object (lower- or mixed-case keys),
    not a Fetch Headers — same shape loginIp() in auth.ts reads. */
export function loginUa(req: unknown): string {
  const h = ((req as { headers?: Record<string, string | string[] | undefined> })?.headers) ?? {};
  const v = h['user-agent'] ?? h['User-Agent'];
  return trimUa(Array.isArray(v) ? v[0] : v);
}
