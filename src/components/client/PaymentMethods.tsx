'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as BA from '@/lib/billing-actions';

type Method = {
  id: string;
  kind: 'BALANCE' | 'CARD' | 'CRYPTO';
  brand: string;
  last4: string | null;
  exp: string | null;
  isDefault: boolean;
  locked: boolean;
};

export function PaymentMethodsList({ methods, balance }: { methods: Method[]; balance: number }) {
  const router = useRouter();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, start] = useTransition();

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
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {methods.map(m => (
          <div key={m.id} style={{ padding: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.brand}</div>
              {m.isDefault && <span className="chip accent sm">Default</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              {m.last4 ? `•• ${m.last4}` : m.kind === 'BALANCE' ? `Balance: $${balance.toFixed(2)}` : '—'}
              {m.exp && ` · exp ${m.exp}`}
              {m.locked && ' · Locked'}
            </div>
            {!m.locked && (
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {!m.isDefault && <button className="btn sm" disabled={pending} onClick={() => setDefault(m.id)}>Set as default</button>}
                <button className="btn sm" disabled={pending} onClick={() => remove(m.id, `${m.brand}${m.last4 ? ' •• ' + m.last4 : ''}`)}>Remove</button>
              </div>
            )}
          </div>
        ))}
        <button className="btn" style={{ borderStyle: 'dashed' }} onClick={() => setAddOpen(true)}>+ Add payment method</button>
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
