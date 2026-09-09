'use client';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { suspendOrderAction } from '@/lib/ui-actions/admin-actions';

// pastDue: the order is already past its expiry (grace) — Suspend is the tool
// for a live dispute, not for ending it: a suspended order is invisible to the
// sweep (ACTIVE/EXPIRED only) and would keep its proxies bound forever. Point
// at End order now BEFORE the click, not only on the suspended banner after it.
export function SuspendOrderModal({
  open, onClose, orderId, pastDue = false,
}: { open: boolean; onClose: () => void; orderId: string; pastDue?: boolean }) {
  const router = useRouter();
  const toast = useToast();

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Suspend order"
      entityLabel={`Order · ${orderId}`}
      message="The order pauses but proxies stay reserved. Auto-renew is captured for restoration on resume. You MUST rotate the proxy credentials on the upstream immediately — the client may have already copied them."
      impact={[
        ...(pastDue
          ? ['⚠ This order is past due — to finish it use End order now instead. Suspend is only for a live dispute: a suspended order is invisible to the sweep and keeps its proxies bound until you resume or end it']
          : []),
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
