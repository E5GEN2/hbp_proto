'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { ExtendOrderModal } from '@/components/admin/modals/ExtendOrderModal';
import { cancelOrderAction, markPaidAction } from '@/lib/ui-actions/admin-actions';
import { fmtAdminStamp } from '@/lib/date';

export type RenewalRow = {
  id: string;
  clientId: string | null;
  proxyId: string | null;
  planName: string;
  planDuration: number;
  qty: number;
  expiresAt: Date | null;
  lastReminderAt: Date | null;
  status: string;             // OrderStatus
  renewalBucket: string | null;
  exception: string | null;
  autoRenew: boolean;
  paymentId: string | null;   // awaiting payment id (for Mark paid)
};

// Canon .dt anchor scheme: L = 64px chk + 164px Order ID = 228px fixed (--anchor-l);
// no right anchor — seven middle cols share the slack by --w weights (--col-total: 26).
const FLEX = (w: number) => `calc(100% * ${w} / 26)`;

// Single-row Extend label varies by tab (semantics differ, backend is the same
// extendOrder flow): Extend (expiring) · Revive (grace/expired) · Resolve (paid
// renewal whose period didn't extend — clears the RENEWAL_NOT_EXTENDED exception).
function extendLabel(view: string): string {
  if (view === 'grace' || view === 'expired') return 'Revive';
  if (view === 'renewed') return 'Resolve';
  return 'Extend';
}

function statusChip(o: RenewalRow) {
  if (o.status === 'PENDING_RENEWAL') return <span className="chip pending-renewal">Pending payment</span>;
  if (o.exception) {
    return o.status === 'EXPIRED'
      ? <span className="chip expired">Expired</span>
      : <span className="chip pending">Exception</span>;
  }
  if (o.renewalBucket === 'GRACE') return <span className="chip grace">Grace</span>;
  if (o.renewalBucket === 'RENEWED') return <span className="chip active">Renewed</span>;
  if (o.renewalBucket === 'EXPIRED' || o.status === 'EXPIRED') return <span className="chip expired">Expired</span>;
  return <span className="chip pending">Expiring</span>;
}

