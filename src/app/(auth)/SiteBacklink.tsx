'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// "← Back to site" — shown only when the visitor arrived from the marketing site
// (Sign in passes ?from=site; Buy passes a return that carries ref=site). The
// site now lives at "/" (marketing moved off /marketing), so it returns there.
export function SiteBacklink() {
  const params = useSearchParams();
  const ret = params.get('return') ?? '';
  const fromSite =
    params.get('from') === 'site' ||
    /(?:^|[?&])ref=site\b/.test(ret) ||
    ret.startsWith('/marketing') ||
    ret.startsWith('/checkout');

  if (!fromSite) return null;
  return (
    <Link href="/" className="auth-backlink">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      Back to site
    </Link>
  );
}
