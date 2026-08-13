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
      // Keep the first real reason: MarkPaid can now hard-refuse (e.g. the
      // order was cancelled), and "1 failed" with no explanation left the
      // admin guessing (re-review C9).
      let firstErr = '';
      for (const p of sel) {
        try { await markPaidAction(p.id, 'bulk-confirm'); ok++; }
        catch (e: any) { failed++; if (!firstErr) firstErr = `${p.id}: ${e?.message ?? 'failed'}`; }
      }
      toast(`Confirmed · ${ok}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`, firstErr, failed ? 'warning' : 'success');
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
        <table className="dt" style={{ minWidth: 1170 }}>
          {/* colgroup (9 cols). B*=1170: chk 55, Payment ID 110, Type 84,
              Order ID 110, Client 220 (composite id-over-email, see the cell
              below — 220 clears the longest live client email at 11.5px so
              nothing needs a hover), Provider·Method auto (~185, wraps at the
              ·), Amount 105, Status 155, Date 146. Type is 84 (not the older
              74) because "Deposit" needs 80 (48 + 2×16 pad) and was breaking
              mid-word. Plain % of 1170. */}
          <colgroup>
            <col style={{ width: '4.7009%' }} />
            <col style={{ width: '9.4017%' }} />
            <col style={{ width: '7.1795%' }} />
            <col style={{ width: '9.4017%' }} />
            <col style={{ width: '18.8034%' }} />
            <col />
            <col style={{ width: '8.9744%' }} />
            <col style={{ width: '13.2479%' }} />
            <col style={{ width: '12.4786%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk"></th>
              <th className="col-id">Payment ID</th>
              <th className="col-text">Type</th>
              <th className="col-id">Order ID</th>
              <th className="col-id">Client</th>
              <th className="col-text">Provider · Method</th>
              <th className="col-money">Amount</th>
              <th className="col-status">Status</th>
              <th className="col-date">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={9}><div className="empty"><div className="empty-desc">No payments match the current view.</div></div></td></tr>
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
                <td className="col-id">{p.clientId ? (
                  <div className="client-cell-body">
                    <div className="client-cell-name"><Link href={`/admin/clients/${p.clientId}`} className="client-link">{p.clientId}</Link></div>
                    {p.clientEmail && <div className="client-cell-contact cell-tip" data-tip={p.clientEmail}>{p.clientEmail}</div>}
                  </div>
                ) : <span className="muted">—</span>}</td>
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
