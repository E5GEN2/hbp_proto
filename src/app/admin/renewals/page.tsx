import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { fmtAdminStamp } from '@/lib/date';

export default async function AdminRenewalsPage({ searchParams }: { searchParams: { view?: string } }) {
  const view = searchParams.view ?? '7d';
  const now = new Date();
  const where = (() => {
    switch (view) {
      case '24h':     return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 24 * 3600_000) } };
      case '3d':      return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 3 * 86400_000) } };
      case '7d':      return { status: 'ACTIVE' as const, expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400_000) } };
      case 'grace':   return { renewalBucket: 'GRACE' as const };
      case 'expired': return { status: 'EXPIRED' as const };
      case 'renewed': return { renewalBucket: 'RENEWED' as const };
      default:        return {};
    }
  })();
  const orders = await prisma.order.findMany({ where, orderBy: { expiresAt: 'asc' }, include: { client: true, plan: true }, take: 50 });

  return (
    <>
      <AdminTopbar title="Renewals" />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <Link href="/admin/renewals?view=24h"     className={`tab ${view === '24h' ? 'active' : ''}`}>Next 24h</Link>
          <Link href="/admin/renewals?view=3d"      className={`tab ${view === '3d' ? 'active' : ''}`}>In 3 days</Link>
          <Link href="/admin/renewals?view=7d"      className={`tab ${view === '7d' ? 'active' : ''}`}>In 7 days</Link>
          <Link href="/admin/renewals?view=grace"   className={`tab ${view === 'grace' ? 'active' : ''}`}>In grace</Link>
          <Link href="/admin/renewals?view=expired" className={`tab ${view === 'expired' ? 'active' : ''}`}>Expired</Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Client</th><th>Plan</th><th>Expires</th><th>Auto-renew</th><th>Status</th></tr></thead>
            <tbody>
              {orders.length === 0
                ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No orders in this bucket.</div></div></td></tr>
                : orders.map(o => (
                  <tr key={o.id}>
                    <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                    <td><Link href={`/admin/clients/${o.client.id}`} className="mono td-link">{o.client.id}</Link></td>
                    <td>{o.plan.name}</td>
                    <td>{fmtAdminStamp(o.expiresAt)}</td>
                    <td><span className={`chip ${o.autoRenew ? 'success' : 'muted'}`}>{o.autoRenew ? 'On' : 'Off'}</span></td>
                    <td><span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
