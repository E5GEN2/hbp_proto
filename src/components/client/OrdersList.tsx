'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { fmtAdminStamp } from '@/lib/date';
import { money } from '@/lib/money';
import * as CA from '@/lib/ui-actions/client-actions';

export type OrderRow = {
  id: string;
  planLabel: string;
  region: string;
  qty: number;
  amount: number;
  status: string;
  paymentStatus: string;
  autoRenew: boolean;
  createdAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
  cancelledAt: number | null;
};

type Tab = 'active' | 'expiring' | 'past';
const DAY = 86_400_000;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const PAID = ['PAID', 'CONFIRMED', 'FREE'];

function tabGroups(o: OrderRow, now: number): Tab[] {
  const groups: Tab[] = [];
  if (o.status === 'ACTIVE' || o.status === 'NEW' || o.status === 'PROVISIONING') {
    groups.push('active');
    if (o.status === 'ACTIVE' && o.expiresAt && o.expiresAt - now <= 7 * DAY && o.expiresAt - now > 0) groups.push('expiring');
  } else if (o.status === 'EXPIRED' || o.status === 'CANCELLED') {
    groups.push('past');
  }
  return groups;
}

function daysLeftBucket(o: OrderRow, now: number): { d: number | null; tone: string; label: string } {
  if (!o.expiresAt) return { d: null, tone: '', label: '' };
  const d = Math.round((o.expiresAt - now) / DAY);
  if (d < 0) return { d, tone: 'danger', label: `Expired ${Math.abs(d)}d ago` };
  if (d === 0) return { d, tone: 'danger', label: 'Expires today' };
  if (d <= 2) return { d, tone: 'danger', label: `${d}d left` };
  if (d <= 5) return { d, tone: 'warning', label: `${d}d left` };
  return { d, tone: '', label: `${d}d left` };
}

const EMPTY_COPY: Record<Tab, { title: string; desc: string }> = {
  active: { title: 'No active orders.', desc: "When you buy a plan, it shows up here while it's running." },
  expiring: { title: 'No orders expiring soon.', desc: "You're in the clear for the next 7 days." },
  past: { title: 'No past orders.', desc: 'Expired and cancelled orders will appear here.' },
};

export function OrdersList({ orders, initialTab }: { orders: OrderRow[]; initialTab?: string }) {
  const router = useRouter();
  const toast = useToast();
  const now = Date.now();

  const valid: Tab[] = ['active', 'expiring', 'past'];
  const [tab, setTab] = useState<Tab>(valid.includes(initialTab as Tab) ? (initialTab as Tab) : 'active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const counts: Record<Tab, number> = { active: 0, expiring: 0, past: 0 };
  for (const o of orders) for (const g of tabGroups(o, now)) counts[g] += 1;

  const list = orders.filter(o => tabGroups(o, now).includes(tab)).sort((a, b) => b.createdAt - a.createdAt);

  async function doRenew(id: string) {
    setBusyId(id);
    try {
      const r = (await CA.clientRenewOrderAction(id)) as { redirect?: string; newExpiry?: string | number | Date };
      if (r?.redirect) {
        toast('Insufficient balance', 'Redirecting to checkout', 'info');
        router.push(r.redirect);
        return;
      }
      const exp = r && 'newExpiry' in r ? r.newExpiry : null;
      toast('Order renewed', exp ? `New expiry: ${fmtAdminStamp(new Date(exp))}` : '', 'success');
      router.refresh();
    } catch (e: any) {
      toast('Renewal failed', e.message, 'danger');
    } finally {
      setBusyId(null);
    }
  }

  async function doCancel(id: string) {
    setBusyId(id);
    try {
      await CA.clientCancelOrderAction(id);
      toast('Order cancelled', id, 'warning');
      setCancelTarget(null);
      router.refresh();
    } catch (e: any) {
      toast('Failed', e.message, 'danger');
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'expiring', label: 'Expiring' },
    { key: 'past', label: 'Past' },
  ];

  return (
    <>
      <div className="tabs">
        {tabs.map(t => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label} <span className="tab-count">{counts[t.key]}</span>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty" style={{ padding: '64px 20px' }}>
          <div className="empty-title">{EMPTY_COPY[tab].title}</div>
          <div className="empty-desc">{EMPTY_COPY[tab].desc}</div>
          <Link className="btn primary" href="/catalog" style={{ marginTop: 12 }}>
            Browse plans
          </Link>
        </div>
      ) : (
        <div className="orders-grid">
          {list.map(o => (
            <OrderCard
              key={o.id}
              o={o}
              now={now}
              busy={busyId === o.id}
              onOpen={() => router.push(`/orders/${o.id}`)}
              onRenew={() => doRenew(o.id)}
              onCancel={() => setCancelTarget(o.id)}
              onContinue={() => router.push(`/checkout?resume=${o.id}`)}
            />
          ))}
        </div>
      )}

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel order"
        footer={
          <>
            <button className="btn" onClick={() => setCancelTarget(null)} disabled={busyId !== null}>
              Keep order
            </button>
            <button className="btn danger" onClick={() => cancelTarget && doCancel(cancelTarget)} disabled={busyId !== null}>
              {busyId ? '…' : 'Cancel order'}
            </button>
          </>
        }
      >
        <div className="t-body">
          This will cancel <span className="mono">{cancelTarget}</span>. Payment hasn&rsquo;t cleared, so nothing has been charged.
        </div>
      </Modal>
    </>
  );
}

