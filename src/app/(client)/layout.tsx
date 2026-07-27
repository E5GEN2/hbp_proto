import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientSidebar } from '@/components/client/Sidebar';
import { MobileNavProvider } from '@/components/ui/MobileNav';
import { TipFloater } from '@/components/ui/TipFloater';
import { TelegramCta } from '@/components/client/TelegramCta';

// All client pages need session + DB at request time
export const dynamic = 'force-dynamic';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (isAdminRole(session.user.role)) redirect('/admin');
  // Unverified clients never reach the portal shell (owner items 2-3).
  // Verification is one-way, so layout-level gating is safe on soft nav.
  if (!session.user.emailVerified) redirect('/verify');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, tier: true, balance: true },
  });
  if (!me) redirect('/login');

  return (
    <div className="theme-client portal-canvas" style={{ minHeight: '100vh', display: 'flex' }}>
      {/* Same font the marketing/auth pages load — the sidebar Comet logo SVG
          text is set in Source Sans 3; without it the mark falls back to a
          wider system font and the wordmark clips on the right (same fix as
          (auth)/layout.tsx). */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <MobileNavProvider>
        <TipFloater />
        <ClientSidebar user={{ name: me.name, email: me.email, tier: me.tier }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </MobileNavProvider>
      {/* Floating support CTA on EVERY portal page (owner request) — was
          checkout-only in the prototype. position:fixed, so tree placement
          doesn't matter; it just needs to sit inside .theme-client for the
          accent tokens. */}
      <TelegramCta />
    </div>
  );
}
