'use client';

// Catastrophic boundary: the ROOT LAYOUT itself failed, so nothing from it
// (including globals.css) can be assumed — this file must render its own
// <html>/<body> and styles itself inline. Kept dependency-free on purpose.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#F4F2EE',
          backgroundImage: 'radial-gradient(rgba(17,24,39,.025) 1px, transparent 1px)',
          backgroundSize: '3px 3px',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: '#111827',
        }}
      >
        <div
          style={{
            background: '#FAF8F4',
            border: '1px solid #DAD6CC',
            borderRadius: 12,
            width: '100%',
            maxWidth: 460,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 24px 48px -28px rgba(17,24,39,.18)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.01em' }}>Something went wrong</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#8190A1' }}>
            The application failed to load. Your account and orders are
            unaffected — try again in a moment.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 500,
                color: '#fff',
                background: '#5E78A6',
                border: '1px solid #5E78A6',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 500,
                color: '#111827',
                background: 'transparent',
                border: '1px solid #DAD6CC',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              Go home
            </a>
          </div>
          {error?.digest && (
            <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', color: 'rgba(129,144,161,.65)' }}>
              Error reference: {error.digest}
            </span>
          )}
        </div>
      </body>
    </html>
  );
}
