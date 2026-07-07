'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { registerProxyAction } from '@/lib/ui-actions/admin-actions';

export function RegisterProxyModal({
  open, onClose, carriers, regions, pools,
}: { open: boolean; onClose: () => void; carriers: string[]; regions: string[]; pools: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    modem: '', imei: '', carrier: carriers[0] ?? 'Verizon', region: regions[0] ?? 'US East', pool: pools[0] ?? '',
    city: '', ip: '', port: 12000, username: '', password: '',
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setErr(null);
  }, [open]);

  function gen(field: 'username' | 'password' | 'modem' | 'ip') {
    const r = Math.random().toString(36).slice(2, 12);
    if (field === 'username') setForm(f => ({ ...f, username: `proxy_${r.slice(0, 6)}` }));
    if (field === 'password') setForm(f => ({ ...f, password: r }));
    if (field === 'modem') setForm(f => ({ ...f, modem: `MDM-${String(Math.floor(Math.random() * 90 + 10))}` }));
    if (field === 'ip') setForm(f => ({ ...f, ip: `45.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` }));
  }

  function submit() {
    setErr(null);
    start(async () => {
      try {
        const r = await registerProxyAction({
          modem: form.modem, imei: form.imei || null,
          carrier: form.carrier, region: form.region, pool: form.pool,
          city: form.city || null, ip: form.ip, port: form.port,
          username: form.username, password: form.password,
        });
        toast('Proxy registered', r.proxyId, 'success');
        onClose();
        if (r.proxyId) router.push(`/admin/proxies/${r.proxyId}`);
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Register proxy" size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Registering…' : 'Register'}</button>
        </>
      }
    >
      <SectionTitle>Hardware</SectionTitle>
      <Grid cols={2}>
        <Field label="Modem ID" required>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input mono" value={form.modem} onChange={e => setForm({ ...form, modem: e.target.value })} placeholder="MDM-12" />
            <button type="button" className="btn sm" onClick={() => gen('modem')}>↻</button>
          </div>
        </Field>
        <Field label="IMEI"><input className="form-input mono" value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} /></Field>
      </Grid>

      <SectionTitle>Network</SectionTitle>
      <Grid cols={3}>
        <Field label="Carrier" required>
          <FormSelect value={form.carrier} onChange={v => setForm({ ...form, carrier: v })} options={carriers.map(c => ({ value: c }))} />
        </Field>
        <Field label="Region" required>
          <FormSelect value={form.region} onChange={v => setForm({ ...form, region: v })} options={regions.map(r => ({ value: r }))} />
        </Field>
        <Field label="Pool" required>
          <FormSelect value={form.pool} onChange={v => setForm({ ...form, pool: v })} options={pools.map(p => ({ value: p }))} />
        </Field>
        <Field label="City"><input className="form-input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="New York" /></Field>
      </Grid>

      <SectionTitle>Credentials</SectionTitle>
      <Grid cols={2}>
        <Field label="IP address" required>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input mono" value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} placeholder="45.X.Y.Z" />
            <button type="button" className="btn sm" onClick={() => gen('ip')}>↻</button>
          </div>
        </Field>
        <Field label="Port" required>
          <input className="form-input mono" type="number" min={1} max={65535} value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value || '0', 10) })} />
        </Field>
        <Field label="Username" required>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input mono" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
            <button type="button" className="btn sm" onClick={() => gen('username')}>↻</button>
          </div>
        </Field>
        <Field label="Password" required>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input mono" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <button type="button" className="btn sm" onClick={() => gen('password')}>↻</button>
          </div>
        </Field>
      </Grid>

      {err && <div style={{ padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10, marginTop: 8 }}>{children}</div>;
}
function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, marginBottom: 18 }}>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
      {children}
    </div>
  );
}
