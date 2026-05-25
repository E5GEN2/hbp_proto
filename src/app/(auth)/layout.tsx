import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in — HBP' };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-client" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      {children}
    </div>
  );
}
