'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { declineRefundRequestAction } from '@/lib/ui-actions/admin-actions';

// "Decline the request, keep serving" (owner ask 2026-09-04, follow-up): the
// same refund waiver as "Close without refund", but the order itself is
// untouched — no cancel, proxies and credentials stay. Live orders only.
export function DeclineRefundRequestModal({
  open, onClose, orderId,
}: { open: boolean; onClose: () => void; orderId: string }) {
  const router = useRouter();
  const toast = useToast();

  const impact = [
    'The order keeps running — proxies, credentials and auto-renew untouched',
    'No money moves — the payment stays confirmed and the charge stays ours',
    'Refund-pending signal cleared: the order leaves the Refund review queue and the bell',
    'The client is notified that their refund request was declined — your reason is included in that notice',
    'Finance can still refund later from the payment itself if that changes',
  ];

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Decline refund request"
      entityLabel={`Order · ${orderId}`}
      message="Refuse the client’s refund request and continue serving the order. The reason is shown to the client and audited on the order."
      impact={impact}
      requireReason
      confirmLabel="Decline request"
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        await declineRefundRequestAction(orderId, reason!);
        toast('Refund request declined', `${orderId} · order continues`, 'warning');
        router.refresh();
      }}
    />
  );
}
