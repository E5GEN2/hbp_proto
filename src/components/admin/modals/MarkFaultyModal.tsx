'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { markProxyFaultyAction } from '@/lib/ui-actions/admin-actions';

const CATEGORIES = [
  { v: 'connection-loss',     l: 'Connection loss / cannot reach' },
  { v: 'high-latency',        l: 'High latency / degraded speed' },
  { v: 'banned-ip',           l: 'IP banned / blocked at destination' },
  { v: 'rotation-failure',    l: 'Rotation not working' },
  { v: 'authentication',      l: 'Auth failures' },
  { v: 'other',               l: 'Other (write a note)' },
] as const;

export function MarkFaultyModal({
  open, onClose, proxyId,
}: { open: boolean; onClose: () => void; proxyId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<string>(CATEGORIES[0].v);
  const [detail, setDetail] = useState('');
  const [autoReplace, setAutoReplace] = useState(true);
  const [notifyClient, setNotifyClient] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory(CATEGORIES[0].v);
      setDetail('');
      setAutoReplace(true);
      setNotifyClient(true);
      setErr(null);
    }
  }, [open]);

  function submit() {
    setErr(null);
    const reason = `${CATEGORIES.find(c => c.v === category)?.l ?? category}${detail ? ' — ' + detail : ''}`;
    start(async () => {
      try {
        const r = await markProxyFaultyAction(proxyId, reason, autoReplace);
        toast('Proxy marked faulty', r.replacement ? `Replaced with ${r.replacement}` : 'No replacement candidate', r.replacement ? 'success' : 'warning');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title={`Mark proxy faulty · ${proxyId}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn danger" onClick={submit} disabled={pending}>{pending ? 'Flagging…' : 'Mark faulty'}</button>
        </>
      }
    >
      <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
        Marks the proxy <strong>FAULTY · OFFLINE</strong>. Any active order using it gets tagged with the <code>replacement-pending</code> exception.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Fault category</label>
          <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Detail / note (audited)</label>
          <textarea className="form-textarea" value={detail} onChange={e => setDetail(e.target.value)} rows={2} placeholder="What went wrong?" />
        </div>
        <ToggleRow
          label="Auto-pick replacement from same pool"
          hint="If a healthy proxy is available, immediately swap the assignment over"
          value={autoReplace}
          onChange={setAutoReplace}
        />
        <ToggleRow
          label="Notify client"
          hint="Sends a notification + (in production) email/Telegram per their prefs"
          value={notifyClient}
          onChange={setNotifyClient}
        />
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, paddingRight: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>
      </div>
      <span className={`toggle-v2 ${value ? 'on' : ''}`} onClick={() => onChange(!value)} style={{ cursor: 'pointer', flexShrink: 0 }} />
    </div>
  );
}
