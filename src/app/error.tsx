'use client';
import { ErrorShell } from './_error-shell';

// Root error boundary — any uncaught render/server error below the root
// layout lands here instead of the unbranded Next.js screen.
//
// Recovery uses HARD navigation, not reset()/<Link>: the common cause here is
// a failed RSC fetch during a soft navigation (a flaky edge / dropped TLS),
// and reset() just re-runs the SAME soft fetch while <Link> is another soft
// fetch — both dead-end while the blip lasts (owner-reported "Try again did
// nothing"). A full reload / full navigation re-establishes the connection
// from scratch and actually recovers.
export default function RouteError({
  error,
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
        <button type="button" className="btn primary lg" onClick={() => window.location.reload()}>Try again</button>
        <a href="/" className="btn lg">Go home</a>
      </div>
      {error?.digest && <span className="err-digest">Error reference: {error.digest}</span>}
    </ErrorShell>
  );
}
