'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { markPaidAction } from '@/lib/admin-actions';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';

type Row = {
  id: string;
  orderId: string | null;
  clientId: string | null;
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
const FLEX = (w: number) => `calc((100% - 392px) * ${w} / 19)`;
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
        <table className="dt">
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 'var(--anchor-id)' }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(6) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: 'var(--anchor-date)' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk"></th>
              <th className="col-id">Payment ID</th>
              <th className="col-id">Order ID</th>
              <th className="col-id">Client ID</th>
              <th className="col-text">Provider · Method</th>
              <th className="col-money">Amount</th>
              <th className="col-status">Status</th>
              <th className="col-date">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={8}><div className="empty"><div className="empty-desc">No payments match the current view.</div></div></td></tr>
            ) : payments.map(p => (
              <tr key={p.id} style={selected.has(p.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                <td className="col-chk">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} style={{ accentColor: 'var(--accent)' }} />
                </td>
                <td className="col-id"><Link href={`/admin/payments/${p.id}`} className="td-link">{p.id}</Link></td>
                <td className="col-id">{p.orderId ? <Link href={`/admin/orders/${p.orderId}`} className="td-link">{p.orderId}</Link> : <span className="muted">—</span>}</td>
                <td className="col-id">{p.clientId ? <Link href={`/admin/clients/${p.clientId}`} className="client-link">{p.clientId}</Link> : <span className="muted">—</span>}</td>
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
