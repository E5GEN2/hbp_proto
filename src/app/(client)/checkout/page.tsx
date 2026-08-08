import Link from 'next/link';
import { planDisplayName } from '@/lib/catalog';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { mockPaymentsAllowed, enabledProviders } from '@/lib/runtime-flags';
import { renewalUnitPrice } from '@/lib/renewal';
import { safeReturn } from '@/lib/safe-return';
import { npInvoiceUrl } from '@/lib/nowpayments';
import { allocatedByPlan } from '@/lib/plan-availability';
import { TELEGRAM_SUPPORT_URL, SOLD_OUT_COPY } from '@/lib/support';
import { CheckoutFlow } from './CheckoutFlow';
import { CheckoutSuccess } from './CheckoutSuccess';
import { DepositFlow } from './DepositFlow';
import { CompletePaymentActions } from './CompletePaymentActions';
import { ResumePayPanel, DepositResumePanel } from './ResumePayPanel';
import type { PayPanelData } from '@/components/client/CryptoPayPanel';

// Payment row → the client pay panel's props (direct in-portal payments only).
function toPanelData(p: { id: string; payCurrency: string | null; payAmount: any; payAddress: string | null; payinExtraId: string | null; payExpiresAt: Date | null }): PayPanelData {
  return {
    paymentId: p.id,
    payCurrency: p.payCurrency!,
    payAmount: String(p.payAmount),
    payAddress: p.payAddress!,
    payinExtraId: p.payinExtraId,
    payExpiresAt: p.payExpiresAt ? p.payExpiresAt.getTime() : null,
  };
}

type OrderWithPlan = Prisma.OrderGetPayload<{ include: { plan: true } }>;

