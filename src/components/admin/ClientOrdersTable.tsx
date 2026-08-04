'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState } from 'react';
import Link from 'next/link';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { PAY_CHIP, PAY_LABEL } from '@/lib/payment-display';

type Row = {
  id: string;
  planName: string;
  proxies: string[];
  periodStart: Date;
  periodEnd: Date | null;
  amount: number;
  paymentStatus: string;
  paymentId: string | null;
  autoRenew: boolean;
  status: string;
  exception: string | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const dateOnly = (d: Date) => fmtAdminStamp(d).split('·')[0].trim();
// Canon Client-Detail Orders table: 8 flex cols, --col-total 26.

const FILTERS: Record<string, (o: Row) => boolean> = {
  all: () => true,
  active: o => o.status === 'ACTIVE',
  expired: o => o.status === 'EXPIRED',
  cancelled: o => o.status === 'CANCELLED',
  problem: o => !!o.exception,
};

export function ClientOrdersTable({ orders }: { orders: Row[] }) {
  const [filter, setFilter] = useState('all');
  const rows = orders.filter(FILTERS[filter] ?? (() => true)).slice(0, 10);

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Orders</span>
        <FormSelect
          value={filter}
          onChange={setFilter}
          btnClassName="orders-filter-select"
          wrapStyle={{ width: 'fit-content' }}
          options={[
            { value: 'all', label: 'Orders: all' },
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'problem', label: 'Problem orders' },
          ]}
        />
      </div>
      <div className="table-wrap">
        <table className="dt" style={{ minWidth: 905 }}>
          {/* ATS colgroup, pan-variant (owner: keep every column). B*=905 =
              min-width; the in-panel wrapper pans below that and the table
              stops compressing. Anchors: Order ID 107, Proxy ID 107, Period
              140 ("28 May → 27 Jun"), Amount 98 ("$9,999.99" + pads), Payment 126 (chip-clip:
              "Refund requested" clips WITH tooltip), Auto-renew 114, Status
              138 ("Pending renewal" fits); Plan auto (min ~90). */}
          <colgroup>
            <col style={{ width: '11.8232%' }} />
            <col />
            <col style={{ width: '11.8232%' }} />
            <col style={{ width: '15.4696%' }} />
            <col style={{ width: '10.8287%' }} />
            <col style={{ width: '13.9227%' }} />
            <col style={{ width: '12.5967%' }} />
            <col style={{ width: '15.2486%' }} />
          </colgroup>
          <thead><tr>
            <th className="col-id">Order ID</th>
            <th className="col-text">Plan</th>
            <th className="col-id">Proxy ID</th>
            <th className="col-date">Period</th>
            <th className="col-money">Amount</th>
            <th className="col-status">Payment</th>
            <th className="col-status">Auto-renew</th>
            <th className="col-status">Status</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '18px 20px', textAlign: 'center', color: 'var(--muted)' }}>{orders.length === 0 ? 'No orders yet.' : 'No orders match this filter.'}</td></tr>
            ) : rows.map(o => (
              <tr key={o.id}>
                <td className="col-id"><span className="cell-tip" data-tip={o.id}><Link href={`/admin/orders/${o.id}`} className="td-link">{o.id}</Link></span></td>
                <td className="col-text muted"><span className="cell-tip" data-tip={o.planName}>{o.planName}</span></td>
                <td className="col-id">
                  {o.proxies.length === 0 ? <span className="muted">—</span>
                    : o.proxies.length === 1 ? <span className="cell-tip" data-tip={o.proxies[0]}><Link href={`/admin/proxies/${o.proxies[0]}`} className="td-link">{o.proxies[0]}</Link></span>
                    : <Link href={`/admin/orders/${o.id}`} className="td-link">Proxies <span className="muted">({o.proxies.length})</span></Link>}
                </td>
                <td className="col-date"><span className="period-cell"><span className="period-range">{dateOnly(o.periodStart)} → {o.periodEnd ? dateOnly(o.periodEnd) : '—'}</span></span></td>
                <td className="col-money">{money(o.amount)}</td>
                <td className="col-status">
                  {o.paymentId
                    ? <Link href={`/admin/payments/${o.paymentId}`} className="td-link"><span className={`chip ${PAY_CHIP[o.paymentStatus] ?? ''} cell-tip chip-clip`} data-tip={PAY_LABEL[o.paymentStatus] ?? o.paymentStatus}>{PAY_LABEL[o.paymentStatus] ?? o.paymentStatus}</span></Link>
                    : <span className={`chip ${PAY_CHIP[o.paymentStatus] ?? ''} cell-tip chip-clip`} data-tip={PAY_LABEL[o.paymentStatus] ?? o.paymentStatus}>{PAY_LABEL[o.paymentStatus] ?? o.paymentStatus}</span>}
                </td>
                <td className="col-status"><span className={`chip ${o.autoRenew ? 'active' : 'expired'}`}>{o.autoRenew ? 'ON' : 'OFF'}</span></td>
                <td className="col-status"><span className={`chip ${o.status.toLowerCase().replace(/_/g, '-')}`}>{cap(o.status.replace(/_/g, ' '))}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
