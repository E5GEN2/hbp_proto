'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/ui-actions/client-actions';
import { FormSelect } from '@/components/ui/FormSelect';

const REASONS = [
  'Cannot connect / dropped',
  'Banned at destination',
  'Slow / degraded speed',
  'Rotation not working',
  'Authentication fails',
  'Other (please describe)',
];

type Creds = { ip: string; port: number; username: string; password: string };

// Canon proxy-detail header: Copy credentials, plus Request replacement when
// the proxy is unhealthy. (Rotate IP removed — no rotation backend yet →
// Phase-2 backlog.)
export function ClientProxyHeaderActions({
  proxyId, health, creds, rotationUrl,
}: { proxyId: string; health: string; creds: Creds; rotationUrl?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [pending, start] = useTransition();

  const healthy = health.toUpperCase() === 'HEALTHY';

  async function copyCreds() {
    // socks5 + same port (owner: creds identical for both protocols); include
    // the rotation URL on its own line when the proxy has one (owner B1).
    const line = `socks5://${creds.ip}:${creds.port}:${creds.username}:${creds.password}`
      + (rotationUrl ? `\n${rotationUrl}` : '');
    try {
      await navigator.clipboard.writeText(line);
      toast('Credentials copied', rotationUrl ? `${proxyId} · with rotation URL` : proxyId, 'success');
    } catch {
      toast('Copy failed', 'Use the Credentials panel', 'danger');
    }
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
      {!healthy && <button className="btn danger" onClick={() => setOpen(true)}>Request replacement</button>}

      <Modal
        open={open} onClose={() => setOpen(false)}
        title={`Request replacement for ${proxyId}`}
        footer={<>
          <button className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? '…' : 'Submit request'}</button>
        </>}
      >
        <div className="t-body" style={{ marginBottom: 12 }}>
          We&rsquo;ll swap this proxy for a fresh healthy one. The replacement keeps your order active and shows up here automatically.
        </div>
        <label className="form-label">What went wrong?</label>
        <FormSelect
          value={reason}
          onChange={setReason}
          options={REASONS.map(r => ({ value: r }))}
          wrapStyle={{ marginBottom: 12 }}
        />
        <label className="form-label">Detail (optional)</label>
        <textarea className="form-textarea" rows={3} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Anything that would help us reproduce the issue" />
      </Modal>
    </>
  );
}
