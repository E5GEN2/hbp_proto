'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { endOrderNowAction } from '@/lib/ui-actions/admin-actions';
import { DUTY_EXCEPTIONS } from '@/lib/end-order';

// Ends a PAST-DUE order right now — the sweep's grace-end outcome (EXPIRED,
// proxies back to the pool) on the admin's clock. Owner ask 2026-09-05
// (ORD-21399). Every impact line mirrors a branch of the transaction
// (lib/end-order.ts endOrderPlan + transitions.ts endOrderNow) — keep them in
// step: what this dialog promises is what the client and the pool get.
export type EndOrderNowModalProps = {
  open: boolean;
  onClose: () => void;
  orderId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  liveProxies: number;
  // The preference the transaction will carry: the order's own for ACTIVE /
  // EXPIRED, the one the suspension parked for the SUSPENDED rescue.
  autoRenewOn: boolean;
  // Grace end as a preformatted stamp while the clock is still inside grace;
  // null once grace is over (the client can only Buy again).
  graceUntil: string | null;
  // 'awaiting' = a stamped renewal charge awaiting confirmation (settles into a
  // fresh term); 'review' = funds parked in MANUAL_REVIEW (resurrect as a
  // balance credit, never an extension); null = nothing in flight.
  renewalInFlight: 'awaiting' | 'review' | null;
  exception: string | null;
};

const DUTY_LABEL: Record<string, string> = {
  PAID_NOT_PROVISIONED: 'Paid, not provisioned',
  REPLACEMENT_PENDING: 'Replacement pending',
  RENEWAL_FAULTY_PROXY: 'Renewal · faulty proxy',
};

export function EndOrderNowModal({
  open, onClose, orderId, status, liveProxies, autoRenewOn, graceUntil, renewalInFlight, exception,
}: EndOrderNowModalProps) {
  const router = useRouter();
  const toast = useToast();

  const rescue = status === 'SUSPENDED';
  const dutyCleared = exception !== null && (DUTY_EXCEPTIONS as string[]).includes(exception);
  const channel = status === 'ACTIVE' && autoRenewOn
    ? 'Client notice: portal bell + the standard “term ended” email (service-loss notice — the client was emailed that proxies keep working until grace end); your reason is audited only'
    : rescue
      ? 'Client notice: portal bell + an incident email if the client has incident emails on; your reason is audited only'
      : 'Client notice: portal bell only (like the sweep); your reason is audited only';

  const impact = [
    rescue
      ? 'Order status → EXPIRED — the suspension is lifted; it ends as expired, not suspended or cancelled'
      : 'Order status → EXPIRED',
    liveProxies > 0
      ? `${liveProxies} ${liveProxies === 1 ? 'proxy returns' : 'proxies return'} to the pool now — assignment closed (reason: order expired), hidden from the client, rotation markers stamped`
      : 'No proxies are attached — nothing to release',
    ...(rescue && liveProxies > 0
      ? ['⚠ The manual rotation duty from the suspension still stands — rotate the proxy password + IP-rotation link on the upstream before the proxy is resold (not automated)']
      : []),
    rescue
      ? (autoRenewOn
        ? 'Auto-renew preference restored to ON (the suspension had parked it) — inert while expired; it applies again once the client renews'
        : 'Auto-renew stays off')
      : (autoRenewOn
        ? 'Auto-renew preference stays ON but cannot fire on an expired order (a top-up will not renew it) — it applies again once the client renews'
        : 'Auto-renew is off'),
    graceUntil
      ? `The client can still Renew until ${graceUntil} (fresh proxies, a new term from the renewal); after that, Buy again`
      : 'Grace is over — the client can only Buy again (no contiguous renewal)',
    ...(dutyCleared ? [`Exception “${DUTY_LABEL[exception!] ?? exception}” is cleared — its provisioning duty ends with the term`] : []),
    'No refund signal — the term ran out. An open refund case (if any) stays with finance',
    channel,
    ...(renewalInFlight === 'awaiting'
      ? ['⚠ A renewal payment is awaiting confirmation on this order — if it settles, the client receives a fresh term with fresh proxies']
      : renewalInFlight === 'review'
        ? ['⚠ Funds for this order are under review — once confirmed they are credited to the client’s balance (the order is not extended automatically); the client renews from balance']
        : []),
  ];

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="End order now"
      entityLabel={`Order · ${orderId}`}
      message="The order is past due. End it now as Expired and return its proxies to the pool — the same outcome the sweep reaches at the end of grace, without waiting for it. For a live dispute use Suspend; before expiry use Cancel."
      impact={impact}
      requireReason
      confirmLabel="End order now"
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        const r = await endOrderNowAction(orderId, reason!);
        toast('Order ended', r.released > 0 ? `${orderId} · ${r.released} ${r.released === 1 ? 'proxy' : 'proxies'} released` : orderId, 'warning');
        router.refresh();
      }}
    />
  );
}
