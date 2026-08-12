import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { fmtAdminStamp } from '@/lib/date';
import { PaymentMethodsPanel } from '@/components/client/PaymentMethods';
import { npInvoiceUrl } from '@/lib/nowpayments';

// Type-column primary label. Mirrors canon `paymentDescription`. Owner
// revision 2026-08-04: an ORDER payment drops the generic word "Payment" and
// shows the method itself (Crypto / Balance / Visa ••…) — the row is already
// identified as an order by the adjacent Order ID column, so "Payment" was
// pure noise. Refund / Deposit keep their type word (+ method subline).
function txDescription(p: { status: string; kind: string; method: string }) {
  if (p.status === 'REFUNDED') return 'Refund';
  // kind is the single source of truth (was a brittle regex on the method
  // string, which mislabelled crypto deposits whose method is just "Crypto").
  if (p.kind === 'TOPUP') return 'Deposit';
  return shortMethod(p.method) || 'Payment';
}

// Strip the deposit-flow prefixes from the method string (the Type cell already
// says "Deposit"). Mirrors canon `shortPaymentMethod`.
function shortMethod(m: string) {
  return (m || '').replace(/^(Deposit|Wallet top-up) via\s*/i, '');
}

// Status → {chip class, label}. MANUAL_REVIEW has no bare `.chip.manual_review`
// rule (globals.css) and its raw label reads "Manual_review" — map it to the
// violet `review` chip with a human label so the client whose money is under
// verification sees something intelligible, not an unstyled token (audit).
function statusChip(status: string): { cls: string; label: string } {
  if (status === 'MANUAL_REVIEW') return { cls: 'review', label: 'Verifying' };
  // Manual-refund flow: admin has initiated and is returning the money
  // externally; REFUNDED lands only once proof is recorded.
  if (status === 'REFUND_IN_PROGRESS') return { cls: 'awaiting', label: 'Refunding' };
  if (status === 'REFUND_REQUESTED') return { cls: 'review', label: 'Refund requested' };
  return { cls: status.toLowerCase(), label: status.charAt(0) + status.slice(1).toLowerCase() };
}

type TxTab = 'all' | 'confirmed' | 'awaiting' | 'refunded';

// Status → tab bucket. Mirrors the original page's where-clause grouping.
function txBucket(status: string): TxTab | null {
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'AWAITING' || status === 'PENDING') return 'awaiting';
  // The whole refund lifecycle lives in one tab: requested → in progress
  // (admin returning the money manually) → refunded.
  if (status === 'REFUNDED' || status === 'REFUND_IN_PROGRESS' || status === 'REFUND_REQUESTED') return 'refunded';
  return null;
}

