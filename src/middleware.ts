import { NextResponse, type NextRequest } from 'next/server';

// PF-2 (owner item 4): an anonymous hit on /checkout used to bounce through
// the (client) layout's bare redirect('/login'), losing every plan param —
// the chosen plan evaporated between "Buy now" and registration whenever the
// user arrived without a session (direct link, post-register cookie race,
// bookmark). Preserve the FULL requested URL as ?return so login/register
// deliver the user to the checkout they actually chose.
//
// Edge-safe by design: only the presence of the NextAuth session COOKIE is
// checked (no Prisma on the edge runtime). A stale/invalid cookie simply
// falls through to the (client) layout guard, which stays authoritative.
export function middleware(req: NextRequest) {
  const hasSessionCookie =
    req.cookies.has('__Secure-next-auth.session-token') ||
    req.cookies.has('next-auth.session-token');
  if (hasSessionCookie) return NextResponse.next();

  const url = req.nextUrl;
  const ret = encodeURIComponent(url.pathname + url.search);
  return NextResponse.redirect(new URL(`/login?return=${ret}`, url));
}

export const config = { matcher: ['/checkout'] };
