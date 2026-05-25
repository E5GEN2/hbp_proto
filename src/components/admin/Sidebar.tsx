'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';

type NavItem = { href: string; label: string; badge?: number };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { href: '/admin',            label: 'Dashboard' },
      { href: '/admin/orders',     label: 'Orders'    },
      { href: '/admin/payments',   label: 'Payments'  },
      { href: '/admin/renewals',   label: 'Renewals'  },
      { href: '/admin/clients',    label: 'Clients'   },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/admin/plans',   label: 'Plans'   },
      { href: '/admin/proxies', label: 'Proxies' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/logs',     label: 'Admin Logs' },
      { href: '/admin/settings', label: 'Settings'   },
    ],
  },
];

export function AdminSidebar({ user, badges }: { user: { name: string; email: string }; badges: Record<string, number> }) {
  const pathname = usePathname();
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`);
    };
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, []);

  return (
    <aside style={{
      width: 'var(--sidebar-w)', flexShrink: 0,
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, letterSpacing: '-0.01em' }}>
          <span style={{ color: 'var(--accent)' }}>●</span> ProxyOps
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{now}</div>
      </div>
      <nav style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
        {GROUPS.map(g => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{g.label}</div>
            {g.items.map(n => {
              const active = pathname === n.href || (n.href !== '/admin' && pathname.startsWith(n.href + '/')) || (n.href !== '/admin' && pathname === n.href);
              const isExactDash = n.href === '/admin' && pathname === '/admin';
              const isActive = isExactDash || (n.href !== '/admin' && active);
              const b = badges[n.href] ?? 0;
              return (
                <Link key={n.href} href={n.href}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    fontWeight: 500,
                    background: isActive ? 'var(--surface-3)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center',
                    margin: '2px 0',
                  }}>
                  <span style={{ flex: 1 }}>{n.label}</span>
                  {b > 0 && <span className="chip danger sm">{b}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ padding: 14, borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{user.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{user.email}</div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>Sign out</button>
      </div>
    </aside>
  );
}
