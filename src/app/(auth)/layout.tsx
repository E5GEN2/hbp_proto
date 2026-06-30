import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteLogo } from './SiteLogo';
import { SiteBacklink } from './SiteBacklink';
import { DemoCreds } from './DemoCreds';

export const metadata: Metadata = { title: 'Sign in — HBP' };

// Auth shell, styled to match the marketing site: same cream + dotted background,
// the Comet logo pill at the top (same place as the site nav), an optional
// back-to-site link, and the auth card centred. Demo creds sit bottom-right.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-client auth-page">
      {/* Same font the marketing site loads — the Comet logo SVG text is set in
          Source Sans 3; without it the mark falls back to a wider system font
          and the wordmark clips on the right. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <header className="auth-topbar">
        <SiteLogo />
        <Suspense fallback={null}>
          <SiteBacklink />
        </Suspense>
      </header>
      <main className="auth-main">{children}</main>
      <DemoCreds />
    </div>
  );
}