export default async function BillingPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const tab = (['all', 'confirmed', 'awaiting', 'refunded'].includes(searchParams.tab ?? '')
    ? searchParams.tab
    : 'all') as TxTab;

  // Fetch all payments once — tab counts come from the full set, the active
  // filter is applied in JS below (canon pattern, read-only query change).
  const [me, payments, methods] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.payment.findMany({
      // Hide long-dead crypto deposits from the client ledger: a TOPUP that
      // failed/cancelled and is now older than 7 days is pure noise (the
      // NOWPayments address is long expired, no money ever moved). Kept while
      // < 7 days old so the client still sees a recent "didn't complete" and
      // can retry. CONFIRMED deposits are NEVER hidden (accounting/history);
      // admin /payments stays unfiltered (data untouched in the DB). Owner
      // crypto-deposit-expiry policy 2026-08-07.
      where: {
        clientId: userId,
        NOT: {
          kind: 'TOPUP',
          status: { in: ['FAILED', 'CANCELLED'] },
          createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { invoice: true, order: { select: { id: true, status: true } } },
    }),
    prisma.paymentMethod.findMany({ where: { userId } }),
  ]);

  const balance = Number(me?.balance ?? 0);

  const counts: Record<TxTab, number> = { all: payments.length, confirmed: 0, awaiting: 0, refunded: 0 };
  for (const p of payments) {
    const b = txBucket(p.status);
    if (b) counts[b] += 1;
  }

  const filtered = tab === 'all' ? payments : payments.filter(p => txBucket(p.status) === tab);

  const tabDefs: { key: TxTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'awaiting', label: 'Awaiting' },
    { key: 'refunded', label: 'Refunded' },
  ];

  return (
    <>
      <ClientTopbar title="Billing" balance={balance} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="billing-grid">
            <div className="billing-grid-left">
              {/* Balance hero — wide stat tile above the Transactions panel */}
              <div className="balance-card">
                <div className="balance-card-left">
                  {/* Owner: the balance amount + caption are removed from this
                      hero block; the running balance still shows on the
                      "Account balance" card in Payment methods. */}
                  <div className="panel-title">Account balance</div>
                </div>
                <div className="balance-card-actions">
                  <Link href="/checkout?kind=deposit" className="btn primary">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    Add funds
                  </Link>
                </div>
              </div>

              {/* Transactions */}
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Transactions</span>
                </div>
                <div className="tabs">
                  {tabDefs.map(t => (
                    <Link key={t.key} href={`/billing?tab=${t.key}`} className={`tab ${tab === t.key ? 'active' : ''}`}>
                      {t.label} <span className="tab-count">{counts[t.key]}</span>
                    </Link>
                  ))}
                </div>
                {filtered.length === 0 ? (
                  <div className="empty" style={{ padding: '48px 20px' }}>
                    <div className="empty-title">No transactions in this view.</div>
                    <div className="empty-desc">
                      {tab === 'all'
                        ? 'Make a purchase or top up your balance to see activity here.'
                        : 'Switch filters to see other transactions.'}
                    </div>
                  </div>
                ) : (
                  <div className="table-wrap dt-scroll">
                    <table className="dt">
                      {/* CTS colgroup (globals.css "CLIENT TABLE SYSTEM").
                          Anchors from REAL rendered measurements at the
                          651px budget (panel inner width @1280, 2-col
                          grid): Payment ID 102 (header "PAYMENT ID" binds; 20px edge),
                          Amount 91 (refund "+ $9,999.99" end-to-clip incl. floor) — the
                          widest string money() can emit under the $10,000
                          cap; review finding CTS-2), Date 113 ("30 Jul ·
                          18:42" mono, measured 101px end-to-clip-safe), Order ID
                          87, Status 89 (chip "Confirmed" end-to-clip), Invoice
                          81 ("Pay now" 51.3px + 28 pads + floor-compression
                          headroom — this is an ellipsis column, so content
                          must clear the CONTENT box or it turns into
                          "Pay n…"). Each carries A/651 as a percentage;
                          Type stays auto and absorbs the remainder (88px at
                          budget — one-line "Wallet top-up" at ≥1280; the
                          method line may word-wrap only in the sub-1280
                          pan/floor regime).
                          ⚠ Chrome drops calc(px + %) on <col> in fixed
                          layout — plain percentages only. Σ = 651px exactly
                          at the anchor budget. */}
                      <colgroup>
                        <col style={{ width: '15.6682%' }} />{/* Payment ID 102 */}
                        <col style={{ width: '13.9785%' }} />{/* Amount 91 */}
                        <col style={{ width: '17.3579%' }} />{/* Date 113 */}
                        <col />{/* Type auto (88 @ budget) */}
                        <col style={{ width: '13.3641%' }} />{/* Order ID 87 */}
                        <col style={{ width: '13.6713%' }} />{/* Status 89 */}
                        <col style={{ width: '12.4424%' }} />{/* Invoice 81 */}
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="col-id">Payment ID</th>
                          <th className="col-num">Amount</th>
                          <th className="col-date">Date</th>
                          <th className="col-text">Type</th>
                          <th className="col-id">Order ID</th>
                          <th className="col-status">Status</th>
                          <th className="col-action">Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(p => {
                          const refunded = p.status === 'REFUNDED';
                          const desc = txDescription({ status: p.status, kind: p.kind, method: p.method });
                          const method = shortMethod(p.method);
                          const signed = (refunded ? '+ ' : '') + money(Number(p.gross));
                          return (
                            <tr key={p.id}>
                              <td className="col-id mono">{p.id}</td>
                              <td className={`col-num mono ${refunded ? 'positive' : ''}`}>{signed}</td>
                              <td className="col-date mono">{fmtAdminStamp(p.createdAt)}</td>
                              <td className="col-text">
                                <div className="tx-type">{desc}</div>
                                {/* Order rows now show the method AS the type,
                                    so skip the duplicate method subline. */}
                                {method && method !== desc && <div className="tx-method">{method}</div>}
                              </td>
                              <td className="col-id">
                                {p.order
                                  ? <Link href={`/orders/${p.order.id}`} className="td-link">{p.order.id}</Link>
                                  : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                              <td className="col-status">{(() => { const c = statusChip(p.status); return <span className={`chip ${c.cls}`}>{c.label}</span>; })()}</td>
                              <td className="col-action">
                                {/* No client-facing invoices at launch (decision 2026-07-06) —
                                    PDFs live in the admin panel only. */}
                                {p.status === 'AWAITING' && p.provider === 'NOWPayments' && p.payAddress
                                  /* Direct in-portal payment → our own pay panel (resume the live charge). */
                                  ? <Link className="td-link" href={p.orderId ? `/checkout?resume=${p.orderId}` : `/checkout?kind=deposit&resume=${p.id}`}>Pay now</Link>
                                  : p.status === 'FAILED' && p.provider === 'NOWPayments' && p.payAddress && (p.orderId ? p.order?.status === 'NEW' : true)
                                  /* Dead charge, order still open (or a deposit) → fresh-address
                                     recovery. Skip once the order has moved on (settled/cancelled). */
                                  ? <Link className="td-link" href={p.orderId ? `/checkout?resume=${p.orderId}` : `/checkout?kind=deposit&resume=${p.id}`}>Retry</Link>
                                  : p.status === 'AWAITING' && p.provider === 'NOWPayments' && p.externalRef
                                  /* Legacy hosted invoice (pre-in-portal payments). */
                                  ? <a className="td-link" href={npInvoiceUrl(p.externalRef)}>Pay now</a>
                                  : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Payment methods — full-height right column */}
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Payment methods</span></div>
              <PaymentMethodsPanel
                methods={methods.map(m => ({
                  id: m.id, kind: m.kind as any, brand: m.brand,
                  last4: m.last4, exp: m.exp, isDefault: m.isDefault, locked: m.locked,
                }))}
                balance={balance}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
