import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { peekRateLimit, recordHit, clearRateLimit } from './rate-limit';
import type { UserRole } from '@prisma/client';

// Login throttle (brute-force / credential-stuffing), by SOURCE IP only.
// Deliberately NOT by account: hard per-email lockout lets anyone lock a known
// email (incl. admin) out of a correct password — an unauth DoS (NIST 800-63B
// advises against it). Per-IP is safe here because AUTH.REGISTER logs confirm
// the edge writes the REAL client IP as the first x-forwarded-for entry (so no
// "all clients collapse into one bucket" outage), and:
//   • counts FAILURES only — a correct password never spends the budget;
//   • a successful login CLEARS the IP bucket — one legit user un-sticks a
//     shared NAT for everyone behind it;
//   • an unknown IP is NOT throttled — the shared 'unknown' bucket must never
//     block a real credential.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_MAX = 10;

// authorize()'s req.headers is a plain object (not a Fetch Headers), so this
// mirrors clientIp() from rate-limit.ts against that shape. First-hop x-f-f.
function loginIp(req: unknown): string {
  const h = ((req as { headers?: Record<string, string | string[] | undefined> })?.headers) ?? {};
  const xff = h['x-forwarded-for'] ?? h['X-Forwarded-For'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  const real = h['x-real-ip'] ?? h['X-Real-Ip'];
  return first || (Array.isArray(real) ? real[0] : real) || 'unknown';
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      emailVerified: boolean;
    };
  }
  interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: UserRole;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase();
        const ip = loginIp(req);
        const throttled = ip !== 'unknown'; // only throttle when we have a real client IP
        const ipKey = `login:ip:${ip}`;

        // Over the per-IP cap → reject before the DB read + bcrypt (cheap to
        // shed a flood). This can only affect a single client IP (real, per the
        // XFF logs), and a successful login from that IP clears the bucket, so a
        // legitimate user is never stranded. Thrown message surfaces to the
        // login page (res.error) so a throttled user knows to wait.
        if (throttled && peekRateLimit(ipKey, LOGIN_IP_MAX, LOGIN_WINDOW_MS)) {
          throw new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = user ? await bcrypt.compare(credentials.password, user.passwordHash) : false;
        if (!user || !ok) {
          if (throttled) recordHit(ipKey, LOGIN_WINDOW_MS); // count failures only
          return null;
        }
        // Correct password but blocked account: not a brute-force signal — deny
        // without touching the throttle.
        if (user.status === 'BLOCKED') return null;

        if (throttled) clearRateLimit(ipKey); // a valid login un-sticks this IP (incl. shared NAT)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        // Live status re-check on EVERY session read (audit B-7, decision:
        // instant): a BLOCKED (or deleted) user is signed out on their next
        // request instead of riding out the 7-day JWT. Returning null makes
        // getServerSession() null, so every layout/action guard bounces to
        // /login. Role is refreshed from the DB too, so role changes also
        // apply without waiting for token expiry.
        const u = await prisma.user.findUnique({
          where: { id: token.id },
          select: { status: true, role: true, emailVerifiedAt: true, email: true },
        });
        if (!u || u.status === 'BLOCKED') return null as any;
        // USR-id recycling guard (2026-08-06 incident): the launch-prep
        // sequence reset re-minted ids that still-valid 7-day JWTs reference,
        // so a stale token's id could resolve to a DIFFERENT, newer user and
        // silently sign the holder in as them. Email is unique per user and
        // never recycled — if the token's email no longer matches the row at
        // token.id, the token is stale; refuse it so getServerSession() is
        // null and every guard bounces to /login for a fresh sign-in.
        if (token.email && u.email !== token.email) return null as any;
        session.user.id = token.id;
        session.user.role = u.role;
        // Same freshness as the block check — a verification flip is visible
        // on the very next request, no token rotation needed. Do NOT null the
        // session for unverified users: /verify needs a live session. Admins
        // are implicitly verified (they have no verify flow).
        session.user.emailVerified = isAdminRole(u.role) || !!u.emailVerifiedAt;
      }
      return session;
    },
  },
};

export function isAdminRole(role: UserRole) {
  return role === 'ADMIN_SUPER' || role === 'ADMIN_OPS' || role === 'ADMIN_SUPPORT';
}
