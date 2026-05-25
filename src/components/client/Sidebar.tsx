'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/proxies',   label: 'Proxies'   },
  { href: '/orders',    label: 'Orders'    },
  { href: '/billing',   label: 'Billing'   },
  { href: '/support',   label: 'Support'   },
];

export function ClientSidebar({ user }: { user: { name: string; email: string; tier?: string } }) {
  const pathname = usePathname();
  return (
    <aside style={{
      width: 'var(--sidebar-w)', flexShrink: 0,
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', padding: '0 18px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, letterSpacing: '-0.01em' }}>
          <span style={{ color: 'var(--accent)' }}>●</span> HBP Proxies
        </div>
      </div>
      <nav style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(n => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/');
          return (
            <Link key={n.href} href={n.href}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontWeight: 500,
                background: active ? 'var(--surface-3)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-secondary)',
              }}>
              {n.label}
            </Link>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
        <Link href="/settings"
          style={{
            padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500,
            background: pathname.startsWith('/settings') ? 'var(--surface-3)' : 'transparent',
            color: pathname.startsWith('/settings') ? 'var(--text)' : 'var(--text-secondary)',
          }}>
          My Settings
        </Link>
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
