// Signup email-ownership challenge (owner revision 2026-07-22, items 2-3).
// One issue = one EmailVerificationToken row carrying BOTH credentials of the
// same challenge: a 6-digit code (typed on /verify) and a 32-byte magic-link
// token. Raw values travel only inside the email; the DB stores SHA-256 of
// each — same discipline as password_reset_tokens. Re-issuing kills every
// outstanding unused challenge first, so exactly one is live per user.

import crypto from 'crypto';
import { prisma } from './prisma';
import { appUrl } from './app-url';
import { sendEmail, emailVerificationEmail } from './email';

export const VERIFY_TTL_MINUTES = 15;
const VERIFY_TTL_MS = VERIFY_TTL_MINUTES * 60 * 1000;

// The DB-backed brute-force cap for the ~20-bit code. The in-memory rate
// buckets are the cheap first layer but reset on every redeploy — this
// counter is the one that actually holds.
export const MAX_CODE_ATTEMPTS = 5;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Create a fresh challenge for the user and email it. Returns whether the mail went out. */
export async function issueVerification(userId: string, email: string): Promise<boolean> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { userId, tokenHash: sha256(token), codeHash: sha256(code), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    }),
  ]);
  const link = appUrl(`/verify?token=${token}`);
  return sendEmail({ to: email, ...emailVerificationEmail(code, link, VERIFY_TTL_MINUTES) });
}

/** Stamp the user verified + retire the challenge. Idempotent per challenge row. */
export async function completeVerification(userId: string, tokenRowId: number) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: tokenRowId }, data: { usedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.log.create({
      data: { actorId: userId, action: 'AUTH.EMAIL_VERIFIED', objectType: 'AUTH', objectId: userId, detail: 'Email ownership confirmed' },
    }),
  ]);
}
