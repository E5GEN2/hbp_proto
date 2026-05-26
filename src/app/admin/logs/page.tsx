import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { fmtAdminStamp } from '@/lib/date';

const PER_PAGE = 20;

export default async function AdminLogsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const t = searchParams.type ?? 'all';
  const q = searchParams.q?.trim() ?? '';
  const actorId = searchParams.actor ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const where: any = {};
  if (t !== 'all') where.objectType = t.toUpperCase();
  if (actorId) where.actorId = actorId;
  if (q) {
    where.OR = [
      { action: { contains: q, mode: 'insensitive' } },
      { objectId: { contains: q, mode: 'insensitive' } },
      { detail: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [logs, total, admins] = await Promise.all([
    prisma.log.findMany({
      where, orderBy: { at: 'desc' },
      include: { actor: { select: { id: true, name: true, role: true, initials: true } } },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.log.count({ where }),
    prisma.user.findMany({
      where: { role: { in: ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT'] } },
      select: { id: true, name: true },
    }),
  ]);

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar title="Admin Logs" />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {['all', 'order', 'payment', 'proxy', 'client', 'plan', 'system', 'auth'].map(v => {
            const tsp = new URLSearchParams(sp);
            tsp.set('type', v); tsp.delete('page');
            return (
              <Link key={v} href={`/admin/logs?${tsp.toString()}`} className={`tab ${t === v ? 'active' : ''}`}>
                {v === 'all' ? 'All events' : v[0].toUpperCase() + v.slice(1) + 's'}
              </Link>
            );
          })}
        </div>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: 'Search action / object / detail…' },
            { kind: 'select', name: 'actor', label: 'All actors', options: admins.map(a => ({ value: a.id, label: a.name })) },
          ]}
        />
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Admin</th><th>Action</th><th>Object</th><th>Timestamp</th><th>Details</th></tr></thead>
            <tbody>
              {logs.length === 0
                ? <tr><td colSpan={5}><div className="empty"><div className="empty-desc">No log entries match.</div></div></td></tr>
                : logs.map(l => (
                  <tr key={l.id}>
                    <td>{l.actor ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{l.actor.initials ?? l.actor.name.charAt(0)}</span>
                        <span>{l.actor.name}</span>
                      </span>
                    ) : '—'}</td>
                    <td><span className="chip muted">{l.action}</span></td>
                    <td className="mono">{l.objectId ?? '—'}</td>
                    <td>{fmtAdminStamp(l.at)}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/logs" search={sp} />
      </main>
    </>
  );
}
