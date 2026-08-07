import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from './auth';

// Page-level admin guard — MUST be awaited at the very top of every
// src/app/admin/**/page.tsx server component, BEFORE any data fetch.
//
// Why per-page and not just the layout: in the App Router a route's page
// segment renders IN PARALLEL with its layout, so a `redirect()` in the admin
// layout does NOT stop the page's own queries from running and streaming into
// the RSC payload — an unauthenticated request still received real data,
// including plaintext proxy credentials (auth leak, 2026-08-06). The page's
// OWN redirect() aborts the page segment before its query runs.
//
// The edge middleware already blocks anonymous + non-admin roles before any
// render; this guard is the second layer AND the only place that catches a
// just-BLOCKED admin whose 7-day JWT is still valid — getServerSession runs
// the session callback's live DB re-check (audit B-7), which the JWT-only
// edge check cannot.
export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login?return=/admin');
  if (!isAdminRole(session.user.role)) redirect('/dashboard');
  return session;
}
