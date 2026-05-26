import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { CheckoutFlow } from './CheckoutFlow';
import { DepositFlow } from './DepositFlow';

type OrderWithPlan = Prisma.OrderGetPayload<{ include: { plan: true } }>;

export default async function CheckoutPage({ searchParams }: {
  searchParams: {
    duration?: string; qty?: string; autoExtend?: string; location?: string; step?: string;
    kind?: string; amount?: string; returnTo?: string;
    resume?: string; renewOf?: string; ref?: string;
  };
}) {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  if (!me) return null;

  // Deposit branch
  if (searchParams.kind === 'deposit') {
    const presetAmount = searchParams.amount ? parseFloat(searchParams.amount) : undefined;
    return (
      <>
        <ClientTopbar title="Deposit" balance={Number(me.balance)} />
        <main style={{ padding: 24, overflowY: 'auto' }}>
          <DepositFlow presetAmount={presetAmount} returnTo={searchParams.returnTo ? decodeURIComponent(searchParams.returnTo) : undefined} />
        </main>
      </>
    );
  }

  // Resume branch — hydrate from existing pending order
  let resumeOrder: OrderWithPlan | null = null;
  if (searchParams.resume) {
    resumeOrder = await prisma.order.findUnique({ where: { id: searchParams.resume }, include: { plan: true } });
    if (!resumeOrder || resumeOrder.clientId !== session!.user.id) {
      notFound();
    }
    if (resumeOrder.status !== 'NEW') {
      // Already paid or cancelled — bounce
      return (
        <>
          <ClientTopbar title="Checkout" balance={Number(me.balance)} />
          <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
            <div className="panel" style={{ padding: 24 }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>This order is no longer pending</h2>
              <p style={{ color: 'var(--muted)' }}>Status is <strong>{resumeOrder.status}</strong>. No need to resume.</p>
              <Link href={`/orders/${resumeOrder.id}`} className="btn primary">View order</Link>
            </div>
          </main>
        </>
      );
    }
  }

  const duration = resumeOrder ? resumeOrder.plan.durationDays : parseInt(searchParams.duration ?? '30', 10);
  const presetQty = resumeOrder ? resumeOrder.qty : parseInt(searchParams.qty ?? '1', 10);
  const presetLocation = resumeOrder ? resumeOrder.region : searchParams.location;
  const presetAutoExtend = resumeOrder ? resumeOrder.autoRenew : searchParams.autoExtend !== '0';

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

  // Hint banner copy
  const headerHint = resumeOrder
    ? `Resuming order ${resumeOrder.id} — pick up where you left off.`
    : searchParams.renewOf
    ? `Renewing ${searchParams.renewOf} — your balance was insufficient. Top up or use a different method below.`
    : null;

  return (
    <>
      <ClientTopbar title={resumeOrder ? `Resume ${resumeOrder.id}` : searchParams.renewOf ? 'Renew' : 'Checkout'} balance={Number(me.balance)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        {headerHint && (
          <div style={{
            maxWidth: 1080, margin: '0 auto 16px', padding: '10px 14px',
            background: 'var(--info-dim)', color: 'var(--info)',
            borderRadius: 'var(--radius-md)', fontSize: 12.5,
          }}>{headerHint}</div>
        )}
        <CheckoutFlow
          duration={duration}
          qty={presetQty}
          autoExtend={presetAutoExtend}
          location={presetLocation ?? plans[0].region}
          step={(searchParams.step ?? 'details') as any}
          balance={Number(me.balance)}
          plans={planSummaries}
        />
      </main>
    </>
  );
}
