// Account password policy (owner revision 2026-07-22, item 1):
// at least 8 characters, at least one uppercase letter, at least one digit.
// ONE validator for every place a NEW password is accepted — registration,
// reset-by-link, change-in-settings, admin client creation. A policy that
// holds only at signup is no policy: the weak password just arrives through
// "forgot password" instead.
// Pure TS, no deps — shared by server routes/actions and client forms.

export const PASSWORD_POLICY_HINT = 'At least 8 characters, with an uppercase letter and a digit.';

/** Returns null when the password passes, else a human-readable reason. */
export function passwordPolicyError(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter';
  if (!/\d/.test(pw)) return 'Password must contain at least one digit';
  return null;
}

/** Per-rule state for live checklist UI in forms. */
export function passwordChecklist(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
  };
}

// Policy-compliant temporary password for admin-created accounts. Web Crypto
// (globalThis.crypto) not the node `crypto` builtin — transitions.ts is pulled
// into the edge instrumentation bundle where the builtin doesn't resolve (same
// reason id.ts uses it). Guaranteed to pass passwordPolicyError by construction.
export function generateTempPassword(): string {
  const buf = new Uint8Array(12);
  globalThis.crypto.getRandomValues(buf);
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous 0/O/1/l
  const body = Array.from(buf, b => alphabet[b % alphabet.length]).join('');
  // Prefix guarantees an uppercase letter and a digit regardless of body draw.
  return `A${(buf[0] % 10)}${body}`;
}
