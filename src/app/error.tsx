'use client';
import Link from 'next/link';
import { ErrorShell } from './_error-shell';

// Root error boundary — any uncaught render/server error below the root
// layout lands here instead of the unbranded Next.js screen.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorShell>
      <div className="auth-title">Something went wrong</div>
      <p className="err-desc">
        An unexpected error occurred while loading this page. Your account and
        orders are unaffected — try again, or head back home.
      </p>
      <div className="err-actions">
        <button type="button" className="btn primary lg" onClick={() => reset()}>Try again</button>
        <Link href="/" className="btn lg">Go home</Link>
      </div>
      {error?.digest && <span className="err-digest">Error reference: {error.digest}</span>}
    </ErrorShell>
  );
}
