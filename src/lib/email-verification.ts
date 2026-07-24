// Signup email-ownership challenge (owner revision 2026-07-22, items 2-3).
// One issue = one EmailVerificationToken row carrying BOTH credentials of the
// same challenge: a 6-digit code (typed on /verify) and a 32-byte magic-link
// token. Raw values travel only inside the email; the DB stores SHA-256 of
// each — same discipline as password_reset_tokens.

import crypto from 'crypto';
import { prisma } from './prisma';
import { appUrl } from './app-url';
import { sendEmail, emailVerificationEmail } from './email';
import { safeReturn } from './safe-return';

export const VERIFY_TTL_MINUTES = 15;
const VERIFY_TTL_MS = VERIFY_TTL_MINUTES * 60 * 1000;

// The DB-backed brute-force cap for the ~20-bit code. The in-memory rate
// buckets are the cheap first layer but reset on every redeploy — this
// counter is the one that actually holds.
export const MAX_CODE_ATTEMPTS = 5;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Create a fresh challenge for the user and email it. Returns whether the mail
 * went out. CREATE-ONLY (no deleteMany of prior rows): the confirm code path
 * reads only the newest row and older codes expire on their own, while KEEPING
 * superseded rows is what lets the send route's durable "N per hour" cap
 * actually count issues (deleting them defeated the throttle — review find).
 * `returnPath` threads the purchase intent into the magic link so clicking it
 * (instead of typing the code) still lands on the chosen checkout.
 */
export async function issueVerification(userId: string, email: string, returnPath?: string | null): Promise<boolean> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: sha256(token), codeHash: sha256(code), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  const ret = safeReturn(returnPath);
  const link = appUrl(`/verify?token=${token}${ret ? `&return=${encodeURIComponent(ret)}` : ''}`);
  return sendEmail({ to: email, ...emailVerificationEmail(code, link, VERIFY_TTL_MINUTES) });
}

/**
 * Stamp the user verified + retire every outstanding challenge. The stamp is
 * an atomic guarded update (WHERE emailVerifiedAt IS NULL) so two parallel
 * confirmations (magic link on phone + code in browser) flip exactly once —
 * only that winner sends the welcome email + writes the audit log.
 * Returns true iff THIS call flipped the flag.
 */
export async function completeVerification(userId: string, tokenRowId: number): Promise<boolean> {
  const flip = await prisma.user.updateMany({
    where: { id: userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  const flipped = flip.count > 0;
  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: tokenRowId }, data: { usedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    ...(flipped
      ? [prisma.log.create({
          data: { actorId: userId, action: 'AUTH.EMAIL_VERIFIED', objectType: 'AUTH', objectId: userId, detail: 'Email ownership confirmed' },
        })]
      : []),
  ]);
  return flipped;
}
