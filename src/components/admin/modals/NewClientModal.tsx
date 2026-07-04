'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { createClientAction } from '@/lib/ui-actions/admin-actions';

export function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: '', email: '', telegram: '', country: 'US',
    tier: 'STANDARD' as 'STANDARD' | 'PRO' | 'VIP',
    risk: 'NONE' as 'NONE' | 'REVIEW' | 'FLAG',
    note: '', acquisition: '',
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm({ name: '', email: '', telegram: '', country: 'US', tier: 'STANDARD', risk: 'NONE', note: '', acquisition: '' });
      setErr(null);
    }
  }, [open]);

  function submit() {
    setErr(null);
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required');
    start(async () => {
      try {
        const r = await createClientAction({
          name: form.name, email: form.email,
          telegram: form.telegram || null,
          country: form.country || null,
          tier: form.tier, risk: form.risk,
          riskNote: form.risk !== 'NONE' ? form.note : null,
          acquisition: form.acquisition || null,
        });
        toast('Client created', r.clientId + (r.generatedPassword ? ' · pw: ' + r.generatedPassword : ''), 'success');
        onClose();
        if (r.clientId) router.push(`/admin/clients/${r.clientId}`);
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title="New client" size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Creating…' : 'Create client'}</button>
        </>
      }
    >
      <SectionTitle>Identity</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Full name" required><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email" required><input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Telegram"><input className="form-input" placeholder="@handle" value={form.telegram} onChange={e => setForm({ ...form, telegram: e.target.value })} /></Field>
        <Field label="Country">
          <select className="form-select" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}>
            {['US','UK','DE','FR','ES','IT','CA','AU','JP','BR','RU','IN','UAE','Other'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <SectionTitle>Classification</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Tier">
          <select className="form-select" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value as any })}>
            <option value="STANDARD">Standard</option><option value="PRO">Pro</option><option value="VIP">VIP</option>
          </select>
        </Field>
        <Field label="Risk">
          <select className="form-select" value={form.risk} onChange={e => setForm({ ...form, risk: e.target.value as any })}>
            <option value="NONE">None</option><option value="REVIEW">Under review</option><option value="FLAG">Flagged</option>
          </select>
        </Field>
        {form.risk !== 'NONE' && (
          <Field label="Risk note" required span={2}>
            <textarea className="form-textarea" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2} />
          </Field>
        )}
        <Field label="Acquisition (optional)" span={2}>
          <input className="form-input" placeholder="organic / referral-CLI-#### / campaign-X" value={form.acquisition} onChange={e => setForm({ ...form, acquisition: e.target.value })} />
        </Field>
      </div>
      {err && <div style={{ padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)' }}>
        A temporary password will be generated and shown in the toast. The client can reset it via /forgot.
      </div>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>{children}</div>;
}
function Field({ label, required, span, children }: { label: string; required?: boolean; span?: number; children: React.ReactNode }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="form-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
      {children}
    </div>
  );
}
