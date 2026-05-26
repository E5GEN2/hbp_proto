'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { cancelOrderAction } from '@/lib/admin-actions';

export function CancelOrderModal({
  open, onClose, orderId, wasPaid, assignmentCount,
}: { open: boolean; onClose: () => void; orderId: string; wasPaid: boolean; assignmentCount: number }) {
  const router = useRouter();
  const toast = useToast();

  const impact = [
    `${assignmentCount} active ${assignmentCount === 1 ? 'proxy' : 'proxies'} returned to the pool with a security-reset marker`,
    'Credentials revoked; auto-renew turned off',
    ...(wasPaid ? ['Order tagged with `refund-pending` exception — finance must close the loop'] : []),
  ];

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Cancel order"
      entityLabel={`Order · ${orderId}`}
      message="Cancelling is terminal. The order can be resumed (manual recovery required) but not undone."
      impact={impact}
      requireReason
      confirmLabel="Cancel order"
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        await cancelOrderAction(orderId, reason!);
        toast('Order cancelled', orderId, 'warning');
        router.refresh();
      }}
    />
  );
}
