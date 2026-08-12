'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { fmtAdminStamp } from '@/lib/date';
import * as CA from '@/lib/ui-actions/client-actions';

// Canon order-detail header actions — vary by status:
//   active, expiring ≤7d → Renew now + Turn off/on auto-renew
//   active               → Turn on/off auto-renew
//   expired, in grace    → Renew
//   expired, past grace  → Buy again (fresh order — proxies were released)
//   new + pending        → Complete payment + Cancel order
export function ClientOrderDetailActions({
  orderId, status, paymentStatus, autoRenew, expiringActive, pastGrace, buyAgainHref,
}: {
  orderId: string;
  status: string;
  paymentStatus: string;
  autoRenew: boolean;
  expiringActive: boolean;
  pastGrace: boolean;
  buyAgainHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  // FAILED included: a dead charge on a still-open order resumes into the
  // fresh-address recovery — the retry every bell/timeline copy promises.
  const isPending = status === 'NEW' && (paymentStatus === 'PENDING' || paymentStatus === 'AWAITING' || paymentStatus === 'FAILED');

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
        toast('Order renewed', exp ? `New expiry: ${fmtAdminStamp(new Date(exp))}` : '', 'success');
        router.refresh();
      } catch (e: any) {
        toast('Renewal failed', e.message, 'danger');
        // Grace boundary may have passed while the page sat open → server
        // refuses; refresh so the header swaps "Renew" for "Buy again".
        router.refresh();
      }
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
      {status === 'EXPIRED' && (
        pastGrace
          // Grace over → proxies released; a contiguous renewal isn't possible.
          // "Buy again" is a fresh checkout of the same terms (no renewOf).
          ? <Link className="btn primary" href={buyAgainHref}>Buy again</Link>
          : <button className="btn primary" onClick={doRenew} disabled={pending}>{pending ? '…' : 'Renew'}</button>
      )}
      {isPending && (
        <>
          <button className="btn primary" onClick={() => router.push(`/checkout?resume=${orderId}`)}>Complete payment</button>
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
        <div className="t-body">
          This will cancel <span className="mono">{orderId}</span>. Payment hasn&rsquo;t cleared, so nothing has been charged.
        </div>
      </Modal>
    </>
  );
}
