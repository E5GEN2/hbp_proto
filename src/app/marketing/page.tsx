import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { money } from '@/lib/money';

// Don't pre-render at build time — needs the DB
export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { durationDays: 'asc' },
  });
  const byDur = new Map<number, typeof plans[number]>();
  for (const p of plans) if (!byDur.has(p.durationDays)) byDur.set(p.durationDays, p);
  const tiers = [...byDur.values()];

  return (
    <div className="theme-client" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ height: 'var(--topbar-h)', padding: '0 32px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)' }}>●</span> HBP Proxies
        </div>
        <div style={{ flex: 1 }} />
        <Link href="/login" className="btn">Sign in</Link>
      </header>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px' }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Mobile proxies. Built for scale.</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 12, maxWidth: 680 }}>
          Premium 4G LTE proxies from real carrier networks. Sticky sessions, rotating IPs, transparent pricing.
        </p>

        <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {tiers.map((p, idx) => (
            <div key={p.id} className="panel" style={{ padding: 24, position: 'relative', overflow: 'visible' }}>
              {idx === 1 && (
                <div style={{ position: 'absolute', top: -11, right: 20, background: 'var(--accent)', color: 'white', padding: '4px 14px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>Most popular</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Mobile · 3 locations</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{p.durationDays} days</div>
              <div style={{ fontSize: 14, marginTop: 6, color: 'var(--accent-text)', fontWeight: 600 }}>{money(Number(p.price))} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/ per proxy</span></div>
              {p.capacityState === 'LOW' && (
                <div className="chip warning" style={{ marginTop: 10 }}>Limited availability</div>
              )}
              <ul style={{ marginTop: 16, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Feature>4G LTE on real carrier modems</Feature>
                <Feature>Sticky sessions + rotation URL</Feature>
                <Feature>IP whitelisting (up to 5 IPs)</Feature>
                <Feature>HTTP + SOCKS5 protocols</Feature>
              </ul>
              <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.description}</p>
              <Link href={`/login?return=${encodeURIComponent(`/checkout?duration=${p.durationDays}&qty=1&autoExtend=1&ref=site`)}`}
                className="btn primary" style={{ marginTop: 16, width: '100%' }}>
                Buy now
              </Link>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
          Already have an account? <Link href="/login" style={{ color: 'var(--accent-text)' }}>Sign in</Link> · No account? Just click <strong>Buy now</strong> — we&rsquo;ll guide you through registration.
        </div>
      </main>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--success)' }}>✓</span> {children}
    </li>
  );
}
