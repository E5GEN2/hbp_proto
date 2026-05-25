import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { daysLeft, fmtRel } from '@/lib/date';

export default async function ClientDashboard() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });

  const [orders, allOrdersCount, activeOrders, expiringSoon, proxies] = await Promise.all([
    prisma.order.findMany({
      where: { clientId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { plan: true },
    }),
    prisma.order.count({ where: { clientId: userId } }),
    prisma.order.count({ where: { clientId: userId, status: 'ACTIVE' } }),
    prisma.order.findMany({
      where: { clientId: userId, status: 'ACTIVE', expiresAt: { lte: new Date(Date.now() + 7 * 86_400_000) } },
      orderBy: { expiresAt: 'asc' },
      include: { plan: true },
    }),
    prisma.assignment.count({
      where: { order: { clientId: userId }, releasedAt: null },
    }),
  ]);

  const hasOrders = allOrdersCount > 0;

  return (
    <>
      <ClientTopbar title="Dashboard" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        {!hasOrders ? (
          <EmptyState />
        ) : (
          <>
            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
              <KpiCard label="Active orders"   value={activeOrders}        tone="accent" />
              <KpiCard label="Total proxies"   value={proxies}             tone="cta"    />
              <KpiCard label="Expiring soon"   value={expiringSoon.length} tone="warning"/>
            </div>

            {/* Two-column grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Recent orders</span>
                  <Link className="panel-action" href="/orders">View all →</Link>
                </div>
                <div className="panel-body" style={{ padding: 0 }}>
                  {orders.length === 0 ? (
                    <div className="empty" style={{ padding: 24 }}>
                      <div className="empty-desc">No orders yet.</div>
                    </div>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {orders.map(o => (
                        <li key={o.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                          <Link href={`/orders/${o.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono" style={{ color: 'var(--accent-text)', fontSize: 12.5, fontWeight: 600 }}>{o.id}</span>
                            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                              {o.plan.durationDays}-day Mobile · {o.region}
                            </span>
                            <StatusChip status={o.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Expiring soon</span>
                </div>
                <div className="panel-body" style={{ padding: 0 }}>
                  {expiringSoon.length === 0 ? (
                    <div className="empty" style={{ padding: 24 }}>
                      <div className="empty-desc">Nothing expiring in the next 7 days.</div>
                    </div>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {expiringSoon.map(o => {
                        const d = daysLeft(o.expiresAt);
                        const tone = (d ?? 0) <= 2 ? 'danger' : (d ?? 0) <= 5 ? 'warning' : 'success';
                        return (
                          <li key={o.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <Link href={`/orders/${o.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--${tone})` }} />
                              <span style={{ flex: 1, fontSize: 12.5 }}>{o.plan.durationDays}-day Mobile · {o.region}</span>
                              <span style={{ fontSize: 11, color: `var(--${tone})`, fontWeight: 600 }}>{d}d left</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Buy CTA */}
            <div className="panel" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Need more proxies?</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Browse plans and add capacity in minutes.</div>
              </div>
              <Link href="/catalog" className="btn primary">Browse plans</Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="panel" style={{ padding: '16px 20px', borderLeft: `3px solid var(--${tone})` }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls = status.toLowerCase().replace('_', '-');
  const label = status === 'PENDING_RENEWAL' ? 'Pending renewal' : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`chip ${cls}`}>{label}</span>;
}

async function EmptyState() {
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC' },
    orderBy: { durationDays: 'asc' },
  });
  // Group by duration, pick a representative
  const byDur = new Map<number, typeof plans[number]>();
  for (const p of plans) {
    if (!byDur.has(p.durationDays)) byDur.set(p.durationDays, p);
  }
  const tiers = [...byDur.values()].slice(0, 3);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Active orders"   value={0} tone="accent" />
        <KpiCard label="Total proxies"   value={0} tone="cta" />
        <KpiCard label="Expiring soon"   value={0} tone="warning" />
      </div>
      <div className="panel">
        <div className="panel-header"><span className="panel-title">Choose your plan</span></div>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {tiers.map((p, idx) => (
            <div key={p.id} style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
              padding: 20, position: 'relative',
            }}>
              {idx === 1 && (
                <div style={{ position: 'absolute', top: -10, right: 16, background: 'var(--accent)', color: 'white', padding: '2px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 600 }}>Most popular</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mobile · 3 locations</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{p.durationDays} days</div>
              <div style={{ fontSize: 14, color: 'var(--accent-text)', fontWeight: 600, marginTop: 4 }}>{money(Number(p.price))} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/ per proxy</span></div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.5 }}>{p.description}</div>
              <Link href={`/checkout?duration=${p.durationDays}`} className="btn primary" style={{ marginTop: 16, width: '100%' }}>Select plan</Link>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
