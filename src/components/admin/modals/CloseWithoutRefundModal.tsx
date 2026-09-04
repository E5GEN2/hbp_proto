'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { closeWithoutRefundAction } from '@/lib/ui-actions/admin-actions';

// The cross-cutting "no refund" resolution for an order already in refund
// review (owner ask 2026-09-04). Runs the SAME backend waiver as Cancel →
// "No refund", so the audit line, client notice and queue exit are identical.
// isTerminal: CANCELLED / EXPIRED orders are only waived — never re-labelled.
export function CloseWithoutRefundModal({
  open, onClose, orderId, isTerminal, hasClientRequest,
}: { open: boolean; onClose: () => void; orderId: string; isTerminal: boolean; hasClientRequest: boolean }) {
  const router = useRouter();
  const toast = useToast();

  const impact = [
    ...(isTerminal ? [] : ['The order is cancelled: active proxies return to the pool, credentials revoked, auto-renew off']),
    'No money moves — the payment stays confirmed and the charge stays ours',
    'Refund-pending signal cleared: the order leaves the Refund review queue and the bell',
    ...(hasClientRequest ? ['The client’s refund request is declined and they are notified'] : []),
    'Finance can still refund later from the payment itself if that changes',
  ];

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Close without refund"
      entityLabel={`Order · ${orderId}`}
      message="Resolve this refund review with no refund. The reason is audited on the order."
      impact={impact}
      requireReason
      confirmLabel="Close without refund"
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        await closeWithoutRefundAction(orderId, reason!);
        toast('Closed without refund', orderId, 'warning');
        router.refresh();
      }}
    />
  );
}
