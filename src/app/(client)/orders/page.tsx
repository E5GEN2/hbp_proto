import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { daysLeft, fmtDate } from '@/lib/date';

export default async function ClientOrdersPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const tab = searchParams.tab ?? 'active';
  const now = new Date();
  const where = (() => {
    const base = { clientId: userId };
    switch (tab) {
      case 'expiring': return { ...base, status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400_000) } };
      case 'past':     return { ...base, status: { in: ['EXPIRED', 'CANCELLED'] as any } };
      default:         return { ...base, status: { in: ['ACTIVE', 'NEW', 'PROVISIONING'] as any } };
    }
  })();
  const orders = await prisma.order.findMany({ where, include: { plan: true }, orderBy: { createdAt: 'desc' } });

  return (
    <>
      <ClientTopbar title="Orders" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/orders?tab=active"   className={`tab ${tab === 'active' ? 'active' : ''}`}>Active</Link>
          <Link href="/orders?tab=expiring" className={`tab ${tab === 'expiring' ? 'active' : ''}`}>Expiring</Link>
          <Link href="/orders?tab=past"     className={`tab ${tab === 'past' ? 'active' : ''}`}>Past</Link>
        </div>
        {orders.length === 0 ? (
          <div className="panel"><div className="empty"><div className="empty-title">No orders here</div><div className="empty-desc">Browse plans to place your first order.</div><Link href="/catalog" className="btn primary" style={{ marginTop: 12 }}>Browse plans</Link></div></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {orders.map(o => {
              const d = daysLeft(o.expiresAt);
              return (
                <Link key={o.id} href={`/orders/${o.id}`} className="panel" style={{ padding: 16, textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono td-link" style={{ fontWeight: 600 }}>{o.id}</span>
                    <span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span>
                    {o.autoRenew && <span className="chip muted sm">Auto-renew</span>}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{o.plan.durationDays}-day Mobile</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{o.region} · qty {o.qty}</div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                    {o.status === 'ACTIVE' && o.activatedAt && o.expiresAt
                      ? `Activated ${fmtDate(o.activatedAt)} · Expires ${fmtDate(o.expiresAt)}`
                      : o.status === 'CANCELLED' && o.cancelledAt
                        ? `Cancelled ${fmtDate(o.cancelledAt)}`
                        : `Placed ${fmtDate(o.createdAt)}`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{money(Number(o.amount))}</span>
                    {d !== null && d > 0 && d <= 7 && (
                      <span className={`chip ${d <= 2 ? 'danger' : d <= 5 ? 'warning' : 'muted'} sm`}>{d}d left</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
