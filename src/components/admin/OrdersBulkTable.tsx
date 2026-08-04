'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { cancelOrderAction, suspendOrderAction, resumeOrderAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

type Row = {
  id: string;
  clientId: string;
  planName: string;
  planCarrier: string;
  region: string;
  amount: number;
  paymentStatus: string;
  status: string;
  exception: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

// Canon .dt anchor scheme: L = 64px chk + 164px Order ID + 164px Expires R-anchor
// = 392px fixed; seven middle cols share the slack by --w weights (col-total 25).
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function OrdersBulkTable({ orders }: { orders: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'cancel' | 'suspend'>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clear() { setSelected(new Set()); }

  const sel = orders.filter(o => selected.has(o.id));

  // Action availability based on row-state intersection
  const canCancel = sel.length > 0 && sel.every(o => ['NEW', 'AWAITING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED'].includes(o.status));
  const canSuspend = sel.length > 0 && sel.every(o => o.status === 'ACTIVE');
  const canResume = sel.length > 0 && sel.every(o => o.status === 'SUSPENDED');
  // Mirror the server gate as far as Row data allows (paid-like); the
  // assignment-count check stays server-side and surfaces via the bulk toast.

  async function bulkRun(action: (id: string) => Promise<any>, label: string) {
    start(async () => {
      let succeeded = 0, failed = 0;
      let firstErr: string | null = null;
      for (const o of sel) {
        try { await action(o.id); succeeded++; } catch (e: any) { failed++; firstErr ??= e?.message ?? null; }
      }
      toast(`${label} · ${succeeded}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`,
        failed && firstErr ? firstErr : '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  return (
    <>
      <div className={`bulk-bar ${selected.size > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{selected.size} selected</span>
        <div className="bulk-actions">
          {canResume && <button className="btn sm primary" disabled={pending} onClick={() => bulkRun(resumeOrderAction, 'Resumed')}>Resume</button>}
          {canSuspend && <button className="btn sm" disabled={pending} onClick={() => setConfirm('suspend')}>Suspend</button>}
          {canCancel && <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('cancel')}>Cancel</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt" style={{ minWidth: 1190 }}>
          {/* ATS colgroup, pan-variant (owner: keep every column). B*=1190 =
              min-width — pans ≤196px at exactly 1280 viewport, zero pan at
              ≥1476. Anchors: chk 52, Order/Client ID 103, Carrier·Region 162
              (nowrap), Amount 98 ("$9,999.99" + pads), Payment 145 ("Refund requested"), Status
              168 ("Renewal not extended"), Created 133, Expires 138; Plan
              auto (88 at B*). Plain % of 1190. */}
          <colgroup>
            <col style={{ width: '4.3697%' }} />
            <col style={{ width: '8.6555%' }} />
            <col style={{ width: '8.6555%' }} />
            <col />
            <col style={{ width: '13.6134%' }} />
            <col style={{ width: '8.2353%' }} />
            <col style={{ width: '12.1849%' }} />
            <col style={{ width: '14.1176%' }} />
            <col style={{ width: '11.1765%' }} />
            <col style={{ width: '11.5966%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk"></th>
              <th className="col-id">Order ID</th>
              <th className="col-id">Client ID</th>
              <th className="col-text">Plan</th>
              <th className="col-text">Carrier · Region</th>
              <th className="col-money">Amount</th>
              <th className="col-status">Payment</th>
              <th className="col-status">Status</th>
              <th className="col-date">Created</th>
              <th className="col-date">Expires</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={10}><div className="empty"><div className="empty-desc">No orders match these filters. Adjust or reset.</div></div></td></tr>
            ) : orders.map(o => (
              <tr key={o.id} style={selected.has(o.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                <td className="col-chk">
                  <span className={`chk ${selected.has(o.id) ? 'checked' : ''}`} onClick={() => toggle(o.id)} />
                </td>
                <td className="col-id"><span className="cell-tip" data-tip={o.id}><Link href={`/admin/orders/${o.id}`} className="td-link">{o.id}</Link></span></td>
                <td className="col-id"><span className="cell-tip" data-tip={o.clientId}><Link href={`/admin/clients/${o.clientId}`} className="td-link">{o.clientId}</Link></span></td>
                <td className="col-text">{o.planName}</td>
                <td className="col-text"><span className="cell-tip" data-tip={`${o.planCarrier} · ${o.region}`}>{o.planCarrier} · {o.region}</span></td>
                <td className="col-money">{money(o.amount)}</td>
                <td className="col-status"><span className={`chip ${o.paymentStatus.toLowerCase()} cell-tip chip-clip`} data-tip={cap(o.paymentStatus.replace(/_/g, ' '))}>{cap(o.paymentStatus.replace(/_/g, ' '))}</span></td>
                <td className="col-status">
                  {o.exception
                    ? <span className="chip danger cell-tip chip-clip" data-tip={cap(o.exception.replace(/_/g, ' '))}>{cap(o.exception.replace(/_/g, ' '))}</span>
                    : <span className={`chip ${o.status.toLowerCase().replace('_', '-')} cell-tip chip-clip`} data-tip={cap(o.status.replace(/_/g, ' '))}>{cap(o.status.replace(/_/g, ' '))}</span>}
                </td>
                <td className="col-date">{fmtAdminStamp(o.createdAt)}</td>
                <td className="col-date">{fmtAdminStamp(o.expiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmAction
        open={confirm === 'cancel'} onClose={() => setConfirm(null)}
        title={`Cancel ${selected.size} orders`}
        message={`This will cancel ${selected.size} ${selected.size === 1 ? 'order' : 'orders'} and release their proxies back to pool.`}
        impact={[
          'Order status → CANCELLED for each',
          'Active proxies returned to pool with security-reset markers',
          'Paid orders get a `refund-pending` exception',
        ]}
        requireReason confirmLabel="Cancel orders" confirmTone="danger"
        onConfirm={async ({ reason }) => {
          await bulkRun(id => cancelOrderAction(id, reason!), 'Cancelled');
          setConfirm(null);
        }}
      />

      <ConfirmAction
        open={confirm === 'suspend'} onClose={() => setConfirm(null)}
        title={`Suspend ${selected.size} orders`}
        message="Orders pause but proxies stay reserved."
        impact={['Status → SUSPENDED', 'Proxies stay assigned', 'Credentials revoked from client view']}
        requireReason confirmLabel="Suspend" confirmTone="danger"
        onConfirm={async ({ reason }) => {
          await bulkRun(id => suspendOrderAction(id, reason!), 'Suspended');
          setConfirm(null);
        }}
      />
    </>
  );
}
