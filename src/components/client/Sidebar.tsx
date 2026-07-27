'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { signalStructural } from '@/lib/nav-history';
import { MobileNavBackdrop, useMobileNav } from '@/components/ui/MobileNav';

// Nav icons — owner decision (dashboard review): client pictograms mirror the
// ADMIN panel's icon set (components/admin/Sidebar.tsx ICONS) for the matching
// sections. Billing uses the admin "payments" card, Settings the admin cog.
const ICONS: Record<string, JSX.Element> = {
  dashboard: <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  proxies: <><rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></>,
  orders: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  billing: <><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
};

function NavIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24">{ICONS[name]}</svg>;
}

// Per the original prototype: Dashboard · Proxies · Orders · Billing, then a
// dashed divider, then My Settings (account-scoped). Support is v2-deferred.
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/proxies', label: 'Proxies', icon: 'proxies' },
  { href: '/orders', label: 'Orders', icon: 'orders' },
  { href: '/billing', label: 'Billing', icon: 'billing' },
];

export function ClientSidebar({ user }: { user: { name: string; email: string; tier?: string } }) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileNav();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const initials = user.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  // Nav click closes the mobile drawer immediately (route-change effect is the
  // fallback — it never fires when the link targets the current page).
  const onNav = () => { signalStructural(); setOpen(false); };

  return (
    <>
    <MobileNavBackdrop />
    <aside className={`sidebar${open ? ' mobile-open' : ''}`}>
      <div className="sidebar-logo">
        {/* Comet Proxy logo — owner decision: the marketing-site mark replaces
            the canon pulsing-dot + "PROXY" wordmark, wrapped in the same pill
            as the site header. viewBox is cropped to the measured content
            bbox (26..551 × 56..144, font-loaded getBBox) so the pill's CSS
            padding IS the visual inset — equal on all four sides (owner ask).
            The divider line is stroke 3 (not the marketing 1): at this scale
            (~0.3×) a 1-unit stroke renders sub-pixel and vanishes. */}
        {/* letterSpacing/textTransform: the .sidebar-logo wordmark styles
            (uppercase, .12em tracking) inherit into SVG text — reset them so
            the "proxies" tail keeps the marketing lowercase + metrics. */}
        <span className="sidebar-logo-pill">
        <svg viewBox="26 56 525 88" style={{ height: 27, width: 'auto', letterSpacing: 'normal', textTransform: 'none' }} aria-label="Comet Proxy">
          <defs>
            <radialGradient id="sbBubbleCream" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#B58A4A" stopOpacity="0.30" />
              <stop offset="0.72" stopColor="#B58A4A" stopOpacity="0.16" />
              <stop offset="0.96" stopColor="#B58A4A" stopOpacity="0.55" />
              <stop offset="1" stopColor="#B58A4A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g fill="#0A0F1D" opacity="0.85">
            {[[70,142],[65.12,141.72],[60.31,140.87],[55.64,139.47],[51.15,137.53],[46.92,135.09],[43,132.17],[39.45,128.82],[36.31,125.08],[33.63,121],[31.43,116.64],[29.76,112.05],[28.64,107.29],[28.07,102.44],[28.07,97.56],[28.64,92.71],[29.76,87.95],[31.43,83.36],[33.63,79],[36.31,74.92],[39.45,71.18],[43,67.83],[46.92,64.91],[51.15,62.47],[55.64,60.53],[60.31,59.13],[65.12,58.28],[70,58]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="1.7" />)}
          </g>
          <circle cx="70" cy="100" r="18" fill="none" stroke="#B58A4A" strokeWidth="1.0" opacity="0.32" />
          <circle cx="88" cy="100" r="24" fill="none" stroke="#B58A4A" strokeWidth="1.2" opacity="0.50" />
          <circle cx="112" cy="100" r="30" fill="none" stroke="#B58A4A" strokeWidth="1.4" opacity="0.70" />
          <circle cx="142" cy="100" r="40" fill="url(#sbBubbleCream)" />
          <circle cx="142" cy="100" r="36" fill="none" stroke="#B58A4A" strokeWidth="2" opacity="0.95" />
          <circle cx="142" cy="100" r="12" fill="#F1E6CC" stroke="#0A0F1D" strokeWidth="2.4" />
          <circle cx="142" cy="100" r="3.4" fill="#B58A4A" />
          <line x1="208" y1="64" x2="208" y2="136" stroke="#0A0F1D" strokeWidth="3" opacity="0.25" />
          <text x="232" y="118" fontFamily="Source Sans 3, sans-serif" fontSize="50"><tspan fontWeight="600" letterSpacing="1" fill="#111827">COMET</tspan><tspan fontWeight="400" letterSpacing="0" fill="#111827"> proxies</tspan></text>
        </svg>
        </span>
      </div>
      <nav className="nav">
        {NAV.map(n => (
          <Link key={n.href} href={n.href} className={`nav-item ${isActive(n.href) ? 'active' : ''}`} onClick={onNav}>
            <NavIcon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="nav-divider dashed" />
        <Link href="/settings" className={`nav-item ${isActive('/settings') ? 'active' : ''}`} onClick={onNav}>
          <NavIcon name="settings" />
          <span>My Settings</span>
        </Link>
      </nav>
      <div className="sidebar-footer">
        <div className="avatar">{initials}</div>
        {/* Owner decision: a long email used to crowd the sign-out button —
            show a greeting over the display name instead of the address. */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="user-email">Welcome back</div>
          <div className="user-name">{user.name}</div>
        </div>
        <button className="icon-btn sidebar-signout" title="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
          <svg viewBox="0 0 24 24"><path d="M15 17l5-5-5-5M20 12H9M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h7" /></svg>
        </button>
      </div>
    </aside>
    </>
  );
}
