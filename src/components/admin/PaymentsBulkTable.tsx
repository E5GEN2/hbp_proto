'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { markPaidAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

type Row = {
  id: string;
  kind: string; // 'ORDER' | 'TOPUP'
  orderId: string | null;
  clientId: string | null;
  clientEmail: string | null;
  provider: string;
  method: string;
  gross: number;
  status: string;
  statusChip: string;
  statusLabel: string;
  createdAt: Date;
};

// Canon .dt anchor scheme: 64px chk + 164px Payment ID + 164px Date R-anchor
// = 392px fixed; middle cols share the slack by --w weights (col-total 19).
const CONFIRMABLE = new Set(['AWAITING', 'PENDING', 'FAILED', 'MANUAL_REVIEW']);

export function PaymentsBulkTable({ payments }: { payments: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clear() { setSelected(new Set()); }

  const sel = payments.filter(p => selected.has(p.id));
  const canConfirm = sel.length > 0 && sel.every(p => CONFIRMABLE.has(p.status));

  function confirmSelected() {
    start(async () => {
      let ok = 0, failed = 0;
      for (const p of sel) {
        try { await markPaidAction(p.id, 'bulk-confirm'); ok++; } catch { failed++; }
      }
      toast(`Confirmed · ${ok}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`, '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  return (
    <>
      <div className={`bulk-bar ${selected.size > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{selected.size} selected</span>
        <div className="bulk-actions">
          {canConfirm && <button className="btn sm primary" disabled={pending} onClick={confirmSelected}>Confirm payment</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt" style={{ minWidth: 1250 }}>
          {/* colgroup (10 cols). Same px anchors as before at the new budget
              B*=1250: chk 55, Payment ID 110, Type 84, Order/Client ID 110,
              Email 190 (fits ~24 chars on one line; longer wraps per the
              no-ellipsis rule), Provider·Method auto (~186, wraps at the ·),
              Amount 105, Status 155, Date 146. minWidth bumped 1060→1250 for
              the added Email column. Type went 74→84 because "Deposit" needs
              80 (48 + 2×16 pad) and was breaking mid-word at 74; the 10px come
              out of the auto column, so B* is unaffected. */}
          <colgroup>
            <col style={{ width: '4.4360%' }} />
            <col style={{ width: '8.7872%' }} />
            <col style={{ width: '6.7200%' }} />
            <col style={{ width: '8.7872%' }} />
            <col style={{ width: '8.7872%' }} />
            <col style={{ width: '15.2000%' }} />
            <col />
            <col style={{ width: '8.3600%' }} />
            <col style={{ width: '12.3680%' }} />
            <col style={{ width: '11.6880%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk"></th>
              <th className="col-id">Payment ID</th>
              <th className="col-text">Type</th>
              <th className="col-id">Order ID</th>
              <th className="col-id">Client ID</th>
              <th className="col-text">Email</th>
              <th className="col-text">Provider · Method</th>
              <th className="col-money">Amount</th>
              <th className="col-status">Status</th>
              <th className="col-date">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={10}><div className="empty"><div className="empty-desc">No payments match the current view.</div></div></td></tr>
            ) : payments.map(p => (
              <tr key={p.id} style={selected.has(p.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                <td className="col-chk">
                  <span className={`chk ${selected.has(p.id) ? 'checked' : ''}`} onClick={() => toggle(p.id)} />
                </td>
                <td className="col-id"><span className="cell-tip" data-tip={p.id}><Link href={`/admin/payments/${p.id}`} className="td-link">{p.id}</Link></span></td>
                <td className="col-text">{p.kind === 'TOPUP'
                  ? <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Deposit</span>
                  : <span className="muted">Order</span>}</td>
                <td className="col-id">{p.orderId ? <span className="cell-tip" data-tip={p.orderId}><Link href={`/admin/orders/${p.orderId}`} className="td-link">{p.orderId}</Link></span> : <span className="muted">—</span>}</td>
                <td className="col-id">{p.clientId ? <span className="cell-tip" data-tip={p.clientId}><Link href={`/admin/clients/${p.clientId}`} className="client-link">{p.clientId}</Link></span> : <span className="muted">—</span>}</td>
                <td className="col-text">{p.clientEmail ? <span className="cell-tip" data-tip={p.clientEmail}>{p.clientEmail}</span> : <span className="muted">—</span>}</td>
                <td className="col-text muted">{p.provider} · {p.method}</td>
                <td className="col-money">{money(p.gross)}</td>
                <td className="col-status"><span className={`chip ${p.statusChip}`}>{p.statusLabel}</span></td>
                <td className="col-date">{fmtAdminStamp(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
