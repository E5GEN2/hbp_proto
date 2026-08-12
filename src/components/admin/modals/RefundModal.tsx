'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { initiateRefundAction, completeRefundAction } from '@/lib/ui-actions/admin-actions';
import { money } from '@/lib/money';

const CATEGORIES = ['Customer not satisfied', 'Service not delivered', 'Goodwill', 'Duplicate charge', 'Fraud / chargeback', 'Other'] as const;

// Step 1 of the manual-refund flow (owner decision 2026-08-12): initiating
// marks the payment REFUND_IN_PROGRESS and records the reason. The money is
// then returned by the admin OUTSIDE the portal (crypto back to the client's
// wallet) — NO balance credit happens — and the refund is finished with
// CompleteRefundModal, which requires proof.
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
        await initiateRefundAction(paymentId, a, reason);
        toast('Refund initiated', `Return ${money(a)} to the client manually, then complete with proof`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Initiate refund"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn danger" onClick={submit} disabled={pending}>{pending ? 'Initiating…' : Number.isFinite(parseFloat(amount)) ? `Initiate refund of ${money(parseFloat(amount))}` : 'Initiate refund'}</button>
        </>
      }
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
        Payment · {paymentId}
      </div>
      <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
        This marks the refund <strong>in progress</strong> and notifies the client.
        Return the money manually (crypto back to their wallet) — the portal does
        NOT credit their balance — then finish with <strong>Complete refund</strong>,
        which requires a proof (tx hash / reference). Deposits can&rsquo;t be refunded
        here; use Adjust balance on the client instead.
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

// Step 2: the admin has returned the money externally and records the proof.
// Only then does the payment become REFUNDED (owner rule: no proof — no
// completed refund).
export function CompleteRefundModal({
  open, onClose, paymentId, amount,
}: { open: boolean; onClose: () => void; paymentId: string; amount: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [proof, setProof] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setProof(''); setErr(null); }
  }, [open]);

  function submit() {
    setErr(null);
    if (!proof.trim()) return setErr('Proof is required — tx hash or a reference to the completed transfer.');
    start(async () => {
      try {
        await completeRefundAction(paymentId, proof.trim());
        toast('Refund completed', `${money(amount)} · marked REFUNDED`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Complete refund"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Completing…' : `Mark ${money(amount)} refunded`}</button>
        </>
      }
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
        Payment · {paymentId}
      </div>
      <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
        Confirm the {money(amount)} was returned to the client. The proof is the
        audit record of the transfer — a tx hash or payment reference. The client
        is notified once you complete.
      </div>
      <div>
        <label className="form-label">Proof (tx hash / reference) — required</label>
        <textarea className="form-textarea mono" value={proof} onChange={e => setProof(e.target.value)} rows={2} placeholder="0x… / bank ref / support ticket" />
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
