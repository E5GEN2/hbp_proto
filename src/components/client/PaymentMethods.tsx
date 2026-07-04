'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
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
  const [addOpen, setAddOpen] = useState(false);
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
            : isBalance ? 'Always available' : m.kind === 'CRYPTO' ? 'No expiry' : '';
          // Set as default never applies to Balance (the action rejects it);
          // Remove never applies to locked methods.
          const canSetDefault = !m.isDefault && !isBalance;
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
        <button className="method-add-card" onClick={() => setAddOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          <span className="method-add-card-label">Add payment method</span>
        </button>
      </div>
      <AddPaymentMethodModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function AddPaymentMethodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [brand, setBrand] = useState('Visa');
  const [number, setNumber] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [setDefault, setSetDefault] = useState(true);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      try {
        await BA.addPaymentMethodAction({ brand, number, exp, setDefault });
        toast('Card added', brand, 'success');
        setNumber(''); setExp(''); setCvc('');
        onClose();
        router.refresh();
      } catch (e: any) { toast('Add failed', e.message, 'danger'); }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add payment method"
      footer={<>
        <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={pending || !number || !exp}>{pending ? '…' : 'Add card'}</button>
      </>}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
        Mock card — production would use Stripe Elements. No actual numbers are sent anywhere.
      </div>
      <div className="methods-grid">
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Brand</label>
          <select className="form-select" value={brand} onChange={e => setBrand(e.target.value)}>
            <option>Visa</option><option>Mastercard</option><option>American Express</option><option>Discover</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Card number</label>
          <input className="form-input mono" value={number} onChange={e => setNumber(e.target.value)} placeholder="4242 4242 4242 4242" />
        </div>
        <div>
          <label className="form-label">Expiry (MM/YY)</label>
          <input className="form-input mono" value={exp} onChange={e => setExp(e.target.value)} placeholder="12/27" />
        </div>
        <div>
          <label className="form-label">CVC</label>
          <input className="form-input mono" value={cvc} onChange={e => setCvc(e.target.value)} placeholder="123" />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Set as default</span>
          <span className={`toggle ${setDefault ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSetDefault(v => !v)} />
        </div>
      </div>
    </Modal>
  );
}
