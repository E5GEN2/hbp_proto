import Link from 'next/link';
import { requireAdmin } from '@/lib/require-admin';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { RenewalsBulkTable, type RenewalRow } from '@/components/admin/RenewalsBulkTable';
import { loadTierGraceHours } from '@/lib/grace';
import { orderTimeSignal, timeSignalChip, bucketQueueWhere, renewedQueueWhere, liveWindowWhere } from '@/lib/order-signals';

const PER_PAGE = 10;

// Canon Renewals tabs, phase-4 split (same shapes the dashboard counters use,
// keeping counter == list):
//   · 24h/3d/7d — LIVE expiresAt windows (liveWindowWhere): zero sweep lag,
//     identical boundaries to the row chips.
//   · grace/expired — materialized renewalBucket via bucketQueueWhere: the
//     grace boundary is per-client (override → tier → settings cascade), the
//     exact thing the sweep bakes into the column; lag ≤ one tick, and the
//     phase-3 status gate hides frozen rows.
//   · renewed — the sticky RENEWED marker (renewedQueueWhere, PROVISIONING
//     admitted for the short-pool manual-Assign queue; a row aged back into
//     the live ≤7d horizon is excluded so it can't double-list with a live
//     window tab) + PENDING_RENEWAL requests (canon Phase 8).
function bucketWhere(view: string, nowMs: number): any {
  switch (view) {
    case '24h':     return liveWindowWhere('24h', nowMs);
    case '3d':      return liveWindowWhere('3d', nowMs);
    case '7d':      return liveWindowWhere('7d', nowMs);
    case 'grace':   return bucketQueueWhere('GRACE');
    case 'expired': return bucketQueueWhere('EXPIRED');
    case 'renewed': return { OR: [renewedQueueWhere(nowMs), { status: 'PENDING_RENEWAL' }] };
    default:        return {};
  }
}

export default async function AdminRenewalsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireAdmin();
  const view = searchParams.view ?? '24h';
  const q = searchParams.q?.trim() ?? '';
  const carrier = searchParams.carrier ?? '';
  const region = searchParams.region ?? '';
  const ar = searchParams.autorenew ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));

  const baseWhere: any = {};
  if (carrier) baseWhere.plan = { carrier };
  if (region) baseWhere.region = region;
  if (ar === 'on') baseWhere.autoRenew = true;
  if (ar === 'off') baseWhere.autoRenew = false;
  if (q) {
    baseWhere.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { clientId: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  // ONE clock instant for the whole request: the live-window tab list, its
  // count, the sibling tab counts and the row chips must all agree on `now`.
  const nowMs = Date.now();
  const where = { AND: [baseWhere, bucketWhere(view, nowMs)] };
  const countFor = (v: string) => prisma.order.count({ where: { AND: [baseWhere, bucketWhere(v, nowMs)] } });

  const [orders, total, catalogItems, n24, n3, n7, nGrace, nExpired, nRenewed] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { expiresAt: 'asc' },
      include: {
        client: true,
        plan: true,
        assignments: { where: { releasedAt: null }, take: 1, select: { proxyId: true } },
        payments: { where: { status: { in: ['AWAITING', 'PENDING'] } }, take: 1, select: { id: true } },
      },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.order.count({ where }),
    prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } }),
    countFor('24h'), countFor('3d'), countFor('7d'),
    countFor('grace'), countFor('expired'), countFor('renewed'),
  ]);
  const tierGrace = await loadTierGraceHours();

  const carriers = catalogItems.filter(c => c.kind === 'CARRIER').map(c => ({ value: c.value, label: c.value }));
  const regions = catalogItems.filter(c => c.kind === 'REGION').map(c => ({ value: c.value, label: c.value }));

  const rows: RenewalRow[] = orders.map(o => ({
    id: o.id,
    clientId: o.client?.id ?? o.clientId ?? null,
    proxyId: o.assignments[0]?.proxyId ?? null,
    planName: o.plan?.name ?? '—',
    planDuration: o.plan?.durationDays ?? 30,
    qty: o.qty,
    expiresAt: o.expiresAt,
    lastReminderAt: o.lastReminderAt,
    status: o.status,
    exception: o.exception,
    autoRenew: o.autoRenew,
    paymentId: o.payments[0]?.id ?? null,
    // Time-horizon layer (status revision phase 2), computed LIVE — on this
    // board it deliberately double-checks the bucket the tab queued on: a row
    // whose live signal disagrees with its tab (e.g. a SUSPENDED order with a
    // frozen bucket, or a boundary crossed since the last sweep tick) shows
    // its true state instead of inheriting the tab's claim.
    signal: o.client ? timeSignalChip(orderTimeSignal(o, o.assignments.length, o.client, tierGrace, nowMs)) : null,
  }));

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v) sp.set(k, v);

  const tabs: { v: string; l: string; n: number }[] = [
    { v: '24h', l: 'Next 24 h', n: n24 },
    { v: '3d', l: 'In 3 days', n: n3 },
    { v: '7d', l: 'In 7 days', n: n7 },
    { v: 'grace', l: 'In grace', n: nGrace },
    { v: 'expired', l: 'Expired', n: nExpired },
    { v: 'renewed', l: 'Renewal paid', n: nRenewed },
  ];
  const tabLink = (t: { v: string; l: string; n: number }) => {
    const tsp = new URLSearchParams(sp);
    tsp.set('view', t.v); tsp.delete('page');
    return (
      <Link key={t.v} href={`/admin/renewals?${tsp.toString()}`} className={`tab ${view === t.v ? 'active' : ''}`}>
        {t.l} <span className="tab-count">{t.n}</span>
      </Link>
    );
  };

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Renewals' }]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <FilterBar
          filters={[
            { kind: 'search', name: 'q', placeholder: '' },
            { kind: 'select', name: 'carrier', label: 'Carrier: all', options: carriers, size: 'sm' },
            { kind: 'select', name: 'region', label: 'Region: all', options: regions, size: 'md' },
            { kind: 'select', name: 'autorenew', label: 'Auto-renew: all', options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }], size: 'md' },
          ]}
        />

        <div className="panel">
          <div className="tabs tabs-split">
            <div className="tab-group">{tabs.slice(0, 3).map(tabLink)}</div>
            <div className="tab-group-divider" />
            <div className="tab-group">{tabs.slice(3, 5).map(tabLink)}</div>
            <div className="tab-group-divider" />
            <div className="tab-group">{tabs.slice(5).map(tabLink)}</div>
          </div>

          <RenewalsBulkTable key={view} rows={rows} view={view} />

          <Pagination total={total} page={page} perPage={PER_PAGE} basePath="/admin/renewals" search={sp} />
        </div>
      </main>
    </>
  );
}
