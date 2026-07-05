'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { clientCancelOrderAction } from '@/lib/ui-actions/client-actions';

// Actions for the "Complete your payment" interstitial (/checkout?resume=…):
// pay on the stored NOWPayments invoice, or cancel the unpaid order. There is
// deliberately NO path back into the wizard — that produced duplicate orders.
export function CompletePaymentActions({ orderId, payUrl }: { orderId: string; payUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  function doCancel() {
    start(async () => {
      try {
        await clientCancelOrderAction(orderId);
        toast('Order cancelled', orderId, 'warning');
        setConfirmCancel(false);
        router.replace(`/orders/${orderId}`);
        router.refresh();
      } catch (e: any) {
        toast('Failed', e.message, 'danger');
      }
    });
  }

  return (
    <>
      <div className="processing-actions">
        {payUrl && <a className="btn primary" href={payUrl}>Pay now on NOWPayments →</a>}
        <button className="btn ghost" onClick={() => setConfirmCancel(true)} disabled={pending}>Cancel order</button>
      </div>

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
    </>
  );
}
