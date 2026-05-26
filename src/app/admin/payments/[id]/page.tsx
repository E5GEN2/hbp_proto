import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { MarkPaidButton, RefundButton } from '@/components/admin/ActionButtons';
import { AddNoteToolbar } from '@/components/admin/toolbars/AddNoteToolbar';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

export default async function PaymentDetail({ params }: { params: { id: string } }) {
  const p = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { client: true, order: { include: { plan: true } }, invoice: true },
  });
  if (!p) notFound();
  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Dashboard', href: '/admin' },
        { label: 'Payments', href: '/admin/payments' },
        { label: p.id },
      ]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="mono" style={{ fontSize: 18, margin: 0, color: 'var(--text)' }}>{p.id}</h2>
          <span className={`chip ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span>
          <div style={{ flex: 1 }} />
          {['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'].includes(p.status) && <MarkPaidButton paymentId={p.id} />}
          {(p.status === 'CONFIRMED' || p.status === 'PAID') && <RefundButton paymentId={p.id} amount={Number(p.gross)} />}
          <AddNoteToolbar objectType="PAYMENT" objectId={p.id} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Payment summary</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Payment ID</span><span className="kv-val mono">{p.id}</span></div>
              <div className="kv-row"><span className="kv-label">Order</span><span className="kv-val">{p.order ? <Link href={`/admin/orders/${p.order.id}`} className="mono td-link">{p.order.id}</Link> : '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{p.order?.plan.name ?? '—'}</span></div>
              <div className="kv-row"><span className="kv-label">Date</span><span className="kv-val">{fmtAdminStamp(p.createdAt)}</span></div>
              <div className="kv-row"><span className="kv-label">Provider</span><span className="kv-val">{p.provider}</span></div>
              <div className="kv-row"><span className="kv-label">Method</span><span className="kv-val">{p.method}</span></div>
              <div className="kv-row"><span className="kv-label">Gross</span><span className="kv-val">{money(Number(p.gross))}</span></div>
              <div className="kv-row"><span className="kv-label">Provider fees</span><span className="kv-val">{money(Number(p.fees))}</span></div>
              <div className="kv-row total"><span className="kv-label">Net</span><span className="kv-val">{money(Number(p.net))}</span></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Customer</span></div>
            <div className="panel-body">
              <div className="kv-row"><span className="kv-label">Client ID</span><span className="kv-val mono">{p.client.id}</span></div>
              <div className="kv-row"><span className="kv-label">Name</span><span className="kv-val">{p.client.name}</span></div>
              <div className="kv-row"><span className="kv-label">Email</span><span className="kv-val">{p.client.email}</span></div>
              <div className="kv-row"><span className="kv-label">Tier</span><span className="kv-val">{p.client.tier}</span></div>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16, alignItems: 'start' }}>

          <EntityNotesPanel objectType="PAYMENT" objectId={p.id} />

          <EntityActivityWidget objectType="PAYMENT" objectId={p.id} />
        </div>
      </main>
    </>
  );
}
