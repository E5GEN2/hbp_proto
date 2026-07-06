import type { ReactNode } from 'react';
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
import { PAY_CHIP, PAY_LABEL } from '@/lib/payment-display';

const CONFIRMABLE = ['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'];
const REFUNDABLE = ['CONFIRMED', 'PAID'];

export default async function PaymentDetail({ params }: { params: { id: string } }) {
  const p = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { client: true, order: { include: { plan: true } }, invoice: true },
  });
  if (!p) notFound();

  const statusChip = PAY_CHIP[p.status] ?? 'expired';
  const statusLabel = PAY_LABEL[p.status] ?? p.status;
  const orderOverridden = !!p.order?.manualFulfillmentOverride;

  // Financials
  const gross = Number(p.gross);
  const fees = Number(p.fees);
  const net = Number(p.net);
  const refunded = Number(p.refundedAmount ?? 0) > 0
    ? Number(p.refundedAmount)
    : (p.status === 'REFUNDED' ? gross : 0);
  const netAfterRefunds = Math.max(0, net - refunded);

  // Header actions — real wired actions only, canon grouping/order.
  // (Resend receipt stays an unwired Stage-1.5 stub, so it's omitted.
  //  Download invoice is REAL now — audit B-8, admin-only PDF.)
  const noteBtn = <AddNoteToolbar key="note" objectType="PAYMENT" objectId={p.id} label="Add note" />;
  const markPaidBtn = <MarkPaidButton key="paid" paymentId={p.id} paymentLabel={`${p.provider} · ${money(gross)}`} />;
  const refundBtn = <RefundButton key="refund" paymentId={p.id} amount={gross} />;
  const invoiceBtn = p.invoice
    ? <a key="invoice" className="btn" href={`/api/admin/invoices/${p.invoice.id}/pdf`}>Download invoice</a>
    : null;
  let actions: ReactNode[];
  if (REFUNDABLE.includes(p.status)) actions = [noteBtn, refundBtn];
  else if (CONFIRMABLE.includes(p.status)) actions = [markPaidBtn, noteBtn];
  else actions = [noteBtn];
  if (invoiceBtn) actions = [invoiceBtn, ...actions];

  const c = p.client;
  const tierBadge = c.tier === 'VIP' ? <span className="client-tier">VIP</span>
    : c.tier === 'PRO' ? <span className="client-tier">Pro</span>
    : <span className="muted">Standard</span>;
  const riskChip = c.risk === 'NONE' ? <span className="chip released">Clean</span>
    : c.risk === 'REVIEW' ? <span className="chip review">Under review</span>
    : <span className="chip flag">Flagged</span>;

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Payments', href: '/admin/payments' },
        { label: p.id },
      ]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div className="plan-edit-page">
          <div className="detail-header">
            <div className="detail-header-left">
              <div className="detail-id">{p.id}</div>
              <div className="detail-chips">
                <span className={`chip ${statusChip}`}>{statusLabel}</span>
                {orderOverridden && (
                  <span className="exc-chip" title={`Linked order ${p.order!.id} was manually fulfilled by an admin despite this payment's state. Finance reconciliation pending.`}>
                    Linked order manually fulfilled despite {statusLabel.toLowerCase()} payment
                  </span>
                )}
              </div>
            </div>
            <div className="detail-header-actions">{actions}</div>
          </div>

          <div className="plan-edit-shell">
            <div className="grid-left">
              {/* Payment Summary — identity, processing, financials */}
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Payment summary</span></div>
                <div className="kv">
                  <div className="kv-row"><span className="kv-key">Payment ID</span><span className="kv-val">{p.id}</span></div>
                  {p.order && <div className="kv-row"><span className="kv-key">Order</span><span className="kv-val"><Link href={`/admin/orders/${p.order.id}`} className="td-link">{p.order.id}</Link></span></div>}
                  {p.order?.plan && <div className="kv-row"><span className="kv-key">Plan</span><span className="kv-val">{p.order.plan.name}</span></div>}
                  <div className="kv-row"><span className="kv-key">Date</span><span className="kv-val">{fmtAdminStamp(p.createdAt)}</span></div>
                  {orderOverridden && <div className="kv-row"><span className="kv-key">Reconciliation</span><span className="kv-val">Payment state: {statusLabel} · manual fulfillment override</span></div>}
                  <div className="kv-row"><span className="kv-key">Provider</span><span className="kv-val">{p.provider}</span></div>
                  <div className="kv-row"><span className="kv-key">Method</span><span className="kv-val">{p.method}</span></div>
                  <div className="kv-row"><span className="kv-key">Gross</span><span className="kv-val">{money(gross)}</span></div>
                  <div className="kv-row"><span className="kv-key">Provider fees</span><span className="kv-val">−{money(fees)}</span></div>
                  {refunded > 0 && <div className="kv-row"><span className="kv-key">Refunds</span><span className="kv-val">−{money(refunded)}</span></div>}
                  <div className="kv-row"><span className="kv-key">Net</span><span className="kv-val">{money(refunded > 0 ? netAfterRefunds : net)}</span></div>
                </div>
              </div>

              <EntityNotesPanel objectType="PAYMENT" objectId={p.id} />
            </div>

            <aside className="form-aside">
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Customer</span></div>
                <div className="kv">
                  <div className="kv-row"><span className="kv-key">Client ID</span><span className="kv-val"><Link href={`/admin/clients/${c.id}`} className="client-link">{c.id}</Link></span></div>
                  <div className="kv-row"><span className="kv-key">Name</span><span className="kv-val">{c.name}</span></div>
                  <div className="kv-row"><span className="kv-key">Email</span><span className="kv-val">{c.email}</span></div>
                  {c.telegram && c.telegram !== '—' && <div className="kv-row"><span className="kv-key">Telegram</span><span className="kv-val">{c.telegram}</span></div>}
                  <div className="kv-row"><span className="kv-key">Country</span><span className="kv-val">{c.country ?? '—'}</span></div>
                  <div className="kv-row"><span className="kv-key">Tier</span><span className="kv-val">{tierBadge}</span></div>
                  <div className="kv-row"><span className="kv-key">Risk</span><span className="kv-val">{riskChip}</span></div>
                </div>
              </div>

              <EntityActivityWidget objectType="PAYMENT" objectId={p.id} />
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
