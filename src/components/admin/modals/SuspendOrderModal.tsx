'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { suspendOrderAction } from '@/lib/admin-actions';

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
      message="The order pauses but proxies stay reserved. Auto-renew is captured for restoration on resume."
      impact={[
        'Order status → SUSPENDED',
        'Active proxies stay assigned (not released)',
        'Credentials revoked from client view',
        'Auto-renew turned off; restored when you resume',
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
