'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { markPaidAction } from '@/lib/ui-actions/admin-actions';

export function MarkPaidModal({
  open, onClose, paymentId, paymentLabel,
}: { open: boolean; onClose: () => void; paymentId: string; paymentLabel?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [source, setSource] = useState<'bank-transfer' | 'on-chain' | 'cash' | 'other'>('bank-transfer');
  const [ref, setRef] = useState('');
  const [activate, setActivate] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!open) { setRef(''); setErr(null); setSource('bank-transfer'); setActivate(true); } }, [open]);

  function submit() {
    setErr(null);
    start(async () => {
      try {
        await markPaidAction(paymentId, source, ref.trim() || undefined);
        toast('Payment confirmed', paymentId + (activate ? ' · order activation triggered' : ''), 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Mark payment confirmed"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Confirming…' : 'Confirm payment'}</button>
        </>
      }
    >
      {paymentLabel && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
          {paymentLabel}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Confirmation source</label>
          <select className="form-select" value={source} onChange={e => setSource(e.target.value as any)}>
            <option value="bank-transfer">Bank transfer</option>
            <option value="on-chain">On-chain (crypto)</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="form-label">Reference / txn ID (optional)</label>
          <input className="form-input mono" value={ref} onChange={e => setRef(e.target.value)} placeholder="0xabc… / wire-ref / receipt-#" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>Trigger order activation</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              When ON, the order advances and proxies auto-assign if the plan allows
            </div>
          </div>
          <span className={`toggle-v2 ${activate ? 'on' : ''}`} onClick={() => setActivate(v => !v)} style={{ cursor: 'pointer' }} />
        </div>
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
