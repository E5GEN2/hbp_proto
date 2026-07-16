import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { nextUserId } from '@/lib/id';
import { sendEmail, welcomeEmail } from '@/lib/email';
import { clientIp, hitRateLimit } from '@/lib/rate-limit';

const Schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

const ATTEMPT_LIMIT = 10; // POSTs per IP per 10 minutes
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_LIMIT = 3; // accounts per IP per hour
const SIGNUP_GLOBAL_LIMIT = 30; // accounts per hour site-wide — backstop if per-IP keying fails
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Too many attempts — please try again later.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const attemptWait = hitRateLimit(`register:attempt:${ip}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (attemptWait) return tooMany(attemptWait);

  const json = await req.json().catch(() => null);
  const parse = Schema.safeParse(json);
  if (!parse.success) {
    return NextResponse.json({ error: parse.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { name, email, password } = parse.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  // Counted after the duplicate check so probing an existing email
  // consumes attempt slots only, not signup slots.
  const signupWait = hitRateLimit(`register:new:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (signupWait) return tooMany(signupWait);
  const globalWait = hitRateLimit('register:new:global', SIGNUP_GLOBAL_LIMIT, SIGNUP_WINDOW_MS);
  if (globalWait) return tooMany(globalWait);

  const id = await nextUserId();
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: { id, name, email, passwordHash, role: 'CLIENT', balance: 0 },
  });

  // Seed locked balance payment method
  await prisma.paymentMethod.create({
    data: {
      id: `pm_balance_${id.toLowerCase()}`,
      userId: id,
      kind: 'BALANCE',
      brand: 'Account balance',
      locked: true,
    },
  });

  // Raw proxy headers recorded alongside the resolved IP so the Railway
  // x-forwarded-for contract can be audited from real traffic (see rate-limit.ts).
  const rawXff = (req.headers.get('x-forwarded-for') ?? '—').slice(0, 120);
  const rawRealIp = (req.headers.get('x-real-ip') ?? '—').slice(0, 45);
  // Best-effort — neither a mail outage nor a log failure must fail the signup.
  await prisma.log
    .create({
      data: {
        actorId: id, action: 'AUTH.REGISTER', objectType: 'AUTH', objectId: id,
        detail: `Account created from ${ip} (xff: ${rawXff}; real-ip: ${rawRealIp})`,
      },
    })
    .catch(() => {});
  await sendEmail({ to: email, ...welcomeEmail(name) });

  return NextResponse.json({ ok: true, userId: id });
}
