import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import type { UserRole } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        if (user.status === 'BLOCKED') return null;
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
          select: { status: true, role: true },
        });
        if (!u || u.status === 'BLOCKED') return null as any;
        session.user.id = token.id;
        session.user.role = u.role;
      }
      return session;
    },
  },
};

export function isAdminRole(role: UserRole) {
  return role === 'ADMIN_SUPER' || role === 'ADMIN_OPS' || role === 'ADMIN_SUPPORT';
}
