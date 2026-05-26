'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/client-actions';

const REASONS = [
  'Cannot connect / dropped',
  'Banned at destination',
  'Slow / degraded speed',
  'Rotation not working',
  'Authentication fails',
  'Other (please describe)',
];

export function ClientProxyRequestReplacement({
  proxyId, health,
}: { proxyId: string; health: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [pending, start] = useTransition();

  if (health === 'HEALTHY') return null;

  function submit() {
    const full = `${reason}${detail ? ' — ' + detail : ''}`;
    start(async () => {
      try {
        await CA.clientRequestReplacementAction(proxyId, full);
        toast('Replacement requested', 'Our team will swap your proxy within 24 hours', 'success');
        setOpen(false);
        setDetail('');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Request replacement</button>
      <Modal
        open={open} onClose={() => setOpen(false)}
        title={`Request replacement for ${proxyId}`}
        footer={<>
          <button className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? '…' : 'Submit request'}</button>
        </>}
      >
        <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          We&rsquo;ll swap this proxy for a healthy one from the same pool. The replacement keeps your order active and shows up here automatically.
        </div>
        <label className="form-label">What went wrong?</label>
        <select className="form-select" value={reason} onChange={e => setReason(e.target.value)} style={{ marginBottom: 12 }}>
          {REASONS.map(r => <option key={r}>{r}</option>)}
        </select>
        <label className="form-label">Detail (optional)</label>
        <textarea className="form-textarea" rows={3} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Anything that would help us reproduce the issue" />
      </Modal>
    </>
  );
}