export function RenewalsBulkTable({ rows, view }: { rows: RenewalRow[]; view: string }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'cancelRefund' | 'cancelRenewal'>(null);
  const [extendFor, setExtendFor] = useState<RenewalRow | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clear() { setSelected(new Set()); }

  const sel = rows.filter(o => selected.has(o.id));
  const n = sel.length;
  const single = n === 1;

  // Pending-renewal sub-matrix on the Renewal-paid tab (canon updateRenewalsBulkBar):
  // all-pending → Mark paid + Cancel renewal · mixed → Cancel renewal only · none → Resolve + Cancel+refund.
  const pendingCount = sel.filter(o => o.status === 'PENDING_RENEWAL').length;
  const allPending = n > 0 && pendingCount === n;
  const somePending = pendingCount > 0;

  // Extend/Revive/Resolve is single-only. Resolve is gated to RENEWAL_NOT_EXTENDED rows.
  const canExtend = single && (view === 'renewed'
    ? (sel[0].exception === 'RENEWAL_NOT_EXTENDED')
    : true);
  const canMarkPaid = single && allPending && !!sel[0].paymentId;

  async function bulkCancel(reason: string, label: string) {
    start(async () => {
      let ok = 0, failed = 0;
      for (const o of sel) {
        try { await cancelOrderAction(o.id, reason); ok++; } catch { failed++; }
      }
      toast(`${label} · ${ok}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`, '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  function markPaid() {
    const pid = single ? sel[0].paymentId : null;
    if (!pid) return;
    start(async () => {
      try {
        await markPaidAction(pid, 'renewals-bulk');
        toast('Payment confirmed', `Renewal payment ${pid} marked paid`, 'success');
        clear();
        router.refresh();
      } catch (e: any) {
        toast('Mark paid failed', e?.message ?? 'Could not confirm payment', 'warning');
      }
    });
  }

  return (
    <>
      <div className={`bulk-bar ${n > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{n} selected</span>
        <div className="bulk-actions">
          {/* Renewal-paid · pending-renewal selection */}
          {view === 'renewed' && allPending && canMarkPaid && (
            <button className="btn sm primary" disabled={pending} onClick={markPaid}>Mark paid</button>
          )}
          {view === 'renewed' && somePending && (
            <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('cancelRenewal')}>Cancel renewal</button>
          )}
          {/* Renewal-paid · completed renewals */}
          {view === 'renewed' && !somePending && (
            <>
              {canExtend && <button className="btn sm" disabled={pending} onClick={() => setExtendFor(sel[0])}>{extendLabel(view)}</button>}
              <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('cancelRefund')}>Cancel + refund</button>
            </>
          )}
          {/* Expiring / grace / expired windows */}
          {view !== 'renewed' && single && (
            <button className="btn sm" disabled={pending} onClick={() => setExtendFor(sel[0])}>{extendLabel(view)}</button>
          )}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt">
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 'var(--anchor-id)' }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(5) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(4) }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk"></th>
              <th className="col-id">Order ID</th>
              <th className="col-id">Client ID</th>
              <th className="col-id">Proxy ID</th>
              <th className="col-text">Plan</th>
              <th className="col-date">Expires</th>
              <th className="col-date">Last reminder</th>
              <th className="col-status">Status</th>
              <th className="col-status">Auto-renew</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9}><div className="empty"><div className="empty-desc">No orders in this bucket.</div></div></td></tr>
            ) : rows.map(o => (
              <tr key={o.id} style={selected.has(o.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                <td className="col-chk">
                  <span className={`chk ${selected.has(o.id) ? 'checked' : ''}`} onClick={() => toggle(o.id)} />
                </td>
                <td className="col-id"><span className="cell-tip" data-tip={o.id}><Link href={`/admin/orders/${o.id}`} className="td-link">{o.id}</Link></span></td>
                <td className="col-id">{o.clientId ? <span className="cell-tip" data-tip={o.clientId}><Link href={`/admin/clients/${o.clientId}`} className="client-link">{o.clientId}</Link></span> : '—'}</td>
                <td className="col-id">
                  {o.status === 'PENDING_RENEWAL'
                    ? <span className="muted">—</span>
                    : o.proxyId
                      ? <span className="cell-tip" data-tip={o.proxyId}><Link href={`/admin/proxies/${o.proxyId}`} className="td-link">{o.proxyId}</Link></span>
                      : <span className="chip released">Released</span>}
                </td>
                <td className="col-text muted"><span className="cell-tip" data-tip={o.planName}>{o.planName}</span></td>
                <td className="col-date">{fmtAdminStamp(o.expiresAt)}</td>
                <td className={`col-date ${o.lastReminderAt ? '' : 'muted'}`}>{o.lastReminderAt ? fmtAdminStamp(o.lastReminderAt) : '—'}</td>
                <td className="col-status">{statusChip(o)}</td>
                <td className="col-status"><span className={`chip ${o.autoRenew ? 'active' : 'expired'}`}>{o.autoRenew ? 'ON' : 'OFF'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {extendFor && (
        <ExtendOrderModal
          open={!!extendFor}
          onClose={() => setExtendFor(null)}
          orderId={extendFor.id}
          currentQty={extendFor.qty}
          currentDuration={extendFor.planDuration}
          currentExpiry={extendFor.expiresAt}
        />
      )}

      <ConfirmAction
        open={confirm === 'cancelRefund'} onClose={() => setConfirm(null)}
        title={`Cancel and refund ${n} ${n === 1 ? 'order' : 'orders'}`}
        message="Cancellation rolls back the renewal and returns the proxies to their pools. Paid orders get a refund-pending exception for finance review."
        impact={['Order status → CANCELLED for each', 'Active proxies returned to pool', 'Paid renewals get a refund-pending exception']}
        requireReason confirmLabel="Cancel + refund" confirmTone="danger"
        onConfirm={async ({ reason }) => { await bulkCancel(reason!, 'Cancelled + refund'); setConfirm(null); }}
      />

      <ConfirmAction
        open={confirm === 'cancelRenewal'} onClose={() => setConfirm(null)}
        title={`Cancel ${n} renewal ${n === 1 ? 'request' : 'requests'}`}
        message="Cancels the pending-renewal request before grace expires. The original order it replaces is untouched."
        impact={['Pending-renewal order → CANCELLED', 'The current active order is unaffected', 'Action is logged with the operator']}
        requireReason confirmLabel="Cancel renewal" confirmTone="danger"
        onConfirm={async ({ reason }) => { await bulkCancel(reason!, 'Renewals cancelled'); setConfirm(null); }}
      />
    </>
  );
}
