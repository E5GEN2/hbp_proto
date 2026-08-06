'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { updateProxyCredentialsAction } from '@/lib/ui-actions/admin-actions';

export type EditProxyInitial = {
  password: string;
  rotationUrl: string | null;
};

// Owner ask 2026-08-06: edit the two fields that change when credentials are
// rotated upstream on the modem farm — password and the rotation URL. Same
// validation as ProxyRegisterForm (colon-free password, http(s) URL).
export function EditProxyModal({
  open, onClose, proxyId, initial,
}: {
  open: boolean; onClose: () => void; proxyId: string; initial: EditProxyInitial;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ password: initial.password, rotationUrl: initial.rotationUrl ?? '' });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm({ password: initial.password, rotationUrl: initial.rotationUrl ?? '' }); setErr(null); }
  }, [open, initial]);

  function submit() {
    setErr(null);
    const pw = form.password.trim();
    const url = form.rotationUrl.trim();
    if (!pw) { setErr('Password is required.'); return; }
    if (pw !== initial.password && pw.includes(':')) { setErr("Password must not contain ':'."); return; }
    if (url && !/^https?:\/\//i.test(url)) { setErr('Rotation URL must start with http:// or https://.'); return; }
    start(async () => {
      try {
        await updateProxyCredentialsAction(proxyId, { password: pw, rotationUrl: url || null });
        toast('Proxy saved', proxyId, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Edit proxy" size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        {proxyId} — host, port and username stay as registered. If the proxy is serving an order,
        the client is notified to re-copy their credentials.
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label className="form-label">Password<span style={{ color: 'var(--danger)' }}> *</span></label>
          <input
            className="form-input mono" maxLength={128}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label">Rotation URL</label>
          <input
            className="form-input mono" maxLength={512} placeholder="https://… (empty = none)"
            value={form.rotationUrl}
            onChange={e => setForm({ ...form, rotationUrl: e.target.value })}
          />
        </div>
      </div>
      {err && <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