export default async function CheckoutPage({ searchParams }: {
  searchParams: {
    duration?: string; qty?: string; autoExtend?: string; location?: string; step?: string;
    kind?: string; amount?: string; returnTo?: string;
    resume?: string; renewOf?: string; ref?: string;
    success?: string; renewed?: string;
  };
}) {
  const session = await getServerSession(authOptions);
  const me = await prisma.user.findUnique({ where: { id: session!.user.id } });
  if (!me) return null;

  // Admin provider toggles gate which methods are OFFERED (the place/deposit
  // server paths enforce the same rule); balance is internal, always on.
  const providers = await enabledProviders();
  const allowCard = mockPaymentsAllowed() && providers.stripe;
  const allowCrypto = providers.crypto;

  // Success branch (trace find #3/#8) — an addressable order-confirmation URL
  // the wizard router.replace()s to after an instant or settled-crypto payment,
  // so a reload/Back lands on the confirmation (not a blank buy form).
  if (searchParams.success) {
    const order = await prisma.order.findUnique({ where: { id: searchParams.success }, include: { plan: true } });
    if (!order || order.clientId !== session!.user.id) notFound();
    // Positive allowlist (review find): the confirmation is truthful ONLY for a
    // freshly-paid order (ACTIVE or PROVISIONING). Any other state — unpaid
    // (NEW), or a since-EXPIRED/CANCELLED/SUSPENDED order revisited via a stale
    // ?success= bookmark — would fake a confirmation, so send it to the real
    // order page which shows the true status + next action.
    if (order.status !== 'ACTIVE' && order.status !== 'PROVISIONING') redirect(`/orders/${order.id}`);
    const renewed = searchParams.renewed === '1';
    const total = renewed
      ? renewalUnitPrice(Number(order.plan.price), order.plan.renewalDiscountPct) * order.qty
      : Number(order.amount);
    return (
      <>
        <ClientTopbar breadcrumb={[{ label: 'Orders', href: '/orders' }, { label: `Order ${order.id}` }]} balance={Number(me.balance)} />
        <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
          <CheckoutSuccess
            orderId={order.id}
            planLabel={planDisplayName(order.plan.durationDays)}
            region={order.region}
            qty={order.qty}
            total={total}
            activated={order.status === 'ACTIVE'}
            renewed={renewed}
          />
        </main>
      </>
    );
  }

  // Deposit branch
  if (searchParams.kind === 'deposit') {
    // Deposit resume (billing "Pay now" on an AWAITING direct top-up): re-open
    // the in-portal pay panel from the stored payment row.
    if (searchParams.resume?.startsWith('PAY-')) {
      const pay = await prisma.payment.findUnique({ where: { id: searchParams.resume } });
      if (!pay || pay.clientId !== session!.user.id || pay.orderId) notFound();
      // Carry a safe returnTo so a deposit started from a checkout returns there
      // after it settles (else falls back to Billing).
      const resumeReturn = searchParams.returnTo ? (safeReturn(decodeURIComponent(searchParams.returnTo)) ?? undefined) : undefined;
      if (pay.status === 'AWAITING' && pay.payAddress) {
        return (
          <>
            <ClientTopbar breadcrumb={[{ label: 'Billing', href: '/billing' }, { label: 'Complete deposit' }]} balance={Number(me.balance)} />
            <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
              <DepositResumePanel amountUsd={Number(pay.gross)} initial={toPanelData(pay)} returnTo={resumeReturn} />
            </main>
          </>
        );
      }
      // Legacy hosted-invoice deposit still awaiting → the stored invoice URL
      // is the only pay surface it ever had; link out.
      if (pay.status === 'AWAITING' && pay.provider === 'NOWPayments' && pay.externalRef) {
        return (
          <>
            <ClientTopbar breadcrumb={[{ label: 'Billing', href: '/billing' }, { label: 'Complete deposit' }]} balance={Number(me.balance)} />
            <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
              <div className="panel" style={{ padding: 24 }}>
                <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Complete your deposit</h2>
                <p style={{ color: 'var(--muted)' }}>Finish on the NOWPayments page — your balance updates automatically once the transaction is confirmed.</p>
                <a className="btn primary" href={npInvoiceUrl(pay.externalRef)}>Pay now on NOWPayments →</a>
              </div>
            </main>
          </>
        );
      }
      // Settled / failed — nothing to resume in-portal.
      return (
        <>
          <ClientTopbar breadcrumb={[{ label: 'Billing', href: '/billing' }, { label: 'Deposit' }]} balance={Number(me.balance)} />
          <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
            <div className="panel" style={{ padding: 24 }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>This deposit is no longer pending</h2>
              <p style={{ color: 'var(--muted)' }}>
                {pay.status === 'CONFIRMED' ? 'It has been credited to your balance.' : 'It was not completed — you can start a fresh deposit any time.'}
              </p>
              <Link href="/billing" className="btn primary">Back to billing</Link>
            </div>
          </main>
        </>
      );
    }

    const parsedAmount = searchParams.amount ? parseFloat(searchParams.amount) : NaN;
    const presetAmount = Number.isFinite(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 10000 ? parsedAmount : undefined; // garbage/out-of-range ?amount= must not leak NaN or "$-50" (P1-5)
    // safeReturn rejects off-site / bypass targets (//evil, /\evil, absolute
     // URLs) so the breadcrumb link AND DepositFlow's "Back" can't be an
     // open redirect; unsafe → treated as absent (falls back to Billing).
    const decodedReturn = searchParams.returnTo ? (safeReturn(decodeURIComponent(searchParams.returnTo)) ?? undefined) : undefined;
    // Origin-aware breadcrumb (trace finds #7/#11/#17): when funding an
    // in-progress checkout the "Billing" crumb was a trap — its structural jump
    // dumped the buyer on /billing, losing the order. Point the crumb back to
    // checkout so top-nav agrees with the in-panel "← Back". Only honor a
    // same-origin checkout returnTo (leading "/checkout"), never an arbitrary URL.
    const returnToCheckout = decodedReturn && decodedReturn.startsWith('/checkout');
    const depositCrumb = returnToCheckout
      ? [{ label: 'Checkout', href: decodedReturn! }, { label: 'Add funds' }]
      : [{ label: 'Billing', href: '/billing' }, { label: 'Deposit' }];
    return (
      <>
        <ClientTopbar breadcrumb={depositCrumb} balance={Number(me.balance)} />
        <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
          <DepositFlow presetAmount={presetAmount} returnTo={decodedReturn} allowCard={allowCard} allowCrypto={allowCrypto} />
        </main>
      </>
    );
  }

  // Resume branch — the order and its payment ALREADY EXIST, so this must
  // never re-enter the wizard (that placed a duplicate order). It is PAYMENT-
  // aware, not order-status-aware (review find): a crypto RENEWAL charge lives
  // on an ACTIVE/EXPIRED order, and bouncing on status!=='NEW' made such a
  // charge unreachable after the client left the page.
  if (searchParams.resume) {
    const resumeOrder: OrderWithPlan | null = await prisma.order.findUnique({
      where: { id: searchParams.resume }, include: { plan: true },
    });
    if (!resumeOrder || resumeOrder.clientId !== session!.user.id) {
      notFound();
    }

    const isNewOrder = resumeOrder.status === 'NEW';
    const awaiting = resumeOrder.status === 'CANCELLED' || resumeOrder.status === 'PENDING_RENEWAL'
      ? null
      : await prisma.payment.findFirst({
          where: { orderId: resumeOrder.id, status: 'AWAITING' },
          orderBy: { createdAt: 'desc' },
        });
    const direct = awaiting?.provider === 'NOWPayments' && awaiting.payAddress ? awaiting : null;
    // Dead direct charge (fixed-rate window expired) → recovery surface with a
    // fresh address via /api/checkout/repay. Gated on the same provider
    // toggles as new charges — otherwise the picker is a dead end.
    const hadDirect = !awaiting && (isNewOrder || resumeOrder.plan.renewalAllowed) && resumeOrder.status !== 'CANCELLED' && resumeOrder.status !== 'PENDING_RENEWAL'
      ? await prisma.payment.findFirst({
          where: { orderId: resumeOrder.id, provider: 'NOWPayments', status: 'FAILED', payAddress: { not: null } },
          select: { id: true },
        })
      : null;
    const canRepay = allowCrypto; // enabledProviders().crypto; npEnabled implied by payAddress existing

    const crumbs = [{ label: 'Orders', href: '/orders' }, { label: `Order ${resumeOrder.id}`, href: `/orders/${resumeOrder.id}` }, { label: isNewOrder ? 'Complete payment' : 'Complete renewal' }];
    const orderSummary = (
      <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', padding: '4px 0' }}>
        <div className="kv-row"><span className="kv-label">{isNewOrder ? 'Order' : 'Renews order'}</span><span className="kv-val mono">{resumeOrder.id}</span></div>
        <div className="kv-row"><span className="kv-label">Plan</span><span className="kv-val">{planDisplayName(resumeOrder.plan.durationDays)}</span></div>
        <div className="kv-row"><span className="kv-label">Location</span><span className="kv-val">{resumeOrder.region}</span></div>
        <div className="kv-row"><span className="kv-label">Quantity</span><span className="kv-val">{resumeOrder.qty}</span></div>
      </div>
    );
    // Cancel-order actions only make sense for an unpaid NEW order — a renewal
    // charge must never offer to cancel the (already paid) original order.
    // No in-card "← Back to order" here: the breadcrumb "Order X" and the
    // universal NavBacklink already cover going back — a third control just
    // contradicted them (trace finds #12/#18).
    const cardActions = isNewOrder ? <CompletePaymentActions orderId={resumeOrder.id} payUrl={null} /> : null;

    if (direct || (hadDirect && canRepay)) {
      return (
        <>
          <ClientTopbar breadcrumb={crumbs} balance={Number(me.balance)} />
          <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
            <ResumePayPanel
              orderId={resumeOrder.id}
              /* direct → the charge's own amount; expired recovery → what
                 repay will actually charge (renewals carry their discount). */
              amountUsd={direct
                ? Number(direct.gross)
                : isNewOrder
                ? Number(resumeOrder.amount)
                : renewalUnitPrice(Number(resumeOrder.plan.price), resumeOrder.plan.renewalDiscountPct) * resumeOrder.qty}
              initial={direct ? toPanelData(direct) : null}
              expiredMode={!direct}
            >
              {orderSummary}
              {cardActions}
            </ResumePayPanel>
          </main>
        </>
      );
    }

    // Legacy hosted invoice (payments created before the in-portal flow) —
    // keep the external "Pay now" link; the stored invoice URL is still live.
    const payUrl = awaiting?.provider === 'NOWPayments' && awaiting.externalRef
      ? npInvoiceUrl(awaiting.externalRef)
      : null;

    if (awaiting || (isNewOrder && !hadDirect)) {
      return (
        <>
          <ClientTopbar breadcrumb={crumbs} balance={Number(me.balance)} />
          <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
            <div className="checkout-processing">
              <div className="panel checkout-processing-card">
                <div className="processing-title">{isNewOrder ? 'Complete your payment' : 'Complete your renewal payment'}</div>
                <div className="processing-amount">{money(Number(awaiting ? awaiting.gross : resumeOrder.amount))}</div>
                {orderSummary}
                <div className="t-note" style={{ maxWidth: 420 }}>
                  {payUrl
                    ? 'Awaiting crypto payment. Finish on the NOWPayments page — it confirms automatically once the transaction is received.'
                    : <>This {isNewOrder ? 'order' : 'renewal'} is awaiting a payment arranged outside the portal. If you&rsquo;re unsure how to pay, message <a href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>support on Telegram</a>.</>}
                </div>
                <CompletePaymentActions orderId={resumeOrder.id} payUrl={payUrl} />
              </div>
            </div>
          </main>
        </>
      );
    }

    // Dead charge but repay unavailable (crypto provider off) — honest notice
    // instead of a dead-end picker.
    if (hadDirect && !canRepay) {
      return (
        <>
          <ClientTopbar breadcrumb={crumbs} balance={Number(me.balance)} />
          <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
            <div className="panel" style={{ padding: 24 }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Payment window expired</h2>
              <p style={{ color: 'var(--muted)' }}>
                Crypto payments are temporarily unavailable, so a new payment address can&rsquo;t be issued right now.
                Message <a href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>support on Telegram</a> to complete this {isNewOrder ? 'order' : 'renewal'}.
              </p>
              <Link href={`/orders/${resumeOrder.id}`} className="btn primary">View order</Link>
            </div>
          </main>
        </>
      );
    }

    // Nothing payable — settled, cancelled, or never had a resumable charge.
    return (
      <>
        <ClientTopbar title="Checkout" balance={Number(me.balance)} />
        <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
          <div className="panel" style={{ padding: 24 }}>
            <h2 style={{ marginTop: 0, color: 'var(--text)' }}>This order has no pending payment</h2>
            <p style={{ color: 'var(--muted)' }}>Status is <strong>{resumeOrder.status}</strong>. No need to resume.</p>
            <Link href={`/orders/${resumeOrder.id}`} className="btn primary">View order</Link>
          </div>
        </main>
      </>
    );
  }

  // Renewal branch — terms come from the ORIGINAL order (its plan may even be
  // retired from the public catalog); the server enforces the same rule.
  let renewalOrder: OrderWithPlan | null = null;
  if (searchParams.renewOf) {
    renewalOrder = await prisma.order.findUnique({ where: { id: searchParams.renewOf }, include: { plan: true } });
    if (!renewalOrder || renewalOrder.clientId !== session!.user.id) {
      notFound();
    }
    if (renewalOrder.status === 'CANCELLED' || renewalOrder.status === 'PENDING_RENEWAL' || !renewalOrder.plan.renewalAllowed) {
      return (
        <>
          <ClientTopbar title="Checkout" balance={Number(me.balance)} />
          <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
            <div className="panel" style={{ padding: 24 }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>This order cannot be renewed</h2>
              <p style={{ color: 'var(--muted)' }}>
                {renewalOrder.status === 'CANCELLED' ? 'The order was cancelled.' : 'Renewals are not available for this plan.'}
              </p>
              <Link href={`/orders/${renewalOrder.id}`} className="btn primary">View order</Link>
            </div>
          </main>
        </>
      );
    }
  }

  const duration = renewalOrder ? renewalOrder.plan.durationDays : parseInt(searchParams.duration ?? '30', 10);
  const presetQty = renewalOrder ? renewalOrder.qty : parseInt(searchParams.qty ?? '1', 10);
  const presetLocation = renewalOrder ? renewalOrder.region : searchParams.location;
  const presetAutoExtend = renewalOrder ? renewalOrder.autoRenew : searchParams.autoExtend !== '0';

  // NB: plan.description is deliberately NOT surfaced here — it's an internal
  // admin-notes field and must never reach the client bundle.
  let planSummaries: { id: string; name: string; region: string; carrier: string; price: number; autoProvision: boolean; available: number }[];
  if (renewalOrder) {
    // Single "plan" = the original order's terms; the seats are already held.
    // Price carries the plan's renewal discount (audit B-6) — the same helper
    // the server charge paths use, so the summary matches the charge.
    const p = renewalOrder.plan;
    planSummaries = [{
      id: p.id,
      name: p.name,
      region: renewalOrder.region,
      carrier: p.carrier,
      price: renewalUnitPrice(Number(p.price), p.renewalDiscountPct),
      autoProvision: p.autoProvision,
      available: renewalOrder.qty,
    }];
  } else {
    const [allPlans, liveRegionItems] = await Promise.all([
      prisma.plan.findMany({
        where: { durationDays: duration, active: true, visibility: 'PUBLIC', deletedAt: null },
        orderBy: { price: 'asc' },
      }),
      prisma.catalogItem.findMany({ where: { kind: 'REGION', enabled: true }, select: { value: true } }),
    ]);
    // The Location select must offer ONLY current admin locations. Plan.region
    // is a denormalized string, not an FK — after a location is removed in
    // admin, plans keep the dead string; drop those plans here so checkout
    // never shows a location that no longer exists. (The renewal branch above
    // deliberately bypasses this: renewals keep the original order's terms.)
    const liveRegions = new Set(liveRegionItems.map(r => r.value));
    const plans = allPlans.filter(p => liveRegions.has(p.region));
    if (plans.length === 0) {
      return (
        <>
          <ClientTopbar title="Checkout" balance={Number(me.balance)} />
          <main style={{ padding: 24 }}>
            <div className="panel" style={{ padding: 24 }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>No plans available</h2>
              <p style={{ color: 'var(--muted)' }}>This duration is currently sold out. {SOLD_OUT_COPY.body}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="btn primary" href={TELEGRAM_SUPPORT_URL} target="_blank" rel="noopener noreferrer">{SOLD_OUT_COPY.cta}</a>
                <Link href="/catalog" className="btn">Back to catalog</Link>
              </div>
            </div>
          </main>
        </>
      );
    }

    // Shared seat math (lib/plan-availability) — the same query the plan-card
    // sold-out marking uses, so checkout and the cards can never disagree.
    const allocationByPlan = await allocatedByPlan(plans.map(p => p.id));
    planSummaries = plans.map(p => ({
      id: p.id,
      name: p.name,
      region: p.region,
      carrier: p.carrier,
      price: Number(p.price),
      autoProvision: p.autoProvision,
      available: Math.max(0, p.availableQuota - (allocationByPlan.get(p.id) ?? 0)),
    }));
    // Sold-out locations sink to the bottom of the Location list (owner) — a
    // stable sort keeps the price order within each group, and makes the
    // DEFAULT selection (planSummaries[0]) an AVAILABLE location instead of a
    // sold-out one (e.g. 7 Days defaulted to Texas · sold out over free NY).
    planSummaries.sort((a, b) => (a.available === 0 ? 1 : 0) - (b.available === 0 ? 1 : 0));
  }

  // Every location at capacity → CheckoutFlow opens the sold-out → Telegram
  // dialog on arrival (deep links / stale card clicks land here with nothing
  // sellable — Continue is disabled but the client needs a way forward).
  // Renewals are exempt: their seats are already held.
  const allSoldOut = !renewalOrder && planSummaries.every(p => p.available === 0);

  // Hint banner copy
  const headerHint = renewalOrder
    ? `Renewing ${renewalOrder.id} — paying extends this order's term; your proxies stay the same.`
    : null;

  const crumbs = renewalOrder
    ? [{ label: 'Orders', href: '/orders' }, { label: `Order ${renewalOrder.id}`, href: `/orders/${renewalOrder.id}` }, { label: 'Renew' }]
    : [{ label: 'Catalog', href: '/catalog' }, { label: 'Checkout' }];
  // The catalog plan cards are hard <a> links (they reset the runtime nav
  // stack), so the backlink row would otherwise be empty here — give it the
  // logical parent explicitly (owner: restore the checkout backlink).
  const backFallback = renewalOrder
    ? { path: `/orders/${renewalOrder.id}`, label: `Order ${renewalOrder.id}` }
    : { path: '/catalog', label: 'Catalog' };

  return (
    <>
      <ClientTopbar breadcrumb={crumbs} balance={Number(me.balance)} backFallback={backFallback} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        {headerHint && (
          <div className="t-note" style={{
            maxWidth: 1280, margin: '0 auto 16px', padding: '10px 14px',
            background: 'var(--info-dim)', color: 'var(--info)',
            borderRadius: 'var(--radius-md)',
          }}>{headerHint}</div>
        )}
        <CheckoutFlow
          duration={duration}
          qty={presetQty}
          autoExtend={presetAutoExtend}
          location={presetLocation ?? planSummaries[0].region}
          /* Only 'details'/'payment' are valid ENTRY steps; processing/failed
             are internal. Sanitize so a crafted ?step= can't render a blank body. */
          step={searchParams.step === 'payment' ? 'payment' : 'details'}
          balance={Number(me.balance)}
          plans={planSummaries}
          allowCard={allowCard}
          allowCrypto={allowCrypto}
          renewOf={renewalOrder?.id}
          renewalDiscountPct={renewalOrder ? renewalOrder.plan.renewalDiscountPct : 0}
          allSoldOut={allSoldOut}
        />
      </main>
    </>
  );
}
