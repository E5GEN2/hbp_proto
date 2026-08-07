import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Admin roles, duplicated from isAdminRole() in src/lib/auth.ts — that module
// pulls in Prisma + bcrypt and cannot run in the edge middleware bundle. Keep
// this set in sync with isAdminRole().
const ADMIN_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT']);

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;
  // Lowercased for the admin match only: the compiled matcher regexes are
  // case-insensitive, so middleware also RUNS for /ADMIN/... — match the same
  // way here so the edge layer never silently disengages on a case variant.
  const lp = path.toLowerCase();

  // ── Admin gate (security, 2026-08-06 auth leak) ─────────────────────────
  // /admin/** page segments render IN PARALLEL with the admin layout, so the
  // layout's redirect() alone does NOT stop a page's own queries from running
  // and streaming into the RSC payload — an anonymous request received real
  // data, including plaintext proxy credentials. Block at the edge, before any
  // segment renders. getToken decodes only the JWT (no DB, edge-safe); a
  // just-BLOCKED admin whose token is still valid is caught downstream by the
  // per-page requireAdmin() DB re-check (src/lib/require-admin.ts).
  if (lp === '/admin' || lp.startsWith('/admin/') || lp === '/api/admin' || lp.startsWith('/api/admin/')) {
    // secureCookie left to next-auth's default (derived from NEXTAUTH_URL =
    // https://odatai.com) — the TLS-terminating Railway proxy means a
    // per-request http protocol can appear even for https traffic, which would
    // pick the wrong cookie name and lock admins out. Fails closed either way.
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const isAdmin = !!token && ADMIN_ROLES.has(String(token.role));
    if (!isAdmin) {
      if (lp.startsWith('/api/')) {
        return NextResponse.json({ error: token ? 'Forbidden' : 'Unauthorized' }, { status: token ? 403 : 401 });
      }
      // No session → login (carry the return); signed-in non-admin → dashboard.
      const dest = token ? '/dashboard' : `/login?return=${encodeURIComponent(path + url.search)}`;
      return NextResponse.redirect(new URL(dest, url));
    }
    return NextResponse.next();
  }

  // ── /checkout intent preservation (PF-2, owner item 4) ──────────────────
  // An anonymous hit on /checkout used to bounce through the (client) layout's
  // bare redirect('/login'), losing every plan param. Preserve the FULL URL so
  // login/register/verify deliver the user to the checkout they chose. Only
  // the session COOKIE presence is checked here (no decode) — the (client)
  // layout guard stays authoritative for the signed-in-but-unverified case.
  const intent = path + url.search;
  const hasSessionCookie =
    req.cookies.has('__Secure-next-auth.session-token') ||
    req.cookies.has('next-auth.session-token');

  const res = hasSessionCookie
    ? NextResponse.next()
    : NextResponse.redirect(new URL(`/login?return=${encodeURIComponent(intent)}`, url));

  // Short-lived checkout-intent hint (10 min) — /verify falls back to it when
  // no ?return survived the hop. Overwritten on each /checkout visit.
  res.cookies.set('co_return', intent, {
    maxAge: 600,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: url.protocol === 'https:',
  });
  return res;
}

export const config = { matcher: ['/checkout', '/admin', '/admin/:path*', '/api/admin/:path*'] };
