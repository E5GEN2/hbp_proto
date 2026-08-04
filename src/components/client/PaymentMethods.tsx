'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { money } from '@/lib/money';
import * as BA from '@/lib/ui-actions/billing-actions';

type Method = {
  id: string;
  kind: 'BALANCE' | 'CARD' | 'CRYPTO';
  brand: string;
  last4: string | null;
  exp: string | null;
  isDefault: boolean;
  locked: boolean;
};

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7H5a2 2 0 00-2 2v8a2 2 0 002 2h16a1 1 0 001-1V8a1 1 0 00-1-1zM3 7V6a2 2 0 012-2h13" /><circle cx="17" cy="13" r="1.5" fill="currentColor" stroke="none" /></svg>
);
const CardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></svg>
);

export function PaymentMethodsPanel({ methods, balance }: { methods: Method[]; balance: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  // Account balance pinned to the very top (system fixture, can't move),
  // then default first among the remaining methods. Mirrors canon sort.
  const list = [...methods].sort((a, b) => {
    if (a.kind === 'BALANCE' && b.kind !== 'BALANCE') return -1;
    if (b.kind === 'BALANCE' && a.kind !== 'BALANCE') return 1;
    return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
  });

  function setDefault(id: string) {
    start(async () => {
      try {
        await BA.setDefaultPaymentMethodAction(id);
        toast('Default set', '', 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  function remove(id: string, brand: string) {
    if (!confirm(`Remove ${brand}?`)) return;
    start(async () => {
      try {
        await BA.removePaymentMethodAction(id);
        toast('Removed', brand, 'success');
        router.refresh();
      } catch (e: any) { toast('Cannot remove', e.message, 'danger'); }
    });
  }

  return (
    <>
      <div className="methods-grid methods-grid-stack">
        {list.map(m => {
          const isBalance = m.kind === 'BALANCE';
          const isCard = m.kind === 'CARD';
          const subLine = isBalance
            ? money(balance)
            : isCard
              ? `•••• ${m.last4 ?? '0000'}`
              : (m.last4 ? `…${m.last4}` : '');
          const expLabel = m.exp
            ? `Expires ${m.exp}`
            : m.kind === 'CRYPTO' ? 'No expiry' : ''; // owner: drop "Always available" on the balance card
          // Canon: every non-default method offers «Set as default» — Balance
          // included; Remove never applies to locked methods.
          const canSetDefault = !m.isDefault;
          const canRemove = !m.locked;
          const showActions = canSetDefault || canRemove;
          return (
            <div key={m.id} className={`method-card ${m.isDefault ? 'default' : ''}`}>
              <div className="method-card-header">
                <span className="method-card-brand-name">
                  <span className="method-card-brand-icon">{isBalance ? <WalletIcon /> : isCard ? <CardIcon /> : null}</span>
                  {m.brand}
                </span>
                {m.isDefault && <span className="chip accent method-card-default-chip">Default</span>}
              </div>
              {subLine && <div className="method-card-last4">{subLine}</div>}
              {expLabel && <div className="method-card-exp">{expLabel}</div>}
              {showActions && (
                <div className="method-card-actions">
                  {canSetDefault && <button className="btn" disabled={pending} onClick={() => setDefault(m.id)}>Set as default</button>}
                  {canRemove && <button className="btn ghost" disabled={pending} onClick={() => remove(m.id, `${m.brand}${m.last4 ? ' •• ' + m.last4 : ''}`)}>Remove</button>}
                </div>
              )}
            </div>
          );
        })}
        {/* Card entry is not wired for launch — inert tile with a "Coming
            soon" note (owner); the mock add-card modal was removed. */}
        <div className="method-add-card is-disabled" aria-disabled="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          <span className="method-add-card-label">Add payment method</span>
          <span className="method-add-card-soon">Coming soon</span>
        </div>
      </div>
    </>
  );
}
