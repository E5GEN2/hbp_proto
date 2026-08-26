import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { underProvisionedCount } from '@/lib/provisioning';
import { bucketQueueWhere } from '@/lib/order-signals';

// Admin bell feed — canon prototype `notifSourceRows()`: rows are DERIVED from
// live data so counts never lie (no stored notifications, no read state).
// Exceptions first, then operational queues; every row links to the page
// pre-filtered to resolve it.

export type AdminNotifRow = { tone: string; title: string; meta: string; href: string };

// Proxy-shortage exceptions (PAID_NOT_PROVISIONED, REPLACEMENT_PENDING,
// RENEWAL_FAULTY_PROXY) are intentionally NOT listed here — they are the same
// orders the deficit row already reports. Only genuinely distinct exceptions
// remain. `exc` is the Orders sub-filter key (kebab) the row links to.
const EXC: Array<{ key: string; exc: string; tone: string; label: string }> = [
  { key: 'RENEWAL_NOT_EXTENDED', exc: 'renewal-not-extended', tone: 'violet', label: 'renewal paid, not extended' },
  { key: 'REFUND_PENDING', exc: 'refund-pending', tone: 'warn', label: 'refund review pending' },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !String(session.user.role).startsWith('ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [excGroups, grace, awaitingPayments, refundRequests, underProvisioned, partiallyPaid] = await Promise.all([
    prisma.order.groupBy({
      by: ['exception'],
      where: { exception: { not: null } },
      _count: { _all: true },
    }),
    // Same where as the Renewals "In grace" tab and the dashboard KPI (status
    // revision phase 3) — the bell count equals the list its row opens.
    prisma.order.count({ where: bucketQueueWhere('GRACE') }),
    prisma.payment.count({ where: { status: { in: ['AWAITING', 'PENDING', 'MANUAL_REVIEW'] } } }),
    // Matches the payments page's "Refund requested" tab: client requests plus
    // refunds initiated but not yet completed with proof (manual-refund flow) —
    // counter and destination must agree.
    prisma.payment.count({ where: { status: { in: ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS'] } } }),
    underProvisionedCount(),
    // Crypto that arrived but under-covered the price (late/rate-drift payment):
    // still AWAITING with NP's own status mirrored as partially_paid. These are
    // the "money's here, order stuck" payments support used to hunt for.
    prisma.payment.count({ where: { status: 'AWAITING', npStatus: 'partially_paid' } }),
  ]);

  const excCount = new Map(excGroups.map(g => [g.exception as string, g._count._all]));
  const rows: AdminNotifRow[] = [];

  // Authoritative deficit signal first — ACTIVE paid orders below their bought
  // quantity, computed from live assignments (not the drift-prone exception
  // field). Links to the matching Orders tab so the count == the page.
  if (underProvisioned) {
    rows.push({ tone: 'danger', title: `${underProvisioned} paid order${underProvisioned === 1 ? '' : 's'} missing proxies`, meta: 'Assign proxies in Orders', href: '/admin/orders?view=underprovisioned' });
  }

  for (const e of EXC) {
    const n = excCount.get(e.key) ?? 0;
    if (!n) continue;
    rows.push({
      tone: e.tone,
      title: `${n} ${e.label}`,
      meta: 'Click to resolve in Orders',
      href: `/admin/orders?view=exceptions&exc=${e.exc}`,
    });
  }
  if (grace) {
    // Deep-link to the tab the count was taken from — the bare board opened
    // the default Next-24h tab, a different list than the number promised.
    rows.push({ tone: 'warn', title: `${grace} in grace period`, meta: 'Needs renewal decision', href: '/admin/renewals?view=grace' });
  }
  if (partiallyPaid) {
    rows.push({ tone: 'danger', title: `${partiallyPaid} crypto payment${partiallyPaid === 1 ? '' : 's'} underpaid`, meta: 'Money arrived — confirm or refund in Payments', href: '/admin/payments' });
  }
  if (awaitingPayments) {
    rows.push({ tone: 'accent', title: `${awaitingPayments} payment${awaitingPayments === 1 ? '' : 's'} awaiting confirmation`, meta: 'Click to review in Payments', href: '/admin/payments' });
  }
  if (refundRequests) {
    rows.push({ tone: 'danger', title: `${refundRequests} refund request${refundRequests === 1 ? '' : 's'} from clients`, meta: 'Approve or decline in Payments', href: '/admin/payments' });
  }

  return NextResponse.json({ rows });
}
