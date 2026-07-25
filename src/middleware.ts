import { NextResponse, type NextRequest } from 'next/server';

// PF-2 (owner item 4): an anonymous hit on /checkout used to bounce through
// the (client) layout's bare redirect('/login'), losing every plan param —
// the chosen plan evaporated between "Buy now" and registration whenever the
// user arrived without a session (direct link, post-register cookie race,
// bookmark). This preserves the FULL requested URL so login/register/verify
// deliver the user to the checkout they actually chose.
//
// The signed-in-but-UNVERIFIED case can't be carried in ?return (the
// (client) layout redirect to /verify is a bare server redirect that can't
// read the URL), so we also stash the intent in a short-lived cookie that
// /verify reads as a fallback.
//
// Edge-safe by design: only the presence of the NextAuth session COOKIE is
// checked (no Prisma on the edge runtime). A stale/invalid cookie simply
// falls through to the (client) layout guard, which stays authoritative.
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const intent = url.pathname + url.search;
  const hasSessionCookie =
    req.cookies.has('__Secure-next-auth.session-token') ||
    req.cookies.has('next-auth.session-token');

  const res = hasSessionCookie
    ? NextResponse.next()
    : NextResponse.redirect(new URL(`/login?return=${encodeURIComponent(intent)}`, url));

  // Short-lived checkout-intent hint (10 min) — /verify falls back to it when
  // no ?return survived the hop. Overwritten on each /checkout visit; expires
  // on its own, so a stale value is low-harm.
  res.cookies.set('co_return', intent, {
    maxAge: 600,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: url.protocol === 'https:',
  });
  return res;
}

export const config = { matcher: ['/checkout'] };
