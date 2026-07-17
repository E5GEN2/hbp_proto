import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { underProvisionedCount } from '@/lib/provisioning';

// Admin bell feed — canon prototype `notifSourceRows()`: rows are DERIVED from
// live data so counts never lie (no stored notifications, no read state).
// Exceptions first, then operational queues; every row links to the page
// pre-filtered to resolve it.

export type AdminNotifRow = { tone: string; title: string; meta: string; href: string };

const EXC: Array<{ key: string; tone: string; label: string }> = [
  { key: 'PAID_NOT_PROVISIONED', tone: 'danger', label: 'paid, not provisioned' },
  { key: 'REPLACEMENT_PENDING', tone: 'accent', label: 'replacement pending' },
  { key: 'RENEWAL_NOT_EXTENDED', tone: 'violet', label: 'renewal not extended' },
  { key: 'REFUND_PENDING', tone: 'warn', label: 'refund pending' },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !String(session.user.role).startsWith('ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [excGroups, grace, awaitingPayments, refundRequests, underProvisioned] = await Promise.all([
    prisma.order.groupBy({
      by: ['exception'],
      where: { exception: { not: null } },
      _count: { _all: true },
    }),
    prisma.order.count({ where: { renewalBucket: 'GRACE' } }),
    prisma.payment.count({ where: { status: { in: ['AWAITING', 'PENDING', 'MANUAL_REVIEW'] } } }),
    prisma.payment.count({ where: { status: 'REFUND_REQUESTED' } }),
    underProvisionedCount(),
  ]);

  const excCount = new Map(excGroups.map(g => [g.exception as string, g._count._all]));
  const rows: AdminNotifRow[] = [];

  // Authoritative deficit signal first — ACTIVE paid orders below their bought
  // quantity, computed from live assignments (not the drift-prone exception field).
  if (underProvisioned) {
    rows.push({ tone: 'danger', title: `${underProvisioned} active order${underProvisioned === 1 ? '' : 's'} missing proxies`, meta: 'Assign replacements in Orders', href: '/admin/orders?view=exceptions' });
  }

  for (const e of EXC) {
    const n = excCount.get(e.key) ?? 0;
    if (!n) continue;
    rows.push({
      tone: e.tone,
      title: `${n} ${e.label}`,
      meta: 'Click to resolve in Orders',
      href: `/admin/orders?exc=${e.key}`,
    });
  }
  if (grace) {
    rows.push({ tone: 'warn', title: `${grace} in grace period`, meta: 'Needs renewal decision', href: '/admin/renewals' });
  }
  if (awaitingPayments) {
    rows.push({ tone: 'accent', title: `${awaitingPayments} payment${awaitingPayments === 1 ? '' : 's'} awaiting confirmation`, meta: 'Click to review in Payments', href: '/admin/payments' });
  }
  if (refundRequests) {
    rows.push({ tone: 'danger', title: `${refundRequests} refund request${refundRequests === 1 ? '' : 's'} from clients`, meta: 'Approve or decline in Payments', href: '/admin/payments' });
  }

  return NextResponse.json({ rows });
}
