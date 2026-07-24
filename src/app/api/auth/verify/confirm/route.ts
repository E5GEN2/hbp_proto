// Consume the email-verification challenge — by 6-digit CODE (requires the
// signed-in session that /verify holds) or by magic-link TOKEN (works without
// a session: the 256-bit token itself proves mailbox ownership, so the link
// opens fine in a different browser).
//
// The code path is the brute-force surface (~20 bits): per-user and per-IP
// rate buckets run BEFORE any DB read, and the row's `attempts` counter is
// consumed atomically (updateMany WHERE attempts < cap) so redeploys can't
// reset the real cap. Only ONE welcome email / audit row per account is sent —
// completeVerification flips the flag atomically and reports the winner.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendEmail, welcomeEmail } from '@/lib/email';
import { clientIp, hitRateLimit } from '@/lib/rate-limit';
import { sha256, completeVerification, MAX_CODE_ATTEMPTS } from '@/lib/email-verification';

const Schema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }),
  z.object({ token: z.string().min(20).max(200) }),
]);

const ATTEMPT_LIMIT_USER = 15; // code entries per user per 15 min (above the
                               // per-challenge cap of 5, so a freshly resent
                               // code still grants its full 5 tries — the
                               // durable per-row counter is the real bound)
const ATTEMPT_LIMIT_IP = 20; // code entries per IP per 15 min
const TOKEN_LIMIT_IP = 60; // magic-link lookups per IP per 15 min (unauth DoS bound)
const WINDOW_MS = 15 * 60 * 1000;

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Too many attempts — please try again later.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

export async function POST(req: Request) {
  const parse = Schema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  // ── Magic link: self-authenticating, sessionless ─────────────────────────
  if ('token' in parse.data) {
    const tokenWait = hitRateLimit(`verify:token:${clientIp(req)}`, TOKEN_LIMIT_IP, WINDOW_MS);
    if (tokenWait) return tooMany(tokenWait);

    const row = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(parse.data.token) },
      include: { user: { select: { id: true, name: true, email: true, status: true, emailVerifiedAt: true } } },
    });
    if (!row || row.user.status === 'BLOCKED') {
      return NextResponse.json({ error: 'This verification link is invalid or has expired — request a new code from the verification page.' }, { status: 400 });
    }
    // Re-clicking one's own already-used link right after success must read as
    // success, not a scary "invalid" (the caller already holds the one-time
    // token, so this leaks nothing).
    if (row.user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, already: true, email: row.user.email });
    }
    if (row.usedAt || row.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This verification link is invalid or has expired — request a new code from the verification page.' }, { status: 400 });
    }
    const flipped = await completeVerification(row.user.id, row.id);
    if (flipped) await sendEmail({ to: row.user.email, ...welcomeEmail(row.user.name) });
    return NextResponse.json({ ok: true, email: row.user.email });
  }

  // ── 6-digit code: needs the signed-in (unverified) session ───────────────
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.emailVerified) return NextResponse.json({ ok: true, already: true });

  const ipWait = hitRateLimit(`verify:attempt:${clientIp(req)}`, ATTEMPT_LIMIT_IP, WINDOW_MS);
  if (ipWait) return tooMany(ipWait);
  const userWait = hitRateLimit(`verify:attempt:${session.user.id}`, ATTEMPT_LIMIT_USER, WINDOW_MS);
  if (userWait) return tooMany(userWait);

  const row = await prisma.emailVerificationToken.findFirst({
    where: { userId: session.user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) {
    return NextResponse.json({ error: 'The code has expired — request a new one.' }, { status: 400 });
  }

  // Consume one attempt atomically; a row at the cap no longer accepts entries.
  const consumed = await prisma.emailVerificationToken.updateMany({
    where: { id: row.id, attempts: { lt: MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (consumed.count === 0) {
    return NextResponse.json({ error: 'Too many wrong entries — request a new code.' }, { status: 400 });
  }

  if (sha256(parse.data.code) !== row.codeHash) {
    return NextResponse.json({ error: 'Incorrect code — check the email and try again.' }, { status: 400 });
  }

  const flipped = await completeVerification(session.user.id, row.id);
  if (flipped) await sendEmail({ to: session.user.email, ...welcomeEmail(session.user.name) });
  return NextResponse.json({ ok: true });
}
