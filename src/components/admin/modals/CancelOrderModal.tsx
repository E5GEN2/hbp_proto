'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { cancelOrderAction } from '@/lib/ui-actions/admin-actions';

type RefundMode = 'review' | 'none';

export function CancelOrderModal({
  open, onClose, orderId, wasPaid, assignmentCount,
}: { open: boolean; onClose: () => void; orderId: string; wasPaid: boolean; assignmentCount: number }) {
  const router = useRouter();
  const toast = useToast();
  // Refund handling for a PAID order (owner ask 2026-09-04): queue finance
  // review (previous behaviour) or close the case with no refund right here.
  // "No refund" is the same cross-cutting resolution as the "Close without
  // refund" button on an order already in refund review.
  const [refund, setRefund] = useState<RefundMode>('review');
  useEffect(() => { if (open) setRefund('review'); }, [open]);
  const noRefund = wasPaid && refund === 'none';

  const impact = [
    `${assignmentCount} active ${assignmentCount === 1 ? 'proxy' : 'proxies'} returned to the pool with a security-reset marker`,
    'Credentials revoked; auto-renew turned off',
    ...(wasPaid
      ? [noRefund
          ? 'No refund — the charge stays ours; no refund-pending signal is raised (any client refund request is declined)'
          : 'Order tagged with `refund-pending` exception — finance must close the loop']
      : []),
  ];

  const message = (
    <>
      <div>Cancelling is terminal. The order can be resumed (manual recovery required) but not undone.</div>
      {wasPaid && (
        <div style={{ marginTop: 12 }}>
          <div className="form-label">Refund handling</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" name="cancel-refund-mode" checked={refund === 'review'} onChange={() => setRefund('review')} />
            <span><strong>Queue for refund review</strong> — finance decides later (refund, or close without one)</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer' }}>
            <input type="radio" name="cancel-refund-mode" checked={refund === 'none'} onChange={() => setRefund('none')} />
            <span><strong>No refund</strong> — close without refund now</span>
          </label>
        </div>
      )}
    </>
  );

  return (
    <ConfirmAction
      open={open} onClose={onClose}
      title="Cancel order"
      entityLabel={`Order · ${orderId}`}
      message={message}
      impact={impact}
      requireReason
      confirmLabel={noRefund ? 'Cancel · no refund' : 'Cancel order'}
      confirmTone="danger"
      onConfirm={async ({ reason }) => {
        await cancelOrderAction(orderId, reason!, wasPaid ? refund : 'review');
        toast(noRefund ? 'Order cancelled · no refund' : 'Order cancelled', orderId, 'warning');
        router.refresh();
      }}
    />
  );
}
