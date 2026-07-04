'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/ui-actions/client-actions';

const REASONS = [
  'Cannot connect / dropped',
  'Banned at destination',
  'Slow / degraded speed',
  'Rotation not working',
  'Authentication fails',
  'Other (please describe)',
];

type Creds = { ip: string; port: number; username: string; password: string };

// Canon proxy-detail header: Copy credentials + Rotate IP, plus Request
// replacement when the proxy is unhealthy.
export function ClientProxyHeaderActions({
  proxyId, health, creds,
}: { proxyId: string; health: string; creds: Creds }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [pending, start] = useTransition();

  const healthy = health.toUpperCase() === 'HEALTHY';

  async function copyCreds() {
    const line = `http://${creds.ip}:${creds.port}:${creds.username}:${creds.password}`;
    try {
      await navigator.clipboard.writeText(line);
      toast('Credentials copied', proxyId, 'success');
    } catch {
      toast('Copy failed', 'Use the Credentials panel', 'danger');
    }
  }

  // No IP-rotation backend yet — client affordance only (prototype).
  function rotateIp() {
    toast('Rotation requested', `${proxyId} will receive a fresh IP shortly.`, 'info');
  }

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
      <button className="btn" onClick={copyCreds}>
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
        Copy credentials
      </button>
      <button className="btn" onClick={rotateIp}>
        <svg viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
        Rotate IP
      </button>
      {!healthy && <button className="btn danger" onClick={() => setOpen(true)}>Request replacement</button>}

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
