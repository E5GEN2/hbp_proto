// Standalone assertion test for the sign-in audit helpers (no test runner in
// the repo). Run: pnpm exec tsx scripts/test-auth-audit.ts
import { AUTH_LOGIN, AUTH_LOGIN_FAILED, trimUa, maskEmail, loginDetail, loginFailedDetail, loginUa } from '../src/lib/auth-audit';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
}

// ── action names: the logs page chip map and the Auth tab key on these ─────
eq('action names are stable', [AUTH_LOGIN, AUTH_LOGIN_FAILED], ['AUTH.LOGIN', 'AUTH.LOGIN_FAILED']);

// ── trimUa: a log line can never be split or stuffed by the UA ────────────
eq('trimUa: empty → dash', trimUa(''), '—');
eq('trimUa: undefined → dash', trimUa(undefined), '—');
eq('trimUa: null → dash', trimUa(null), '—');
eq('trimUa: newline + NUL + runs collapsed', trimUa('Mozilla/5.0\n(X11)\u0000   Linux\r\n'), 'Mozilla/5.0 (X11) Linux');
eq('trimUa: capped at 80 chars', trimUa('a'.repeat(200)).length, 80);
eq('trimUa: cap ends with an ellipsis', trimUa('a'.repeat(200)).endsWith('…'), true);
eq('trimUa: exactly 80 kept whole', trimUa('b'.repeat(80)), 'b'.repeat(80));

// ── maskEmail ─────────────────────────────────────────────────────────────
eq('maskEmail: first char + domain', maskEmail('nobody@example.com'), 'n***@example.com');
eq('maskEmail: no @ → opaque', maskEmail('garbage'), '***');
eq('maskEmail: @ first → opaque', maskEmail('@x.com'), '***');
eq('maskEmail: unicode local part', maskEmail('ñandu@x.io'), 'ñ***@x.io');
eq('maskEmail: 500 KB domain is capped', maskEmail('a@' + 'x'.repeat(500_000) + '.com').length <= 70, true);
eq('maskEmail: capped tail ends with an ellipsis', maskEmail('a@' + 'x'.repeat(200) + '.com').endsWith('…'), true);
eq('maskEmail: control chars and whitespace stripped', maskEmail('a\u0000b\n c@ex\tample.com'), 'a***@example.com');
eq('maskEmail: undefined-safe', maskEmail(undefined as unknown as string), '***');

// ── success line ──────────────────────────────────────────────────────────
eq('loginDetail: client', loginDetail({ ip: '1.2.3.4', ua: 'curl/8', role: 'CLIENT' }), 'Signed in from 1.2.3.4 · client · curl/8');
eq('loginDetail: admin role label', loginDetail({ ip: '1.2.3.4', ua: null, role: 'ADMIN_SUPER' }), 'Signed in from 1.2.3.4 · admin super · —');
eq('loginDetail: unknown ip passes through', loginDetail({ ip: 'unknown', ua: 'x', role: 'CLIENT' }).startsWith('Signed in from unknown'), true);

// ── failure lines ─────────────────────────────────────────────────────────
eq('failed: unknown email is masked', loginFailedDetail({ ip: '1.2.3.4', ua: 'curl/8', reason: 'unknown_email', email: 'nobody@example.com' }), 'Sign-in failed from 1.2.3.4 · unknown email n***@example.com · curl/8');
eq('failed: wrong password never echoes the address', loginFailedDetail({ ip: '1.2.3.4', ua: 'curl/8', reason: 'wrong_password', email: 'x@y.z' }), 'Sign-in failed from 1.2.3.4 · wrong password · curl/8');
eq('failed: blocked', loginFailedDetail({ ip: '1.2.3.4', ua: 'curl/8', reason: 'blocked', email: 'x@y.z' }), 'Sign-in failed from 1.2.3.4 · account blocked · curl/8');
eq('failed: a password-looking string is not part of the line', loginFailedDetail({ ip: '1.2.3.4', ua: 'hunter2', reason: 'wrong_password', email: 'x@y.z' }).includes('x@y.z'), false);

// ── loginUa: the plain-object header shape authorize() receives ───────────
eq('loginUa: lower-case key', loginUa({ headers: { 'user-agent': 'curl/8' } }), 'curl/8');
eq('loginUa: mixed-case key', loginUa({ headers: { 'User-Agent': 'curl/8' } }), 'curl/8');
eq('loginUa: array form takes the first', loginUa({ headers: { 'user-agent': ['x', 'y'] } }), 'x');
eq('loginUa: missing header → dash', loginUa({ headers: {} }), '—');
eq('loginUa: undefined req → dash', loginUa(undefined), '—');

console.log(`auth-audit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
