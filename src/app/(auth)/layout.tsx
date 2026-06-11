import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sign in — HBP' };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-client" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header style={{ height: 'var(--topbar-h)', padding: '0 32px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <Link href="/marketing" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>
          <span style={{ color: 'var(--accent)' }}>●</span> HBP Proxies
        </Link>
        <div style={{ flex: 1 }} />
        <Link href="/marketing" className="btn">Plans</Link>
      </header>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
        {children}
      </div>
    </div>
  );
}
