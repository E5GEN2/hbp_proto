'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/ui-actions/client-actions';

// Canon order-detail header actions — vary by status:
//   active, expiring ≤7d → Renew now + Turn off/on auto-renew
//   active               → Turn on/off auto-renew
//   expired              → Renew
//   new + pending        → Continue checkout + Cancel order
export function ClientOrderDetailActions({
  orderId, status, paymentStatus, autoRenew, expiringActive,
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  autoRenew: boolean;
  expiringActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isPending = status === 'NEW' && (paymentStatus === 'PENDING' || paymentStatus === 'AWAITING');

  function doRenew() {
    start(async () => {
      try {
        const r = (await CA.clientRenewOrderAction(orderId)) as { redirect?: string; newExpiry?: string | number | Date };
        if (r?.redirect) {
          toast('Insufficient balance', 'Redirecting to checkout', 'info');
          router.push(r.redirect);
          return;
        }
        const exp = r && 'newExpiry' in r ? r.newExpiry : null;
        toast('Order renewed', exp ? `New expiry: ${new Date(exp).toLocaleDateString()}` : '', 'success');
        router.refresh();
      } catch (e: any) { toast('Renewal failed', e.message, 'danger'); }
    });
  }

  function doToggleAutoRenew() {
    const on = !autoRenew;
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

  return (
    <>
      {status === 'ACTIVE' && (
        <>
          {expiringActive && <button className="btn primary" onClick={doRenew} disabled={pending}>{pending ? '…' : 'Renew now'}</button>}
          <button className="btn" onClick={doToggleAutoRenew} disabled={pending}>{autoRenew ? 'Turn off auto-renew' : 'Turn on auto-renew'}</button>
        </>
      )}
      {status === 'EXPIRED' && <button className="btn primary" onClick={doRenew} disabled={pending}>{pending ? '…' : 'Renew'}</button>}
      {isPending && (
        <>
          <button className="btn primary" onClick={() => router.push(`/checkout?resume=${orderId}`)}>Continue checkout</button>
          <button className="btn ghost" onClick={() => setConfirmCancel(true)} disabled={pending}>Cancel order</button>
        </>
      )}

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
