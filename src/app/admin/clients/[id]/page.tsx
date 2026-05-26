import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp, fmtRel } from '@/lib/date';
import { ClientDetailActions } from '@/components/admin/toolbars/ClientDetailActions';

export default async function AdminClientDetail({ params }: { params: { id: string } }) {
  const c = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      orders: { include: { plan: true }, orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!c || c.role !== 'CLIENT') notFound();

  const activeOrders = c.orders.filter(o => o.status === 'ACTIVE').length;
  const ltv = c.payments.filter(p => p.status === 'CONFIRMED' || p.status === 'PAID').reduce((s, p) => s + Number(p.net), 0);

  const catalogItems = await prisma.catalogItem.findMany({ where: { kind: { in: ['CARRIER', 'REGION'] } } });
  const carriers = catalogItems.filter(i => i.kind === 'CARRIER').map(i => i.value);
  const regions = catalogItems.filter(i => i.kind === 'REGION').map(i => i.value);

  const editInitial = {
    name: c.name,
    telegram: c.telegram,
    country: c.country,
    tier: c.tier,
    preferredCarrier: c.preferredCarrier,
    preferredRegion: c.preferredRegion,
    emailRenewal: c.emailRenewal,
    emailIncidents: c.emailIncidents,
    emailMarketing: c.emailMarketing,
    telegramAll: c.telegramAll,
    preRenewalReminderHours: c.preRenewalReminderHours,
  };

  return (
    <>
      <AdminTopbar title={`Clients / ${c.id}`} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{c.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="mono" style={{ fontSize: 16, color: 'var(--text)', margin: 0 }}>{c.id}</h2>
              {c.tier !== 'STANDARD' && <span className={`chip ${c.tier === 'VIP' ? 'accent' : 'info'}`}>{c.tier.toLowerCase()}</span>}
              <span className={`chip ${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
              {c.risk !== 'NONE' && <span className={`chip ${c.risk.toLowerCase()}`}>{c.risk.toLowerCase()}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
              {c.name} · {c.email}{c.telegram && ` · ${c.telegram}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ClientDetailActions clientId={c.id} initial={editInitial} blocked={c.status === 'BLOCKED'} carriers={carriers} regions={regions} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
          <div className="panel" style={{ padding: '14px 18px' }}><div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active orders</div><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{activeOrders}</div></div>
          <div className="panel" style={{ padding: '14px 18px' }}><div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total orders</div><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{c.orders.length}</div></div>
          <div className="panel" style={{ padding: '14px 18px' }}><div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Lifetime value</div><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{money(ltv)}</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Orders</span></div>
            <table className="table">
              <thead><tr><th>Order ID</th><th>Plan</th><th>Qty</th><th>Amount</th><th>Status</th><th>Expires</th></tr></thead>
              <tbody>
                {c.orders.length === 0
                  ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No orders yet.</div></div></td></tr>
                  : c.orders.map(o => (
                    <tr key={o.id}>
                      <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                      <td>{o.plan.name}</td>
                      <td className="mono">{o.qty}</td>
                      <td>{money(Number(o.amount))}</td>
                      <td><span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span></td>
                      <td>{fmtAdminStamp(o.expiresAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Profile</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Client ID</span><span className="kv-val mono">{c.id}</span></div>
              <div className="kv-row"><span className="kv-label">Country</span><span className="kv-val">{c.country ?? '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Joined</span><span className="kv-val">{fmtAdminStamp(c.createdAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Tier</span><span className="kv-val">{c.tier}</span></div>
              <div className="kv-row"><span className="kv-label">Balance</span><span className="kv-val">{money(Number(c.balance))}</span></div>
              {c.riskNote && <div className="kv-row"><span className="kv-label">Risk note</span><span className="kv-val" style={{ maxWidth: 200, textAlign: 'right' }}>{c.riskNote}</span></div>}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
