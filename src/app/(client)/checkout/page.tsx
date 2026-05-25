import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { CheckoutFlow } from './CheckoutFlow';

export default async function CheckoutPage({ searchParams }: { searchParams: { duration?: string; qty?: string; autoExtend?: string; location?: string; step?: string; kind?: string; amount?: string } }) {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  if (!me) return null;

  if (searchParams.kind === 'deposit') {
    return (
      <>
        <ClientTopbar title="Deposit" balance={Number(me.balance)} />
        <main style={{ padding: 24, overflowY: 'auto', maxWidth: 760, margin: '0 auto' }}>
          <div className="panel" style={{ padding: 24 }}>
            <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Add funds</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Top-up balance flow — coming in next iteration. For now, balance can be adjusted from the admin panel (Clients → Edit).</p>
            <Link href="/billing" className="btn">Back to billing</Link>
          </div>
        </main>
      </>
    );
  }

  const duration = parseInt(searchParams.duration ?? '30', 10);
  const plans = await prisma.plan.findMany({
    where: { durationDays: duration, active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { price: 'asc' },
  });
  if (plans.length === 0) {
    return (
      <>
        <ClientTopbar title="Checkout" balance={Number(me.balance)} />
        <main style={{ padding: 24 }}>
          <div className="panel" style={{ padding: 24 }}>
            <h2 style={{ marginTop: 0, color: 'var(--text)' }}>No plans available</h2>
            <p style={{ color: 'var(--muted)' }}>This duration is currently sold out.</p>
            <Link href="/catalog" className="btn">Back to catalog</Link>
          </div>
        </main>
      </>
    );
  }

  const allocationByPlan = new Map<string, number>();
  for (const p of plans) {
    const a = await prisma.order.aggregate({
      _sum: { qty: true },
      where: { planId: p.id, status: { in: ['ACTIVE', 'PROVISIONING', 'SUSPENDED', 'NEW', 'PENDING_RENEWAL'] } },
    });
    allocationByPlan.set(p.id, a._sum.qty ?? 0);
  }
  const planSummaries = plans.map(p => ({
    id: p.id,
    name: p.name,
    region: p.region,
    carrier: p.carrier,
    price: Number(p.price),
    autoProvision: p.autoProvision,
    description: p.description ?? '',
    available: Math.max(0, p.availableQuota - (allocationByPlan.get(p.id) ?? 0)),
  }));

  return (
    <>
      <ClientTopbar title="Checkout" balance={Number(me.balance)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <CheckoutFlow
          duration={duration}
          qty={parseInt(searchParams.qty ?? '1', 10)}
          autoExtend={searchParams.autoExtend !== '0'}
          location={searchParams.location ?? plans[0].region}
          step={(searchParams.step ?? 'details') as any}
          balance={Number(me.balance)}
          plans={planSummaries}
        />
      </main>
    </>
  );
}
