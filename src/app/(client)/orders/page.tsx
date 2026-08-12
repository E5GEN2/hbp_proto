import Link from 'next/link';
import { planDisplayName } from '@/lib/catalog';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { OrdersList, type OrderRow } from '@/components/client/OrdersList';
import { loadTierGraceHours, renewalClosed } from '@/lib/grace';

export default async function ClientOrdersPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  // Fetch all orders once — tab counts + client-side bucketing live in <OrdersList>.
  const [orders, tierGrace] = await Promise.all([
    prisma.order.findMany({
      where: { clientId: userId },
      // live assignments (releasedAt null) decide "renewal closed" together with
      // the clock — an order that still holds proxies can renew even past grace.
      include: { plan: true, assignments: { where: { releasedAt: null }, select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    loadTierGraceHours(),
  ]);

  // Grace is a client attribute — same for every order this client owns; one
  // effective value drives the per-row past-grace flag below.
  const nowMs = Date.now();
  const graceClient = { tier: me?.tier ?? 'STANDARD' as const, graceHoursOverride: me?.graceHoursOverride ?? null };

  const rows: OrderRow[] = orders.map(o => ({
    id: o.id,
    planLabel: planDisplayName(o.plan.durationDays),
    planDurationDays: o.plan.durationDays,
    region: o.region,
    qty: o.qty,
    amount: Number(o.amount),
    status: o.status,
    paymentStatus: o.paymentStatus,
    autoRenew: o.autoRenew,
    createdAt: o.createdAt.getTime(),
    activatedAt: o.activatedAt ? o.activatedAt.getTime() : null,
    expiresAt: o.expiresAt ? o.expiresAt.getTime() : null,
    cancelledAt: o.cancelledAt ? o.cancelledAt.getTime() : null,
    // Renewal closed (past grace AND proxies released) → the card shows "Buy
    // again" instead of "Renew" (the server enforces the same predicate).
    pastGrace: renewalClosed(o.expiresAt, o.assignments.length, graceClient, tierGrace, nowMs),
  }));

  return (
    <>
      <ClientTopbar title="Orders" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Orders</span>
              <Link className="btn primary" href="/catalog">
                <svg viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New order
              </Link>
            </div>
            <OrdersList orders={rows} initialTab={searchParams.tab} />
          </div>
        </div>
      </main>
    </>
  );
}
