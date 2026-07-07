'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { suspendOrderAction } from '@/lib/ui-actions/admin-actions';

export function SuspendOrderModal({
  open, onClose, orderId,
}: { open: boolean; onClose: () => void; orderId: string }) {
  const router = useRouter();
  const toast = useToast();

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Suspend order"
      entityLabel={`Order · ${orderId}`}
      message="The order pauses but proxies stay reserved. Auto-renew is captured for restoration on resume. You MUST rotate the proxy credentials on the upstream immediately — the client may have already copied them."
      impact={[
        'Order status → SUSPENDED',
        'Active proxies stay assigned (not released)',
        'Credentials hidden from client view',
        'Auto-renew turned off; restored when you resume',
        '⚠ Manual action required: rotate password + regenerate the IP-rotation link on the upstream now (not automated)',
      ]}
      requireReason
      confirmLabel="Suspend"
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        await suspendOrderAction(orderId, reason!);
        toast('Order suspended', orderId, 'warning');
        router.refresh();
      }}
    />
  );
}
