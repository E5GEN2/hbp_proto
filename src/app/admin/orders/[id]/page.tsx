import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { CancelOrderButton, SuspendButton, ResumeButton, ExtendButton, SendCredentialsButton, ReplaceProxyButton, RefundButton } from '@/components/admin/ActionButtons';
import { OrderDetailActions } from '@/components/admin/toolbars/OrderDetailActions';
import { AddNoteToolbar } from '@/components/admin/toolbars/AddNoteToolbar';
import { EntityNotesPanel } from '@/components/admin/EntityNotesPanel';
import { EntityActivityWidget } from '@/components/admin/EntityActivityWidget';

// Exception → header chip (short label + exc-chip tone) and the
// top-of-page exception banner copy. Mirrors the canon excLabels /
// excBannerCopy maps, keyed by the OrderException enum.
const EXC_LABEL: Record<string, { short: string; tone: string }> = {
  PAID_NOT_PROVISIONED: { short: 'Paid, not provisioned', tone: 'danger' },
  RENEWAL_NOT_EXTENDED: { short: 'Renewal paid, not extended', tone: 'violet' },
  RENEWAL_FAULTY_PROXY: { short: 'Renewal · faulty proxy', tone: 'violet' },
  REPLACEMENT_PENDING: { short: 'Replacement pending', tone: 'accent' },
  REFUND_PENDING: { short: 'Refund review', tone: '' },
};
const EXC_BANNER: Record<string, { title: string; tone: string; desc: string }> = {
  PAID_NOT_PROVISIONED: { title: 'Paid but not provisioned', tone: 'danger', desc: 'Payment cleared but the order is stuck in provisioning. Inspect the step that failed and resolve below.' },
  RENEWAL_NOT_EXTENDED: { title: 'Renewal paid but not extended', tone: 'violet', desc: 'A renewal payment confirmed but the expiry date did not advance. Extend manually to match the paid period.' },
  RENEWAL_FAULTY_PROXY: { title: 'Renewed with faulty proxy', tone: 'violet', desc: 'Renewal completed (period extended) but at least one proxy on this order is currently faulty/offline. Run Replace to swap it for a healthy proxy from the pool.' },
  REPLACEMENT_PENDING: { title: 'Replacement requested, not done', tone: '', desc: 'The assigned proxy was marked faulty but no replacement has been issued. Pick a new proxy from the pool.' },
  REFUND_PENDING: { title: 'Refund review queued', tone: '', desc: 'The order was cancelled while paid. Finance must close the loop with a refund decision before the case is resolved.' },
};

// Payment statuses that warrant a header chip. Clean PAID/CONFIRMED/FREE
// are dropped from the header (the lifecycle chip is the canonical state).
const ATTENTION_PAY = new Set(['AWAITING', 'PENDING', 'FAILED', 'REFUNDED', 'MANUAL_REVIEW', 'REFUND_REQUESTED', 'REPLACEMENT']);
const PROVIDER_AUTO = new Set(['stripe', 'coinbase', 'paypal']);

