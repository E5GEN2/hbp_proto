'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { addNoteAction } from '@/lib/admin-actions';

export function AddNoteModal({
  open, onClose, objectType, objectId,
}: {
  open: boolean; onClose: () => void;
  objectType: 'ORDER' | 'PAYMENT' | 'PROXY' | 'CLIENT' | 'PLAN';
  objectId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!body.trim()) return setErr('Note can\'t be empty');
    start(async () => {
      try {
        await addNoteAction(objectType, objectId, body);
        toast('Note added', objectId, 'success');
        setBody('');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title={`Add note · ${objectId}`} size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save note'}</button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        Internal note · admin-only · written to audit log
      </div>
      <textarea
        className="form-textarea"
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="What happened? Context for the next operator."
        rows={5}
        autoFocus
      />
      {err && <div style={{ marginTop: 8, padding: 8, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
