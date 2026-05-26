import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { ClientsToolbar } from '@/components/admin/toolbars/ClientsToolbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { fmtAdminStamp } from '@/lib/date';
import { money } from '@/lib/money';

const PER_PAGE = 12;

export default async function AdminClientsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const view = searchParams.status ?? 'all';
  const tier = searchParams.tier ?? '';
  const risk = searchParams.risk ?? '';
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const where: any = { role: 'CLIENT' };
  if (view !== 'all') where.status = view.toUpperCase();
  if (tier) where.tier = tier;
  if (risk) where.risk = risk;
  if (q) {
    where.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { telegram: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [clients, total, allCount, activeCount, churnedCount, blockedCount] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { _count: { select: { orders: true } } },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'CHURNED' } }),
    prisma.user.count({ where: { role: 'CLIENT', status: 'BLOCKED' } }),
  ]);

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar title="Clients" action={<ClientsToolbar />} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {[
            { v: 'all',     l: 'All',     n: allCount     },
            { v: 'active',  l: 'Active',  n: activeCount  },
            { v: 'churned', l: 'Churned', n: churnedCount },
            { v: 'blocked', l: 'Blocked', n: blockedCount },
          ].map(t => {
            const tsp = new URLSearchParams(sp);
            tsp.set('status', t.v); tsp.delete('page');
            return (
              <Link key={t.v} href={`/admin/clients?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
                {t.l}<span className="tab-count">{t.n}</span>
              </Link>
            );
          })}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search by ID, name, email, telegram…' },
            { kind: 'select', name: 'tier', label: 'All tiers', options: [
              { value: 'STANDARD', label: 'Standard' }, { value: 'PRO', label: 'Pro' }, { value: 'VIP', label: 'VIP' },
            ]},
            { kind: 'select', name: 'risk', label: 'All risk', options: [
              { value: 'NONE', label: 'None' }, { value: 'REVIEW', label: 'Under review' }, { value: 'FLAG', label: 'Flagged' },
            ]},
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Client</th><th>ID</th><th>Tier</th><th>Country</th><th>Orders</th><th>Balance</th><th>Status</th><th>Risk</th><th>Joined</th></tr></thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-desc">No clients match these filters.</div></div></td></tr>
              ) : clients.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/clients/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="avatar">{c.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</span>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email}{c.telegram && ` · ${c.telegram}`}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="mono">{c.id}</td>
                  <td><span className={`chip ${c.tier === 'VIP' ? 'accent' : c.tier === 'PRO' ? 'info' : 'muted'}`}>{c.tier.toLowerCase()}</span></td>
                  <td>{c.country ?? '—'}</td>
                  <td className="mono">{c._count.orders}</td>
                  <td className="mono">{money(Number(c.balance))}</td>
                  <td><span className={`chip ${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span></td>
                  <td><span className={`chip ${c.risk === 'NONE' ? 'muted' : c.risk.toLowerCase()}`}>{c.risk.toLowerCase()}</span></td>
                  <td>{fmtAdminStamp(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/clients" search={sp} />
      </main>
    </>
  );
}