type Step = { name: string; state: 'done' | 'current' | 'pending' | 'failed' | 'cancelled'; meta: string; mode: 'auto' | 'manual' };
const STATE_CHIP: Record<Step['state'], string> = { done: 'active', current: 'new', pending: 'expired', failed: 'failed', cancelled: 'expired' };
const STATE_LABEL: Record<Step['state'], string> = { done: 'Done', current: 'Current', pending: 'Pending', failed: 'Blocked', cancelled: 'Cancelled' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export default async function AdminOrderDetail({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      plan: true,
      payments: { orderBy: { createdAt: 'desc' } },
      assignments: { include: { proxy: true }, orderBy: { assignedAt: 'asc' } },
      replacedBy: { select: { id: true, status: true } },
    },
  });
  if (!order) notFound();

  // Proxies still needed + prefetch candidates for the Assign modal
  const activeAssignments = order.assignments.filter(a => a.releasedAt === null).length;
  const qtyNeeded = Math.max(0, order.qty - activeAssignments);
  const showAssign = (qtyNeeded > 0 && order.paymentStatus === 'PAID') || order.exception === 'PAID_NOT_PROVISIONED';
  const wasPaid = order.paymentStatus === 'PAID' || order.paymentStatus === 'CONFIRMED';

  const candidates = showAssign ? await prisma.proxy.findMany({
    where: { carrier: order.plan.carrier, region: order.region, status: 'AVAILABLE', health: 'HEALTHY' },
    take: 20,
    orderBy: [{ pool: 'asc' }, { id: 'asc' }],
  }) : [];

  // Resolve assignment actor names (actorId has no FK relation).
  const actorIds = [...new Set(order.assignments.map(a => a.actorId).filter(Boolean))] as string[];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map(u => [u.id, u.name] as const));

  // ─── Provisioning step derivation (Payment · Proxy · Activation) ────
  const payment = order.payments[0] ?? null;
  const paid = ['PAID', 'CONFIRMED', 'FREE'].includes(order.paymentStatus);
  const payAwait = ['AWAITING', 'PENDING'].includes(order.paymentStatus);
  const payFailed = order.paymentStatus === 'FAILED';
  const hasProxy = activeAssignments > 0;
  const credsSent = !!order.credentialsSentAt;
  const autoOn = order.autoProvision !== false;
  const manualMode = order.manualProvisioning === true;
  const hasOverride = order.manualFulfillmentOverride === true;
  const paymentMode: Step['mode'] = payment && PROVIDER_AUTO.has((payment.provider ?? '').toLowerCase()) ? 'auto' : 'manual';
  const fulfilMode: Step['mode'] = (autoOn && !manualMode) ? 'auto' : 'manual';
  const amountStr = money(Number(order.amount));

  const steps: Step[] = [];

  // Payment
  if (paid) {
    const meta = [payment ? fmtAdminStamp(payment.createdAt) : null, amountStr, payment?.provider, payment?.method].filter(Boolean).join(' · ') || 'Paid';
    steps.push({ name: 'Payment', state: 'done', meta, mode: paymentMode });
  } else if (hasOverride) {
    steps.push({ name: 'Payment', state: 'done', meta: `Payment state: ${cap(order.paymentStatus)} · ${amountStr} · manual fulfillment override`, mode: paymentMode });
  } else if (manualMode) {
    const payLabel = payFailed ? 'Payment failed' : payAwait ? 'Payment awaiting' : 'Payment unconfirmed';
    steps.push({ name: 'Payment', state: 'pending', meta: `${payLabel} · ${amountStr} · admin override`, mode: paymentMode });
  } else if (payFailed) {
    steps.push({ name: 'Payment', state: 'failed', meta: `Payment failed · ${amountStr}`, mode: paymentMode });
  } else if (payAwait) {
    const meta = payment?.provider ? ['Awaiting', amountStr, payment.provider].filter(Boolean).join(' · ') : `Awaiting client · ${amountStr}`;
    steps.push({ name: 'Payment', state: 'current', meta, mode: paymentMode });
  } else {
    steps.push({ name: 'Payment', state: 'pending', meta: `Awaiting · ${amountStr}`, mode: paymentMode });
  }

  // Proxy
  if (hasProxy) {
    const first = order.assignments.find(a => a.releasedAt === null);
    const label = activeAssignments > 1 ? `${activeAssignments} proxies assigned` : `Assigned ${first?.proxyId ?? ''}`;
    steps.push({ name: 'Proxy', state: 'done', meta: label, mode: fulfilMode });
  } else if (order.exception === 'PAID_NOT_PROVISIONED') {
    steps.push({ name: 'Proxy', state: 'failed', meta: 'Stuck — no proxy from pool', mode: fulfilMode });
  } else if (order.exception === 'REPLACEMENT_PENDING') {
    steps.push({ name: 'Proxy', state: 'failed', meta: 'Replacement pending', mode: fulfilMode });
  } else if (paid || manualMode) {
    steps.push({ name: 'Proxy', state: 'current', meta: (autoOn && !manualMode) ? 'Picking from pool…' : 'Manual assignment required', mode: fulfilMode });
  } else {
    steps.push({ name: 'Proxy', state: 'pending', meta: 'Awaiting payment', mode: fulfilMode });
  }

  // Activation
  const channelLabel = order.credentialsChannel === 'TELEGRAM' ? 'Telegram' : order.credentialsChannel === 'BOTH' ? 'email + Telegram' : order.credentialsChannel === 'EMAIL' ? 'email' : null;
  const credsMeta = channelLabel ? `credentials sent · ${channelLabel}` : 'credentials available in portal';
  if (credsSent) {
    steps.push({ name: 'Activation', state: 'done', meta: `${fmtAdminStamp(order.credentialsSentAt)} · ${credsMeta}`, mode: fulfilMode });
  } else if (hasProxy) {
    steps.push({ name: 'Activation', state: 'current', meta: (autoOn && !manualMode) ? 'Sending credentials…' : 'Manual required — Send credentials', mode: fulfilMode });
  } else {
    steps.push({ name: 'Activation', state: 'pending', meta: 'Awaiting proxy', mode: fulfilMode });
  }

  // Cancelled orders: the pipeline is history, not a to-do. Freeze every
  // unfinished step (done steps stay as the paper trail) so nothing reads as
  // work awaiting an admin.
  const orderCancelled = order.status === 'CANCELLED';
  if (orderCancelled) {
    for (const s of steps) {
      if (s.state !== 'done') { s.state = 'cancelled'; s.meta = 'Order cancelled'; }
    }
  }

  // Panel-level provisioning status chip
  let provClass: string, provLabel: string;
  if (orderCancelled) { provClass = 'expired'; provLabel = 'Cancelled'; }
  else if (steps.some(s => s.state === 'failed')) { provClass = 'failed'; provLabel = 'Needs attention'; }
  else if (steps.every(s => s.state === 'done')) { provClass = 'active'; provLabel = 'Completed'; }
  else if (manualMode) { provClass = 'pending'; provLabel = 'Manual required'; }
  else if (!paid) { provClass = 'expired'; provLabel = 'Pending'; }
  else if (!autoOn && steps.some(s => s.state === 'current')) { provClass = 'pending'; provLabel = 'Manual required'; }
  else { provClass = 'new'; provLabel = 'In progress'; }

  // Next-action hint
  let nextTone = '', nextLabel = '—';
  const failedNonPayment = steps.some(s => s.state === 'failed' && !(manualMode && s.name === 'Payment'));
  if (orderCancelled) {
    nextLabel = 'None — order cancelled';
  } else if (failedNonPayment) {
    nextTone = 'failed';
    if (order.exception === 'PAID_NOT_PROVISIONED') nextLabel = 'Assign proxy manually — pool empty';
    else if (order.exception === 'REPLACEMENT_PENDING') nextLabel = 'Replace proxy';
    else if (payFailed && !manualMode) nextLabel = 'Retry or resolve payment';
    else nextLabel = 'Resolve exception';
  } else if (steps.every(s => s.state === 'done')) {
    nextTone = 'completed'; nextLabel = 'None — completed';
  } else {
    const cur = steps.find(s => s.state !== 'done' && !(manualMode && s.name === 'Payment'));
    if (!cur) { nextTone = 'completed'; nextLabel = 'None — completed'; }
    else if (cur.name === 'Payment') { nextTone = autoOn ? '' : 'attention'; nextLabel = paymentMode === 'auto' ? 'Wait for payment' : 'Confirm payment manually (Mark paid)'; }
    else if (cur.name === 'Proxy') { nextTone = (autoOn && !manualMode) ? '' : 'attention'; nextLabel = (autoOn && !manualMode) ? 'Auto-assign proxy' : 'Assign proxy manually'; }
    else if (cur.name === 'Activation') { nextTone = (autoOn && !manualMode) ? '' : 'attention'; nextLabel = (autoOn && !manualMode) ? 'Send credentials automatically' : 'Send credentials manually'; }
  }

  // ─── Header chips ───────────────────────────────────────────────────
  const statusClass = order.status.toLowerCase().replace(/_/g, '-');
  const payChipClass = order.paymentStatus.toLowerCase().replace(/_/g, '-');
  const exc = order.exception ? EXC_LABEL[order.exception] : null;

  // ─── Header actions (canon grouping, gated to backend-supported moves) ─
  const status = order.status;
  const isCancelled = status === 'CANCELLED';
  const isExpired = status === 'EXPIRED';
  const isSuspended = status === 'SUSPENDED';
  const isActive = status === 'ACTIVE';
  const isProv = status === 'PROVISIONING';
  const paidLike = paid;
  const fullyAssigned = activeAssignments >= (order.qty || 1);
  const canSendCreds = (paidLike || manualMode) && fullyAssigned && !order.credentialsSentAt && !isCancelled && !isSuspended;

  const noteBtn = <AddNoteToolbar key="note" objectType="ORDER" objectId={order.id} label="Add note" />;
  const assignBtn = (
    <OrderDetailActions key="assign" orderId={order.id} qtyNeeded={qtyNeeded}
      candidates={candidates.map(p => ({ id: p.id, carrier: p.carrier, region: p.region, pool: p.pool, ip: p.ip, port: p.port, health: p.health }))} />
  );
  const extendBtn = <ExtendButton key="ext" orderId={order.id} currentQty={order.qty} currentDuration={order.plan.durationDays} currentExpiry={order.expiresAt} />;
  const suspendBtn = <SuspendButton key="susp" orderId={order.id} />;
  const resumeBtn = <ResumeButton key="res" orderId={order.id} />;
  const cancelBtn = <CancelOrderButton key="cancel" orderId={order.id} wasPaid={wasPaid} assignmentCount={activeAssignments} />;
  const sendCredsBtn = <SendCredentialsButton key="creds" orderId={order.id} />;

  // A cancelled paid order carries the refund-pending signal — resolve it HERE,
  // where the Exceptions/bell links land, instead of a dead-end (finding B-4).
  const refundablePay = order.exception === 'REFUND_PENDING'
    ? order.payments.find(p => ['CONFIRMED', 'PAID', 'REFUND_REQUESTED'].includes(p.status))
    : null;
  // gross, not net — matches the Payments page and refundPayment's own
  // default: the client gets the full charge back, fees are ours to eat.
  const refundBtn = refundablePay
    ? <RefundButton key="refund" paymentId={refundablePay.id} amount={Number(refundablePay.gross)} />
    : null;

  // The refund affordance rides the exception, not the status branch: a
  // REFUND_PENDING signal must be resolvable wherever its link lands.
  const withRefund = (base: ReactNode[]) => (refundBtn ? [refundBtn, ...base] : base);

  let actions: ReactNode[];
  if (isCancelled) actions = withRefund([noteBtn]);                            // terminal — extend/resume invalid
  else if (isExpired) actions = withRefund([extendBtn, noteBtn]);              // renew
  else if (isSuspended) actions = withRefund([resumeBtn, noteBtn, cancelBtn]);
  else if (isActive) actions = withRefund([extendBtn, noteBtn, suspendBtn]);  // cancel via suspend-first (canon)
  else if (isProv && hasProxy) actions = withRefund([...(canSendCreds ? [sendCredsBtn] : []), noteBtn, suspendBtn]);
  else if (isProv && !hasProxy) actions = withRefund([...(showAssign ? [assignBtn] : []), noteBtn, cancelBtn]);
  else actions = withRefund([...(showAssign ? [assignBtn] : []), noteBtn, cancelBtn]); // NEW / AWAITING / PENDING_RENEWAL

  const bannerCopy = order.exception ? EXC_BANNER[order.exception] : null;
  const bannerTone = bannerCopy?.tone === 'danger' ? 'danger' : bannerCopy?.tone === 'violet' ? 'violet' : '';

  return (
    <>
      <AdminTopbar crumbs={[
        { label: 'Orders', href: '/admin/orders' },
        { label: `Order ${order.id}` },
      ]} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div className="detail-page-shell">
        {bannerCopy && (
          <div className={`exc-banner ${bannerTone}`} style={{ marginBottom: 16 }}>
            <svg className="exc-banner-icon" width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 1 1 14h14L8 1zM8 6v4M8 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="exc-banner-body">
              <div className="exc-banner-title">Operational exception · {bannerCopy.title}</div>
              <div className="exc-banner-desc">{order.excInfo ? `${order.excInfo} — ` : ''}{bannerCopy.desc}</div>
            </div>
            <div className="exc-banner-actions">
              <Link href={`/admin/orders?exc=${order.exception}`} className="btn sm">Back to exceptions</Link>
            </div>
          </div>
        )}

        {/* Standing obligation while suspended: creds are hidden from the
            client, but the proxy is still bound and the client may have copied
            the credentials. Auto-rotation isn't wired (no upstream integration)
            — the admin must rotate password + IP-rotation link by hand. */}
        {isSuspended && (
          <div className="exc-banner danger" style={{ marginBottom: 16 }}>
            <svg className="exc-banner-icon" width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 1 1 14h14L8 1zM8 6v4M8 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="exc-banner-body">
              <div className="exc-banner-title">Manual action required · rotate proxy credentials</div>
              <div className="exc-banner-desc">Credentials are hidden from the client, but the proxy is still assigned and the client may have already copied them. Rotate the password and regenerate the IP-rotation link on the upstream now — this is not automated.</div>
            </div>
          </div>
        )}

        {/* Header — order identity + status chips + actions */}
        <div className="detail-header">
          <div className="detail-header-left">
            <div className="detail-id">{order.id}</div>
            <div className="detail-chips">
              <span className={`chip ${statusClass}`}>{cap(order.status.replace(/_/g, ' '))}</span>
              {ATTENTION_PAY.has(order.paymentStatus) && <span className={`chip ${payChipClass}`}>{cap(order.paymentStatus.replace(/_/g, ' '))}</span>}
              {exc && <span className={`exc-chip ${exc.tone}`}>{exc.short}</span>}
              {order.manualFulfillmentOverride && <span className="exc-chip">Manual fulfillment · payment {order.paymentStatus.toLowerCase()}</span>}
            </div>
            {(order.replacesOrderId || order.replacedBy) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                {order.replacesOrderId && (
                  <Link href={`/admin/orders/${order.replacesOrderId}`} className="td-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>↩ Replaces {order.replacesOrderId}</Link>
                )}
                {order.replacedBy && (
                  <Link href={`/admin/orders/${order.replacedBy.id}`} className="td-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>↪ Replaced by {order.replacedBy.id}</Link>
                )}
              </div>
            )}
          </div>
          <div className="detail-header-actions">{actions}</div>
        </div>

        <div className="grid-detail">
          <div className="grid-left">
            {/* Provisioning — 3 steps (Payment · Proxy · Activation) */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Provisioning</span>
                <span className={`chip ${provClass}`}>{provLabel}</span>
              </div>
              <div className="prov-stepper">
                {steps.map((s, i) => (
                  <div key={s.name} className={`prov-step-row ${s.state}`}>
                    <span className="prov-step-num">{i + 1}</span>
                    <span className="prov-step-name">{s.name}</span>
                    <span className={`chip ${STATE_CHIP[s.state]}`}>{STATE_LABEL[s.state]}</span>
                    <span className={`prov-mode ${s.mode}`}>{cap(s.mode)}</span>
                    <span className="prov-step-meta">{s.meta || '—'}</span>
                  </div>
                ))}
              </div>
              {provClass !== 'active' && (
                <div className={`prov-next-action ${nextTone}`}>
                  <span className="prov-next-key">Next action</span>
                  <span className="prov-next-val">{nextLabel}</span>
                </div>
              )}
            </div>

            {/* Assignment history */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Assignment history</span></div>
              <div className="table-wrap">
                <table className="dt">
                  <colgroup>
                    <col style={{ width: 'calc(100% * 3 / 20)' }} />
                    <col style={{ width: 'calc(100% * 4 / 20)' }} />
                    <col style={{ width: 'calc(100% * 3 / 20)' }} />
                    <col style={{ width: 'calc(100% * 5 / 20)' }} />
                    <col style={{ width: 'calc(100% * 2 / 20)' }} />
                    <col style={{ width: 'calc(100% * 3 / 20)' }} />
                  </colgroup>
                  <thead><tr>
                    <th className="col-id">Proxy ID</th>
                    <th className="col-text">Carrier · Region</th>
                    <th className="col-date">Assigned</th>
                    <th className="col-status">Status</th>
                    <th className="col-actor">By</th>
                    <th className="col-action" />
                  </tr></thead>
                  <tbody>
                    {order.assignments.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: '18px 20px', textAlign: 'center', color: 'var(--muted)' }}>No proxy assigned yet.</td></tr>
                    ) : (
                      order.assignments.map(a => {
                        let stateClass = 'active', stateLabel = 'Active';
                        if (a.releasedAt) {
                          if (a.reason && /replac/i.test(a.reason)) { stateClass = 'replacement'; stateLabel = 'Replaced'; }
                          else { stateClass = 'expired'; stateLabel = 'Released'; }
                        }
                        const meta = a.releasedAt ? `${fmtAdminStamp(a.releasedAt)}${a.reasonDetail ? ` · ${a.reasonDetail}` : ''}` : '';
                        return (
                          <tr key={a.id}>
                            <td className="col-id"><Link href={`/admin/proxies/${a.proxyId}`} className="td-link">{a.proxyId}</Link></td>
                            <td className="col-text muted">{a.proxy.carrier} · {a.proxy.region}</td>
                            <td className="col-date">{fmtAdminStamp(a.assignedAt)}</td>
                            <td className="col-status">
                              <span className={`chip ${stateClass}`}>{stateLabel}</span>
                              {meta && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{meta}</span>}
                            </td>
                            <td className="col-actor"><span className="badge-soft">{actorName.get(a.actorId) ?? a.actorId}</span></td>
                            <td className="col-action">
                              {!a.releasedAt && !isCancelled && !isSuspended && (order.status === 'ACTIVE' || order.status === 'PROVISIONING') && (
                                <ReplaceProxyButton proxyId={a.proxyId} orderId={order.id} />
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <EntityNotesPanel objectType="ORDER" objectId={order.id} />
          </div>

          <div className="grid-right">
            {/* Order Snapshot — frozen at purchase */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Order Snapshot</span></div>
              <div className="kv">
                <div className="kv-row"><span className="kv-key">Client</span><span className="kv-val"><Link href={`/admin/clients/${order.client.id}`} className="client-link mono">{order.client.id}</Link> <span className="muted">· {order.client.name}</span></span></div>
                <div className="kv-row"><span className="kv-key">Plan</span><span className="kv-val"><Link href={`/admin/plans/${order.plan.id}`} className="td-link">{order.plan.name}</Link></span></div>
                <div className="kv-row"><span className="kv-key">Source</span><span className="kv-val">{order.source ?? 'Client Portal · web'}</span></div>
                <div className="kv-row"><span className="kv-key">Quantity</span><span className="kv-val">{order.qty} {order.qty > 1 ? 'proxies' : 'proxy'}</span></div>
                <div className="kv-row"><span className="kv-key">Carrier · Region</span><span className="kv-val">{order.plan.carrier} · {order.region}</span></div>
                <div className="kv-row"><span className="kv-key">Amount</span><span className="kv-val">{amountStr}</span></div>
              </div>
            </div>

            {/* Lifecycle */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Lifecycle</span></div>
              <div className="kv">
                <div className="kv-row"><span className="kv-key">Created</span><span className="kv-val">{fmtAdminStamp(order.createdAt)}</span></div>
                <div className="kv-row"><span className="kv-key">Activated</span><span className="kv-val">{order.activatedAt ? fmtAdminStamp(order.activatedAt) : '—'}</span></div>
                <div className="kv-row"><span className="kv-key">Expires</span><span className="kv-val">{order.expiresAt ? fmtAdminStamp(order.expiresAt) : '—'}</span></div>
                <div className="kv-row"><span className="kv-key">Auto-renew</span><span className="kv-val"><span className={`chip ${order.autoRenew ? 'active' : 'expired'}`}>{order.autoRenew ? 'ON' : 'OFF'}</span></span></div>
              </div>
            </div>

            <EntityActivityWidget
              objectType="ORDER"
              objectId={order.id}
              bridges={[
                ...order.payments.map(p => ({ type: 'PAYMENT' as const, id: p.id })),
                ...order.assignments.map(a => ({ type: 'PROXY' as const, id: a.proxyId })),
              ]}
            />
          </div>
        </div>
        </div>
      </main>
    </>
  );
}
