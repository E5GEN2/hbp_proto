import Link from 'next/link';
import type { Metadata } from 'next';
import { ErrorShell } from './_error-shell';

export const metadata: Metadata = { title: 'Page not found — HBP' };

// Root 404 — unmatched URLs plus every notFound() thrown in the app
// (checkout / order / proxy detail pages) land here.
export default function NotFound() {
  return (
    <ErrorShell>
      <div className="err-code">404</div>
      <div className="auth-title">Page not found</div>
      <p className="err-desc">
        The page you’re looking for doesn’t exist or may have moved.
        Check the address, or head back.
      </p>
      <div className="err-actions">
        <Link href="/" className="btn primary lg">Go to my dashboard</Link>
        <Link href="/marketing" className="btn lg">Back to the site</Link>
      </div>
    </ErrorShell>
  );
}
