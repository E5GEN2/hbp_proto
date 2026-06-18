import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { CancelOrderButton, SuspendButton, ResumeButton, ExtendButton, SendCredentialsButton, MarkPaidButton, RefundButton } from '@/components/admin/ActionButtons';
import { OrderDetailActions } from '@/components/admin/toolbars/OrderDetailActions';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

export default async function AdminOrderDetail({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      plan: true,
      payments: { orderBy: { createdAt: 'desc' } },
      assignments: { include: { proxy: true }, orderBy: { assignedAt: 'asc' } },
    },
  });
  if (!order) notFound();

  // Calculate proxies still needed and prefetch candidates for the Assign modal
  const activeAssignments = order.assignments.filter(a => a.releasedAt === null).length;
  const qtyNeeded = Math.max(0, order.qty - activeAssignments);
  const showAssign = qtyNeeded > 0 && order.paymentStatus === 'PAID' || order.exception === 'PAID_NOT_PROVISIONED';
  const wasPaid = order.paymentStatus === 'PAID' || order.paymentStatus === 'CONFIRMED';

  const candidates = showAssign ? await prisma.proxy.findMany({
    where: {
      carrier: order.plan.carrier,
      region: order.region,
      status: 'AVAILABLE',
      health: 'HEALTHY',
    },
    take: 20,
    orderBy: [{ pool: 'asc' }, { id: 'asc' }],
  }) : [];

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Orders', href: '/admin/orders' },
        { label: order.id },
      ]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, color: 'var(--text)', margin: 0 }}>{order.id}</h2>
          <span className={`chip ${order.status.toLowerCase().replace('_','-')}`}>{order.status.toLowerCase()}</span>
          <span className={`chip ${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus.toLowerCase()}</span>
          {order.exception && <span className="chip danger">{order.exception.toLowerCase().replace(/_/g, ' ')}</span>}
          <div style={{ flex: 1 }} />
          <Link href={`/admin/clients/${order.client.id}`} className="btn">View client</Link>
        </div>

        {/* Lifecycle actions — wired to transition library */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {order.status === 'ACTIVE' && <>
            <ExtendButton orderId={order.id} currentQty={order.qty} currentDuration={order.plan.durationDays} currentExpiry={order.expiresAt} />
            <SuspendButton orderId={order.id} />
            <CancelOrderButton orderId={order.id} wasPaid={wasPaid} assignmentCount={activeAssignments} />
          </>}
          {order.status === 'SUSPENDED' && <>
            <ResumeButton orderId={order.id} />
            <CancelOrderButton orderId={order.id} wasPaid={wasPaid} assignmentCount={activeAssignments} />
          </>}
          {(order.status === 'NEW' || order.status === 'AWAITING' || order.status === 'PROVISIONING') &&
            <CancelOrderButton orderId={order.id} wasPaid={wasPaid} assignmentCount={activeAssignments} />}
          {order.status === 'PROVISIONING' && activeAssignments >= order.qty && !order.credentialsSentAt && <SendCredentialsButton orderId={order.id} />}
          {(order.status === 'EXPIRED' || order.status === 'CANCELLED') &&
            <ExtendButton orderId={order.id} currentQty={order.qty} currentDuration={order.plan.durationDays} currentExpiry={order.expiresAt} />}
          <OrderDetailActions
            orderId={order.id}
            qtyNeeded={qtyNeeded}
            candidates={candidates.map(p => ({ id: p.id, carrier: p.carrier, region: p.region, pool: p.pool, ip: p.ip, port: p.port, health: p.health }))}
            showAssign={showAssign}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Order summary</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Client</span><span className="kv-val mono">{order.client.id} · {order.client.name}</span></div>
              <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{order.plan.name}</span></div>
              <div className="kv-row"><span className="kv-label">Carrier · Region</span><span className="kv-val">{order.plan.carrier} · {order.region}</span></div>
              <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{order.qty}</span></div>
              <div className="kv-row total"><span className="kv-label">Amount</span><span className="kv-val">{money(Number(order.amount))}</span></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Lifecycle</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Created</span><span className="kv-val">{fmtAdminStamp(order.createdAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Activated</span><span className="kv-val">{fmtAdminStamp(order.activatedAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Expires</span><span className="kv-val">{fmtAdminStamp(order.expiresAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Auto-renew</span><span className={`chip ${order.autoRenew ? 'success' : 'muted'}`}>{order.autoRenew ? 'On' : 'Off'}</span></div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header"><span className="panel-title">Assigned proxies ({order.assignments.length})</span></div>
          <table className="table">
            <thead><tr><th>Proxy</th><th>Carrier</th><th>Pool</th><th>Assigned</th><th>Released</th><th>Status</th></tr></thead>
            <tbody>
              {order.assignments.length === 0
                ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No proxies assigned.</div></div></td></tr>
                : order.assignments.map(a => (
                  <tr key={a.id}>
                    <td><Link href={`/admin/proxies/${a.proxy.id}`} className="mono td-link">{a.proxy.id}</Link></td>
                    <td>{a.proxy.carrier}</td>
                    <td>{a.proxy.pool}</td>
                    <td>{fmtAdminStamp(a.assignedAt)}</td>
                    <td>{fmtAdminStamp(a.releasedAt)}</td>
                    <td><span className={`chip ${a.proxy.health.toLowerCase()}`}>{a.proxy.health.toLowerCase()}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header"><span className="panel-title">Payments</span></div>
          <table className="table">
            <thead><tr><th>Payment</th><th>Provider</th><th>Method</th><th>Gross</th><th>Net</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {order.payments.length === 0
                ? <tr><td colSpan={8}><div className="empty"><div className="empty-desc">No payments yet.</div></div></td></tr>
                : order.payments.map(p => (
                  <tr key={p.id}>
                    <td><Link href={`/admin/payments/${p.id}`} className="mono td-link">{p.id}</Link></td>
                    <td>{p.provider}</td>
                    <td>{p.method}</td>
                    <td>{money(Number(p.gross))}</td>
                    <td>{money(Number(p.net))}</td>
                    <td><span className={`chip ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span></td>
                    <td>{fmtAdminStamp(p.createdAt)}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      {['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'].includes(p.status) && <MarkPaidButton paymentId={p.id} label="Mark paid" />}
                      {(p.status === 'CONFIRMED' || p.status === 'PAID') && <RefundButton paymentId={p.id} amount={Number(p.gross)} />}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16, alignItems: 'start' }}>

          <EntityNotesPanel objectType="ORDER" objectId={order.id} />

          <EntityActivityWidget
            objectType="ORDER"
            objectId={order.id}
            bridges={[
              ...order.payments.map(p => ({ type: 'PAYMENT' as const, id: p.id })),
              ...order.assignments.map(a => ({ type: 'PROXY' as const, id: a.proxyId })),
            ]}
          />
        </div>
      </main>
    </>
  );
}
