'use client';
import { useState, useTransition } from 'react';
import { Modal } from './Modal';

export type ConfirmActionProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  entityLabel?: string;
  message: string | React.ReactNode;
  impact?: string[];
  requireReason?: boolean;
  requiredPhrase?: string;
  confirmLabel: string;
  confirmTone?: 'primary' | 'danger';
  onConfirm: (opts: { reason?: string }) => Promise<void> | void;
};

export function ConfirmAction({
  open, onClose, title, entityLabel, message, impact, requireReason,
  requiredPhrase, confirmLabel, confirmTone = 'primary', onConfirm,
}: ConfirmActionProps) {
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setReason('');
    setPhrase('');
    setErr(null);
  }

  function close() { reset(); onClose(); }

  function submit() {
    setErr(null);
    if (requireReason && !reason.trim()) {
      setErr('A reason is required.');
      return;
    }
    if (requiredPhrase && phrase.trim() !== requiredPhrase) {
      setErr(`Type "${requiredPhrase}" to confirm.`);
      return;
    }
    start(async () => {
      try {
        await onConfirm({ reason: reason.trim() || undefined });
        reset();
        onClose();
      } catch (e: any) {
        setErr(e?.message ?? 'Failed');
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <button className="btn" onClick={close} disabled={pending}>Cancel</button>
          <button className={`btn ${confirmTone}`} onClick={submit} disabled={pending}>
            {pending ? '…' : confirmLabel}
          </button>
        </>
      }
    >
      {entityLabel && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
          {entityLabel}
        </div>
      )}
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, marginBottom: impact?.length ? 12 : 0 }}>
        {message}
      </div>
      {impact && impact.length > 0 && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>What happens</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            {impact.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}
      {requireReason && (
        <div style={{ marginBottom: 8 }}>
          <label className="form-label">Reason</label>
          <textarea
            className="form-textarea"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Required — audited in the activity log"
            rows={3}
            autoFocus
          />
        </div>
      )}
      {requiredPhrase && (
        <div style={{ marginBottom: 8 }}>
          <label className="form-label">Type <code style={{ background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>{requiredPhrase}</code> to confirm</label>
          <input
            className="form-input mono"
            value={phrase}
            onChange={e => setPhrase(e.target.value)}
            autoFocus
          />
        </div>
      )}
      {err && <div style={{ marginTop: 8, padding: 8, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
