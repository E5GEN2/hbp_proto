'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { setClientRiskAction } from '@/lib/admin-actions';

export function RiskModal({
  open, onClose, userId, currentRisk,
}: { open: boolean; onClose: () => void; userId: string; currentRisk: 'NONE' | 'REVIEW' | 'FLAG' }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [risk, setRisk] = useState<'NONE' | 'REVIEW' | 'FLAG'>(currentRisk);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setRisk(currentRisk); setNote(''); setErr(null); } }, [open, currentRisk]);

  function submit() {
    setErr(null);
    if (risk !== 'NONE' && !note.trim()) return setErr('Note required when raising risk');
    start(async () => {
      try {
        await setClientRiskAction(userId, risk, note.trim() || undefined);
        toast('Risk updated', `${userId} → ${risk}`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Set risk flag"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className={`btn ${risk === 'FLAG' ? 'danger' : 'primary'}`} onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Apply'}</button>
        </>
      }
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
        Client · {userId}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Risk level</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['NONE', 'REVIEW', 'FLAG'] as const).map(r => (
              <button
                key={r} type="button"
                onClick={() => setRisk(r)}
                className={`chip ${r === 'NONE' ? 'muted' : r === 'REVIEW' ? 'review' : 'flag'}`}
                style={{
                  padding: '6px 14px', fontSize: 12,
                  outline: risk === r ? '2px solid var(--accent)' : 'none',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {r === 'NONE' ? 'None' : r === 'REVIEW' ? 'Under review' : 'Flagged'}
              </button>
            ))}
          </div>
        </div>
        {risk !== 'NONE' && (
          <div>
            <label className="form-label">Reason / note <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea className="form-textarea" value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Audited" autoFocus />
          </div>
        )}
        {risk === 'FLAG' && (
          <div style={{ padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12, lineHeight: 1.5 }}>
            <strong>Heads up:</strong> Flagging only changes the risk badge. To stop the client from placing new orders, use <em>Block client</em>.
          </div>
        )}
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
