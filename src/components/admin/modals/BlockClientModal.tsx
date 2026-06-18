'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { blockClientAction } from '@/lib/admin-actions';

const REASONS = ['Fraud', 'TOS violation', 'Abuse / harassment', 'Chargeback', 'Other'] as const;

export function BlockClientModal({
  open, onClose, userId,
}: { open: boolean; onClose: () => void; userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState<typeof REASONS[number]>('Fraud');
  const [detail, setDetail] = useState('');
  const [suspendOrders, setSuspendOrders] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setReason('Fraud'); setDetail(''); setSuspendOrders(true); setErr(null); } }, [open]);

  function submit() {
    setErr(null);
    const full = `${reason}${detail ? ' — ' + detail : ''}`;
    start(async () => {
      try {
        const r = await blockClientAction(userId, full, suspendOrders);
        toast('Client blocked', r.suspended ? `${r.suspended} active orders suspended` : 'No active orders', 'warning');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Block client"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn danger" onClick={submit} disabled={pending}>{pending ? 'Blocking…' : 'Block client'}</button>
        </>
      }
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
        Client · {userId}
      </div>
      <div style={{ background: 'var(--danger-dim)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
        Blocked clients cannot sign in or place new orders. Use <strong>Unblock</strong> from this same screen to reverse.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Reason</label>
          <select className="form-select" value={reason} onChange={e => setReason(e.target.value as any)}>
            {REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Detail (audited)</label>
          <textarea className="form-textarea" value={detail} onChange={e => setDetail(e.target.value)} rows={2} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1, paddingRight: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>Suspend all active orders</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Each active order → status SUSPENDED. Proxies stay reserved.</div>
          </div>
          <span className={`toggle-v2 ${suspendOrders ? 'on' : ''}`} onClick={() => setSuspendOrders(v => !v)} style={{ cursor: 'pointer' }} />
        </div>
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
