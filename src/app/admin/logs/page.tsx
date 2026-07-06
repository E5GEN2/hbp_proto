import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { fmtAdminStamp } from '@/lib/date';

const PER_PAGE = 20;

// Canon action→chip-colour map (prototype logActionChip). Unmapped actions
// fall back to 'new' (accent) — the action text in the chip carries the detail.
const LOG_ACTION_CHIP: Record<string, string> = {
  'ORDER.CREATE': 'new', 'ORDER.ACTIVATE': 'active', 'ORDER.AUTO_EXPIRE': 'expired',
  'ORDER.EXPIRE': 'expired', 'ORDER.SUSPEND': 'suspended', 'ORDER.RESUME': 'active',
  'ORDER.CANCEL': 'suspended', 'ORDER.EXTEND': 'active',
  'PAYMENT.CONFIRM': 'paid', 'PAYMENT.PENDING': 'pending', 'PAYMENT.FAILED': 'failed',
  'PAYMENT.REFUND': 'replacement', 'PAYMENT.REFUND_REQUEST': 'replacement',
  'PROXY.ASSIGN': 'assigned', 'PROXY.MARK_FAULTY': 'faulty', 'PROXY.REGISTER': 'provisioning',
  'PROXY.RELEASE': 'released',
  'PLAN.UPDATE': 'active', 'PLAN.CREATE': 'new', 'PLAN.DELETE': 'suspended',
  'CLIENT.BLOCK': 'suspended', 'CLIENT.UNBLOCK': 'active', 'CLIENT.RISK_UPDATE': 'pending',
  'CRON.HEALTH_CHECK': 'provisioning', 'FLAG.UPDATE': 'active', 'PROVIDER.UPDATE': 'active',
  'AUTH.LOGIN': 'assigned',
};

const ROLE_SLUG: Record<string, string> = {
  ADMIN_SUPER: 'super', ADMIN_OPS: 'ops', ADMIN_SUPPORT: 'support',
};

const OBJECT_PATH: Record<string, string> = {
  ORDER: 'orders', PAYMENT: 'payments', PROXY: 'proxies', CLIENT: 'clients', PLAN: 'plans',
};

const TABS = [
  { v: 'all', l: 'All events' }, { v: 'order', l: 'Orders' }, { v: 'payment', l: 'Payments' },
  { v: 'proxy', l: 'Proxies' }, { v: 'client', l: 'Clients' }, { v: 'plan', l: 'Plans' },
  { v: 'system', l: 'System' }, { v: 'auth', l: 'Auth' },
];

// Canon's "System" tab is the catch-all for everything outside the named
// categories (SYSTEM + ASSIGNMENT + TICKET object types).
function tabWhere(t: string): any {
  if (t === 'all') return {};
  if (t === 'system') return { objectType: { in: ['SYSTEM', 'ASSIGNMENT', 'TICKET'] } };
  return { objectType: t.toUpperCase() };
}

// Wrap identifier-shaped tokens (entity IDs, dates, masked card tails, emails,
// @handles) in mono spans so inline IDs match the canon typography — done with
// a safe split (no dangerouslySetInnerHTML).
const DETAIL_TOKEN = /([A-Z]{2,5}-[A-Z0-9]+|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*·\s*\d{1,2}:\d{2})?|•+\s*\d{3,4}|[\w.+-]+@[\w.-]+\.\w{2,}|@\w{3,})/g;
function renderDetail(s: string | null) {
  if (!s) return null;
  return s.split(DETAIL_TOKEN).map((part, i) =>
    i % 2 === 1 ? <span key={i} className="mono">{part}</span> : part);
}