function OrderCard({
  o,
  now,
  busy,
  onOpen,
  onRenew,
  onCancel,
  onContinue,
}: {
  o: OrderRow;
  now: number;
  busy: boolean;
  onOpen: () => void;
  onRenew: () => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const b = daysLeftBucket(o, now);
  const expiringSoon = o.status === 'ACTIVE' && b.d != null && b.d > 0 && b.d <= 7;
  const statusLower = o.status.toLowerCase();
  const payLower = o.paymentStatus.toLowerCase();
  const isPaid = PAID.includes(o.paymentStatus);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const dates: ReactNode =
    o.status === 'PROVISIONING' ? (
      <>
        <strong>Placed</strong> {fmtAdminStamp(new Date(o.createdAt))} · <span className="order-card-days warning">Awaiting fulfillment</span>
      </>
    ) : o.status === 'CANCELLED' ? (
      <>
        <strong>Cancelled</strong> {fmtAdminStamp(new Date(o.cancelledAt ?? o.createdAt))}
      </>
    ) : o.activatedAt ? (
      <>
        <strong>Activated</strong> {fmtAdminStamp(new Date(o.activatedAt))} · <strong>Expires</strong> {fmtAdminStamp(o.expiresAt ? new Date(o.expiresAt) : null)}
      </>
    ) : o.expiresAt ? (
      <>
        <strong>Expires</strong> {fmtAdminStamp(new Date(o.expiresAt))}
      </>
    ) : (
      <>
        <strong>Placed</strong> {fmtAdminStamp(new Date(o.createdAt))}
      </>
    );

  const inlineDayBadge =
    b.label && o.status !== 'CANCELLED' ? (
      <>
        {' '}
        · <span className={`order-card-days ${b.tone}`}>{b.label}</span>
      </>
    ) : null;

  let actions: ReactNode;
  const expiringActive = o.status === 'ACTIVE' && o.expiresAt && b.d != null && b.d > 0 && b.d <= 7;
  if (o.status === 'EXPIRED') {
    actions = (
      <button className="btn primary" onClick={e => { stop(e); onRenew(); }} disabled={busy}>
        {busy ? '…' : 'Renew'}
      </button>
    );
  } else if (expiringActive) {
    actions = (
      <>
        <button className="btn primary" onClick={e => { stop(e); onRenew(); }} disabled={busy}>
          {busy ? '…' : 'Renew'}
        </button>
        <Link className="btn ghost" href={`/orders/${o.id}`} onClick={stop}>
          View details
        </Link>
      </>
    );
  } else if (o.status === 'NEW' && (o.paymentStatus === 'PENDING' || o.paymentStatus === 'AWAITING')) {
    actions = (
      <>
        <button className="btn primary" onClick={e => { stop(e); onContinue(); }}>
          Complete payment
        </button>
        <button className="btn ghost" onClick={e => { stop(e); onCancel(); }} disabled={busy}>
          Cancel
        </button>
      </>
    );
  } else {
    actions = (
      <Link className="btn ghost" href={`/orders/${o.id}`} onClick={stop}>
        View details
      </Link>
    );
  }

  return (
    <div className="order-card" onClick={onOpen}>
      <div className="order-card-body">
        <div className="order-card-top">
          <span className="order-card-id">{o.id}</span>
          <div className="order-card-chips">
            {expiringSoon ? (
              <span className={`chip ${b.tone || 'warning'}`}>Expiring</span>
            ) : (
              <span className={`chip ${statusLower}`}>{cap(statusLower)}</span>
            )}
            {!isPaid && o.status !== 'CANCELLED' && <span className={`chip ${payLower}`}>{cap(payLower)}</span>}
            {o.autoRenew && o.status === 'ACTIVE' && !expiringSoon && (
              <span className="chip muted" title="Auto-renew on">
                Auto-renew
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="order-card-plan">{o.planLabel}</div>
          <div className="order-card-meta">
            {o.region || '—'} · {o.qty} {o.qty === 1 ? 'proxy' : 'proxies'}
          </div>
        </div>
        <div className="order-card-meta">
          {dates}
          {inlineDayBadge}
        </div>
      </div>
      <div className="order-card-foot">
        <span className="order-card-amount">{money(o.amount)}</span>
        <div className="order-card-actions">{actions}</div>
      </div>
    </div>
  );
}
