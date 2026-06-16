'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

// Canon nav icons (client-panel.html ICONS) — stroke style inherited via .nav-item svg
const ICONS: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  proxies: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
  orders: <><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v5h-5" /></>,
  billing: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
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
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const initials = user.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-dot" />
        <span>Proxy</span>
      </div>
      <nav className="nav">
        {NAV.map(n => (
          <Link key={n.href} href={n.href} className={`nav-item ${isActive(n.href) ? 'active' : ''}`}>
            <NavIcon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="nav-divider dashed" />
        <Link href="/settings" className={`nav-item ${isActive('/settings') ? 'active' : ''}`}>
          <NavIcon name="settings" />
          <span>My Settings</span>
        </Link>
      </nav>
      <div className="sidebar-footer">
        <div className="avatar">{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="user-name">{user.name}</div>
          <div className="user-email">{user.email}</div>
        </div>
        <button className="icon-btn sidebar-signout" title="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
          <svg viewBox="0 0 24 24"><path d="M15 17l5-5-5-5M20 12H9M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h7" /></svg>
        </button>
      </div>
    </aside>
  );
}