export default async function AdminLogsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const t = searchParams.type ?? 'all';
  const q = searchParams.q?.trim() ?? '';
  const actorId = searchParams.actor ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (actorId) baseWhere.actorId = actorId;
  if (q) {
    baseWhere.OR = [
      { action: { contains: q, mode: 'insensitive' } },
      { objectId: { contains: q, mode: 'insensitive' } },
      { detail: { contains: q, mode: 'insensitive' } },
      { actor: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const where = { AND: [baseWhere, tabWhere(t)] };

  const [logs, total, admins, grouped] = await Promise.all([
    prisma.log.findMany({
      where, orderBy: { at: 'desc' },
      include: { actor: { select: { id: true, name: true, role: true, initials: true } } },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
    }),
    prisma.log.count({ where }),
    prisma.user.findMany({
      where: { role: { in: ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT'] } },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    }),
    prisma.log.groupBy({ by: ['objectType'], where: baseWhere, _count: { _all: true } }),
  ]);

  const ct = (ot: string) => grouped.find(g => g.objectType === ot)?._count._all ?? 0;
  const counts: Record<string, number> = {
    all: grouped.reduce((s, g) => s + g._count._all, 0),
    order: ct('ORDER'), payment: ct('PAYMENT'), proxy: ct('PROXY'),
    client: ct('CLIENT'), plan: ct('PLAN'), auth: ct('AUTH'),
    system: ct('SYSTEM') + ct('ASSIGNMENT') + ct('TICKET'),
  };

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Admin Logs' }]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: '' },
            { kind: 'select', name: 'actor', label: 'Actor: all', options: admins.map(a => ({ value: a.id, label: a.name })), size: 'lg' },
          ]}
          exportLabel="Export CSV"
        />

        <div className="panel">
          <div className="tabs">
            {TABS.map(tab => {
              const tsp = new URLSearchParams(sp);
              tsp.set('type', tab.v); tsp.delete('page');
              return (
                <Link key={tab.v} href={`/admin/logs?${tsp.toString()}`} className={`tab ${t === tab.v ? 'active' : ''}`}>
                  {tab.l} <span className="tab-count">{counts[tab.v]}</span>
                </Link>
              );
            })}
          </div>

          <div className="table-wrap">
            <table className="dt">
              <colgroup>
                <col style={{ width: 'calc((100% - 320px) * 4 / 18)' }} />
                <col style={{ width: 'calc((100% - 320px) * 2 / 18)' }} />
                <col style={{ width: 'calc((100% - 320px) * 5 / 18)' }} />
                <col style={{ width: 'calc((100% - 320px) * 3 / 18)' }} />
                <col style={{ width: 'calc((100% - 320px) * 4 / 18)' }} />
                <col style={{ width: 320 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="col-actor">Admin</th>
                  <th className="col-status">Role</th>
                  <th className="col-status">Action</th>
                  <th className="col-id">Object ID</th>
                  <th className="col-date">Timestamp</th>
                  <th className="col-text">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No log events match.</div></div></td></tr>
                ) : logs.map(l => {
                  const roleSlug = l.actor ? (ROLE_SLUG[l.actor.role] ?? '') : '';
                  // admin roles → Super/Ops/Support · CLIENT actor → Client · no actor → System
                  const roleLabel = roleSlug
                    ? roleSlug.charAt(0).toUpperCase() + roleSlug.slice(1)
                    : (l.actor ? 'Client' : 'System');
                  const name = l.actor?.name ?? 'System';
                  const initials = l.actor?.initials ?? (l.actor?.name?.charAt(0) ?? 'S');
                  const chipCls = LOG_ACTION_CHIP[l.action] ?? 'new';
                  const path = OBJECT_PATH[l.objectType];
                  return (
                    <tr key={l.id}>
                      <td className="col-actor">
                        <span className="actor-cell">
                          <span className={`avatar sm ${roleSlug ? `role-${roleSlug}` : ''}`}>{initials}</span>
                          <span className="actor-name">{name}</span>
                        </span>
                      </td>
                      <td className="col-status"><span className={`role-chip ${roleSlug}`}>{roleLabel}</span></td>
                      <td className="col-status"><span className={`chip ${chipCls}`}>{l.action}</span></td>
                      <td className="col-id">
                        {path && l.objectId
                          ? <Link href={`/admin/${path}/${l.objectId}`} className="td-link">{l.objectId}</Link>
                          : l.objectId ? <span>{l.objectId}</span> : <span className="muted">—</span>}
                      </td>
                      <td className="col-date">{fmtAdminStamp(l.at)}</td>
                      <td className="col-text muted"><span className="cell-tip" data-tip={l.detail}>{renderDetail(l.detail)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/logs" search={sp} />
        </div>
      </main>
    </>
  );
}
