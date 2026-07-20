'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { refundPaymentAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

const CATEGORIES = ['Customer not satisfied', 'Service not delivered', 'Goodwill', 'Duplicate charge', 'Fraud / chargeback', 'Other'] as const;

export function RefundModal({
  open, onClose, paymentId, maxAmount,
}: { open: boolean; onClose: () => void; paymentId: string; maxAmount: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(maxAmount.toString());
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('Customer not satisfied');
  const [detail, setDetail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(maxAmount.toString());
      setErr(null);
      setDetail('');
      setCategory('Customer not satisfied');
    }
  }, [open, maxAmount]);

  function submit() {
    setErr(null);
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) return setErr('Amount must be > 0');
    if (a > maxAmount) return setErr(`Amount cannot exceed ${money(maxAmount)}`);
    const reason = `${category}${detail ? ' — ' + detail : ''}`;
    start(async () => {
      try {
        const r = await refundPaymentAction(paymentId, a, reason);
        toast('Refund issued', `${money(a)} → client balance · new bal ${money(r.newBalance)}`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Issue refund"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn danger" onClick={submit} disabled={pending}>{pending ? 'Refunding…' : `Refund ${money(parseFloat(amount))}`}</button>
        </>
      }
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
        Payment · {paymentId}
      </div>
      <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
        Refund credits the client&rsquo;s balance (`refund_credit` ledger entry)
        and closes the order&rsquo;s <code>refund-pending</code> review once no
        other reviewable payment remains. Proxies and credentials are NOT touched automatically.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Refund amount (max {money(maxAmount)})</label>
          <input className="form-input mono" type="number" min={0.01} max={maxAmount} step={0.01} value={amount} onChange={e => setAmount(e.target.value)} />
          <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
            <button type="button" className="btn sm" onClick={() => setAmount(maxAmount.toString())}>Full</button>
            <button type="button" className="btn sm" onClick={() => setAmount((maxAmount / 2).toFixed(2))}>50%</button>
            <button type="button" className="btn sm" onClick={() => setAmount((maxAmount / 4).toFixed(2))}>25%</button>
          </div>
        </div>
        <div>
          <label className="form-label">Reason category</label>
          <FormSelect value={category} onChange={v => setCategory(v as any)} placeholder={null} options={CATEGORIES.map(c => ({ value: c }))} />
        </div>
        <div>
          <label className="form-label">Detail (optional)</label>
          <textarea className="form-textarea" value={detail} onChange={e => setDetail(e.target.value)} rows={2} placeholder="Audited" />
        </div>
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
