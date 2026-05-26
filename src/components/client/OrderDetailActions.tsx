'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/client-actions';

export function ClientOrderDetailActions({
  orderId, status, paymentStatus, hasPaidPayment, lastPaymentId,
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  hasPaidPayment: boolean;
  lastPaymentId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [renewPending, startRenew] = useTransition();

  const canCancel = status === 'NEW' && (paymentStatus === 'PENDING' || paymentStatus === 'AWAITING');
  const canRenew = status === 'ACTIVE' || status === 'EXPIRED';
  const canRequestRefund = hasPaidPayment && (status === 'ACTIVE' || status === 'PROVISIONING' || status === 'EXPIRED');
  const isPending = status === 'NEW' && (paymentStatus === 'PENDING' || paymentStatus === 'AWAITING');

  function doRenew() {
    startRenew(async () => {
      try {
        const r = await CA.clientRenewOrderAction(orderId);
        if (r.redirect) {
          toast('Insufficient balance', 'Redirecting to checkout', 'info');
          router.push(r.redirect);
          return;
        }
        const exp = 'newExpiry' in r ? r.newExpiry : null;
        toast('Order renewed', exp ? `New expiry: ${new Date(exp).toLocaleDateString()}` : '', 'success');
        router.refresh();
      } catch (e: any) {
        toast('Renewal failed', e.message, 'danger');
      }
    });
  }

  function doToggleAutoRenew(on: boolean) {
    start(async () => {
      try {
        await CA.clientToggleAutoRenewAction(orderId, on);
        toast(`Auto-renew ${on ? 'enabled' : 'disabled'}`, orderId, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  function doCancel() {
    start(async () => {
      try {
        await CA.clientCancelOrderAction(orderId);
        toast('Order cancelled', orderId, 'warning');
        setConfirmCancel(false);
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  function doRequestRefund() {
    if (!lastPaymentId) return;
    if (!refundReason.trim()) {
      toast('Reason required', '', 'warning');
      return;
    }
    start(async () => {
      try {
        await CA.clientRequestRefundAction(lastPaymentId, refundReason);
        toast('Refund requested', 'Our team will review within 24h', 'success');
        setRefundOpen(false);
        setRefundReason('');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      {canRenew && (
        <button className="btn primary" onClick={doRenew} disabled={renewPending}>
          {renewPending ? '…' : status === 'EXPIRED' ? 'Renew now' : 'Renew'}
        </button>
      )}
      {isPending && (
        <button className="btn" onClick={() => router.push(`/checkout?resume=${orderId}`)}>Continue checkout</button>
      )}
      {canCancel && (
        <button className="btn" onClick={() => setConfirmCancel(true)} disabled={pending}>Cancel order</button>
      )}
      {canRequestRefund && (
        <button className="btn" onClick={() => setRefundOpen(true)}>Request refund</button>
      )}

      {/* Cancel confirm */}
      <Modal
        open={confirmCancel} onClose={() => setConfirmCancel(false)}
        title="Cancel order"
        footer={<>
          <button className="btn" onClick={() => setConfirmCancel(false)} disabled={pending}>Keep order</button>
          <button className="btn danger" onClick={doCancel} disabled={pending}>{pending ? '…' : 'Cancel order'}</button>
        </>}
      >
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          This will cancel <span className="mono">{orderId}</span>. Payment hasn&rsquo;t cleared, so nothing has been charged.
        </div>
      </Modal>

      {/* Refund request */}
      <Modal
        open={refundOpen} onClose={() => setRefundOpen(false)}
        title="Request refund"
        footer={<>
          <button className="btn" onClick={() => setRefundOpen(false)} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={doRequestRefund} disabled={pending || !refundReason.trim()}>{pending ? '…' : 'Submit request'}</button>
        </>}
      >
        <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          Refund requests are reviewed by our team. We typically respond within 24 hours. Approved refunds are credited to your account balance.
        </div>
        <label className="form-label">Reason</label>
        <textarea
          className="form-textarea" rows={4}
          value={refundReason}
          onChange={e => setRefundReason(e.target.value)}
          placeholder="Help us understand why so we can resolve this quickly."
          autoFocus
        />
      </Modal>
    </>
  );
}

export function ClientAutoRenewToggle({ orderId, on, disabled }: { orderId: string; on: boolean; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <span
      className={`toggle ${on ? 'on' : ''}`}
      style={{ cursor: disabled || pending ? 'not-allowed' : 'pointer', opacity: pending ? 0.6 : 1 }}
      onClick={() => {
        if (disabled || pending) return;
        start(async () => {
          try {
            await CA.clientToggleAutoRenewAction(orderId, !on);
            toast(`Auto-renew ${!on ? 'enabled' : 'disabled'}`, orderId, 'success');
            router.refresh();
          } catch (e: any) { toast('Failed', e.message, 'danger'); }
        });
      }}
    />
  );
}
