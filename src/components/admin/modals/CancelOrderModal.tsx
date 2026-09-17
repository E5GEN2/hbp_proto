'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { useToast } from '@/components/ui/Toast';
import { cancelOrderAction } from '@/lib/ui-actions/admin-actions';

type RefundMode = 'review' | 'none';

// pastDue: the order is already past its expiry (grace). Cancel and End order
// now are two different ends — Cancel closes the order with a refund question
// and tells the client it was cancelled; End order now ends it as Expired
// (the term ran out) with no refund signal. Say so BEFORE the click, the way
// the Suspend dialog does, so a past-due order is not cancelled by habit
// (owner ask 2026-09-17, ORD-48038).
export function CancelOrderModal({
  open, onClose, orderId, wasPaid, assignmentCount, pastDue = false,
}: { open: boolean; onClose: () => void; orderId: string; wasPaid: boolean; assignmentCount: number; pastDue?: boolean }) {
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
    ...(pastDue
      ? ['⚠ This order is past due — if the term simply ran out, use End order now instead: it ends as Expired (not Cancelled), keeps the client’s auto-renew preference and raises no refund question. Cancel only to close it with a refund decision']
      : []),
    `${assignmentCount} active ${assignmentCount === 1 ? 'proxy' : 'proxies'} returned to the pool with a security-reset marker`,
    'Credentials revoked; auto-renew turned off',
    // Unlike End order now (reason audited only), the cancel reason reaches the
    // client: the portal bell and the order timeline both show it verbatim.
    'Client notified in the portal (bell + order timeline) — your reason is shown to them verbatim',
    ...(wasPaid
      ? [noRefund
          ? 'No refund — the charge stays ours; no refund-pending signal is raised (any client refund request is declined)'
          : 'Order tagged with `refund-pending` exception — finance must close the loop']
      : []),
  ];

  const message = (
    <>
      <div>Cancelling is terminal and cannot be undone — Resume works only on a suspended order, so a cancelled order never returns to Active.</div>
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
      reasonPlaceholder="Required — shown to the client and audited in the activity log"
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
