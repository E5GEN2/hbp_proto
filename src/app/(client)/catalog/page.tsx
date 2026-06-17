import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { tierFeatures, durationLabel } from '@/lib/catalog';

type Tier = { duration: number; price: number; regions: Set<string>; description: string; anyLow: boolean };

export default async function CatalogPage() {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const plans = await prisma.plan.findMany({
    where: { active: true, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { durationDays: 'asc' },
  });

  // Group sellable plans by duration → one card per tier (canon catalogTiers).
  const sellable = plans.filter(p => p.capacityState !== 'SOLD_OUT');
  const map = new Map<number, Tier>();
  for (const p of sellable) {
    let t = map.get(p.durationDays);
    if (!t) {
      t = { duration: p.durationDays, price: Number(p.price), regions: new Set(), description: p.description ?? '', anyLow: false };
      map.set(p.durationDays, t);
    }
    t.regions.add(p.region);
    const price = Number(p.price);
    if (price > t.price) t.price = price; // defensive max on price divergence within a tier
    if (p.capacityState === 'LOW') t.anyLow = true;
    if ((p.description ?? '').length > t.description.length) t.description = p.description ?? '';
  }
  const tiers = [...map.values()].sort((a, b) => a.duration - b.duration);

  return (
    <>
      <ClientTopbar
        breadcrumb={[{ label: 'Orders', href: '/orders' }, { label: 'Catalog' }]}
        balance={Number(me?.balance ?? 0)}
      />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Choose Your Plan</span>
            </div>
            <div className="panel-body">
              {tiers.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">No plans available</div>
                  <div className="empty-desc">All plans are currently sold out. Please check back soon or contact support.</div>
                </div>
              ) : (
                <div className="plan-cards">
                  {tiers.map(t => {
                    const locCount = t.regions.size;
                    return (
                      <div key={t.duration} className="plan-card">
                        <div className="plan-card-eyebrow">
                          Mobile · {locCount} {locCount === 1 ? 'location' : 'locations'}
                        </div>
                        <div className="plan-card-title">{durationLabel(t.duration)}</div>
                        <div className="plan-card-price">
                          <span className="price-value">{money(t.price)}</span>
                          <span className="price-suffix">per proxy</span>
                        </div>
                        {t.anyLow && <span className="plan-card-pill">Limited availability</span>}
                        <ul className="plan-card-features">
                          {tierFeatures(t.duration).map(f => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                        {t.description && <p className="plan-card-desc">{t.description}</p>}
                        <Link className="btn primary" href={`/checkout?duration=${t.duration}`}>
                          Select plan
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
