import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { money } from '@/lib/money';
import { Stage15Pill } from '@/components/ui/Stage15Badge';
import { PaymentMethodsPanel } from '@/components/client/PaymentMethods';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Compact datetime for the Transactions table — drops the year when it matches
// "now" (most rows do) and uses 24h time so the date cell lives in ~120px.
// Mirrors canon `fmtTxDate`; presentation-only, no shared helper touched.
function fmtTxDate(d: Date) {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const yr = sameYear ? '' : ` '${String(d.getFullYear()).slice(2)}`;
  return `${MONTHS[d.getMonth()]} ${day}${yr}, ${hh}:${mm}`;
}

// Type-column primary label. Mirrors canon `paymentDescription`.
function txDescription(p: { status: string; orderId: string | null; method: string }) {
  if (p.status === 'REFUNDED') return 'Refund';
  if (!p.orderId && /^(deposit|wallet top.?up|top.?up)/i.test(p.method || '')) return 'Deposit';
  if (!p.orderId) return p.method || 'Payment';
  return 'Order payment';
}

// Strip the deposit-flow prefixes from the method string (the Type cell already
// says "Deposit"). Mirrors canon `shortPaymentMethod`.
function shortMethod(m: string) {
  return (m || '').replace(/^(Deposit|Wallet top-up) via\s*/i, '');
}

type TxTab = 'all' | 'confirmed' | 'awaiting' | 'refunded';

// Status → tab bucket. Mirrors the original page's where-clause grouping.
function txBucket(status: string): TxTab | null {
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'AWAITING' || status === 'PENDING') return 'awaiting';
  if (status === 'REFUNDED') return 'refunded';
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
      where: { clientId: userId },
      orderBy: { createdAt: 'desc' },
      include: { invoice: true, order: { select: { id: true } } },
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
                  <div className="panel-title">Account balance <Stage15Pill /></div>
                  <div className="balance-card-value">{money(balance)}</div>
                  <div className="balance-card-help">Use your balance to pay for new orders and renewals.</div>
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
                  <span className="panel-title">Transactions <Stage15Pill>Invoice v1.5</Stage15Pill></span>
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
                      <colgroup>
                        <col style={{ width: 100 }} />
                        <col style={{ width: 75 }} />
                        <col style={{ width: 120 }} />
                        <col />
                        <col style={{ width: 95 }} />
                        <col style={{ width: 85 }} />
                        <col style={{ width: 90 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="col-id">Payment ID</th>
                          <th className="col-num right">Amount</th>
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
                          const desc = txDescription({ status: p.status, orderId: p.orderId, method: p.method });
                          const method = shortMethod(p.method);
                          const signed = (refunded ? '+ ' : '') + money(Number(p.gross));
                          return (
                            <tr key={p.id}>
                              <td className="col-id mono">{p.id}</td>
                              <td className={`col-num right mono ${refunded ? 'positive' : ''}`}>{signed}</td>
                              <td className="col-date mono">{fmtTxDate(p.createdAt)}</td>
                              <td className="col-text">
                                <div className="tx-type">{desc}</div>
                                {method && <div className="tx-method">{method}</div>}
                              </td>
                              <td className="col-id">
                                {p.order
                                  ? <Link href={`/orders/${p.order.id}`} className="td-link">{p.order.id}</Link>
                                  : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                              <td className="col-status"><span className={`chip ${p.status.toLowerCase()}`}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</span></td>
                              <td className="col-action">
                                {p.invoice ? <a className="td-link" href="#">Download</a> : <span style={{ color: 'var(--muted)' }}>—</span>}
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
