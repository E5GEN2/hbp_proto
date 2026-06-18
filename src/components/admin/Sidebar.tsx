'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';

// Canon nav icons (prototype.html sidebar) — 24×24, stroke style inherited via .nav-item svg
const ICONS: Record<string, JSX.Element> = {
  dashboard: <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  orders: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  payments: <><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></>,
  renewals: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
  clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  plans: <><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>,
  proxies: <><rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></>,
  logs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
};

function NavIcon({ name }: { name: string }) {
  return <svg className="nav-icon" viewBox="0 0 24 24">{ICONS[name]}</svg>;
}

type NavItem = { href: string; label: string; icon: string };

// Canon grouping (locked): Operations (daily-driver queues) · Inventory
// (catalog + pool) · System (audit + config). Order matches prototype.html.
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { href: '/admin',          label: 'Dashboard', icon: 'dashboard' },
      { href: '/admin/orders',   label: 'Orders',    icon: 'orders'    },
      { href: '/admin/payments', label: 'Payments',  icon: 'payments'  },
      { href: '/admin/renewals', label: 'Renewals',  icon: 'renewals'  },
      { href: '/admin/clients',  label: 'Clients',   icon: 'clients'   },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/admin/plans',   label: 'Plans',   icon: 'plans'   },
      { href: '/admin/proxies', label: 'Proxies', icon: 'proxies' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/logs',     label: 'Admin Logs', icon: 'logs'     },
      { href: '/admin/settings', label: 'Settings',   icon: 'settings' },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN_SUPER: 'Super Admin',
  ADMIN_OPS: 'Ops Admin',
  ADMIN_SUPPORT: 'Support',
};

export function AdminSidebar({
  user,
  badges,
}: {
  user: { name: string; email: string; role?: string };
  badges: Record<string, number>;
}) {
  const pathname = usePathname();
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setClock(`${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(href + '/');

  const initials =
    (user.name || '').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A';
  const roleLabel = (user.role && ROLE_LABEL[user.role]) || 'Admin';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo" title="Server time">
        <span className="topbar-clock-zone">UTC</span>
        <span className="topbar-clock-pulse" />
        <span className="sidebar-clock-time">{clock}</span>
      </div>

      <nav className="nav">
        {GROUPS.map(g => (
          <div key={g.label} className="nav-group">
            <div className="sidebar-section-label">{g.label}</div>
            {g.items.map(n => {
              const b = badges[n.href] ?? 0;
              return (
                <Link key={n.href} href={n.href} className={`nav-item ${isActive(n.href) ? 'active' : ''}`}>
                  <NavIcon name={n.icon} />
                  <span>{n.label}</span>
                  {b > 0 && <span className="nav-badge">{b}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="avatar">{initials}</div>
        <div className="admin-info">
          <div className="admin-name">{user.name}</div>
          <div className="admin-role">{roleLabel}</div>
        </div>
        <button className="icon-btn sidebar-signout" title="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
          <svg viewBox="0 0 24 24"><path d="M15 17l5-5-5-5M20 12H9M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h7" /></svg>
        </button>
      </div>
    </aside>
  );
}
