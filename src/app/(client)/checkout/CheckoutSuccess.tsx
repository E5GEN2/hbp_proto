'use client';
import Link from 'next/link';
import { money } from '@/lib/money';
import { signalStructural } from '@/lib/nav-history';

// Addressable order-confirmation surface (/checkout?success=ORDER). Replaces the
// old transient wizard `success` step (client state on the throwaway wizard URL,
// which showed a blank buy form on reload/back — "did it go through?"). Being a
// real server-rendered URL, a reload or Back lands right back here, idempotent.
// CTAs fire signalStructural so the destination starts a clean nav stack — no
// stale "← Back to Checkout" that would drop the buyer into an empty wizard.
export function CheckoutSuccess({ orderId, planLabel, region, qty, total, activated, renewed }: {
  orderId: string;
  planLabel: string;
  region: string;
  qty: number;
  total: number;
  activated: boolean;   // order.status === 'ACTIVE'
  renewed: boolean;
}) {
  const title = renewed ? 'Order renewed' : activated ? 'Order confirmed' : 'Order received';
  return (
    <div className="checkout-success">
      <div className="success-icon"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg></div>
      <div className="success-title">{title}</div>
      {!renewed && !activated && (
        <div className="success-helper">Our team is preparing your proxies. Typical delivery within 24 hours — we&rsquo;ll notify you the moment they&rsquo;re live.</div>
      )}
      <div className="success-summary">
        <div className="kv-row"><span className="kv-label">Order ID</span><span className="kv-val"><Link className="td-link" href={`/orders/${orderId}`} onClick={signalStructural}>{orderId}</Link></span></div>
        <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{planLabel} · {region}</span></div>
        <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{qty}</span></div>
        <div className="kv-row total"><span className="kv-label">Total Price</span><span className="kv-val">{money(total)}</span></div>
      </div>
      <div className="success-actions">
        <Link href={`/orders/${orderId}`} className="btn primary" onClick={signalStructural}>{activated || renewed ? 'Order details' : 'Track this order'}</Link>
        <Link href="/proxies" className="btn" onClick={signalStructural}>View my proxies</Link>
      </div>
    </div>
  );
}
