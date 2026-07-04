import { SiteLogo } from './(auth)/SiteLogo';

// Shared shell for the branded not-found / error pages — the auth layout's
// cream + dotted background with the Comet logo pill and a centred card.
// Plain presentational component: usable from both server (not-found) and
// client (error boundary) pages.
export function ErrorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-client auth-page">
      {/* Same font the marketing site loads — the Comet logo SVG text is set in
          Source Sans 3; without it the wordmark clips on the right. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <header className="auth-topbar">
        <SiteLogo />
      </header>
      <main className="auth-main">
        <div className="auth-card err-card">{children}</div>
      </main>
    </div>
  );
}
