'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { cancelOrderAction, suspendOrderAction, resumeOrderAction, sendCredentialsAction } from '@/lib/admin-actions';
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

export function OrdersBulkTable({ orders }: { orders: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'cancel' | 'suspend' | 'resume' | 'send-creds'>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === orders.length) setSelected(new Set());
    else setSelected(new Set(orders.map(o => o.id)));
  }
  function clear() { setSelected(new Set()); }

  const sel = orders.filter(o => selected.has(o.id));
  const statuses = new Set(sel.map(o => o.status));
  const pays = new Set(sel.map(o => o.paymentStatus));

  // Action availability based on row-state intersection
  const canCancel = sel.length > 0 && sel.every(o => ['NEW', 'AWAITING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED'].includes(o.status));
  const canSuspend = sel.length > 0 && sel.every(o => o.status === 'ACTIVE');
  const canResume = sel.length > 0 && sel.every(o => o.status === 'SUSPENDED');
  const canSendCreds = sel.length > 0 && sel.every(o => o.status === 'PROVISIONING');

  async function bulkRun(action: (id: string) => Promise<any>, label: string) {
    start(async () => {
      let succeeded = 0, failed = 0;
      for (const o of sel) {
        try { await action(o.id); succeeded++; } catch { failed++; }
      }
      toast(`${label} · ${succeeded}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`,
        '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{selected.size} selected</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {[...statuses].map(s => s.toLowerCase()).join(', ')}
          </span>
          <div style={{ flex: 1 }} />
          {canSendCreds && <button className="btn sm" disabled={pending} onClick={() => bulkRun(id => sendCredentialsAction(id, 'EMAIL'), 'Sent credentials')}>Send credentials</button>}
          {canResume && <button className="btn sm primary" disabled={pending} onClick={() => bulkRun(resumeOrderAction, 'Resumed')}>Resume</button>}
          {canSuspend && <button className="btn sm" disabled={pending} onClick={() => setConfirm('suspend')}>Suspend</button>}
          {canCancel && <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('cancel')}>Cancel</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox"
                  checked={orders.length > 0 && selected.size === orders.length}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < orders.length; }}
                  onChange={toggleAll}
                />
              </th>
              <th>Order ID</th><th>Client</th><th>Plan</th><th>Carrier</th><th>Region</th><th>Amount</th><th>Payment</th><th>Status</th><th>Created</th><th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={11}><div className="empty"><div className="empty-desc">No orders match these filters. Adjust or reset.</div></div></td></tr>
            ) : orders.map(o => (
              <tr key={o.id} style={{ background: selected.has(o.id) ? 'var(--accent-subtle)' : undefined }}>
                <td><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                <td><Link href={`/admin/orders/${o.id}`} className="mono td-link">{o.id}</Link></td>
                <td><Link href={`/admin/clients/${o.clientId}`} className="mono td-link">{o.clientId}</Link></td>
                <td>{o.planName}</td>
                <td>{o.planCarrier}</td>
                <td>{o.region}</td>
                <td>{money(o.amount)}</td>
                <td><span className={`chip ${o.paymentStatus.toLowerCase()}`}>{o.paymentStatus.toLowerCase()}</span></td>
                <td>
                  {o.exception
                    ? <span className="chip danger">{o.exception.toLowerCase().replace(/_/g, ' ')}</span>
                    : <span className={`chip ${o.status.toLowerCase().replace('_','-')}`}>{o.status.toLowerCase()}</span>}
                </td>
                <td>{fmtAdminStamp(o.createdAt)}</td>
                <td>{fmtAdminStamp(o.expiresAt)}</td>
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
