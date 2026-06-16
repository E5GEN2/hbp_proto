import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';

export default async function CatalogPage() {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { durationDays: 'asc' },
  });
  const byDur = new Map<number, typeof plans[number]>();
  for (const p of plans) if (!byDur.has(p.durationDays)) byDur.set(p.durationDays, p);
  const tiers = [...byDur.values()];

  return (
    <>
      <ClientTopbar title="Choose your plan" balance={Number(me?.balance ?? 0)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="plan-cards" style={{ maxWidth: 1080, margin: '0 auto' }}>
          {tiers.map((p) => (
            <div key={p.id} className="panel" style={{ padding: 24 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Mobile · 3 locations</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{p.durationDays} days</div>
              <div style={{ fontSize: 14, marginTop: 6, color: 'var(--accent-text)', fontWeight: 600 }}>{money(Number(p.price))} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/ per proxy</span></div>
              {p.capacityState === 'LOW' && <div className="chip warning" style={{ marginTop: 10 }}>Limited availability</div>}
              <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.description}</p>
              <Link href={`/checkout?duration=${p.durationDays}`} className="btn primary" style={{ marginTop: 16, width: '100%' }}>Select plan</Link>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
