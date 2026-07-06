'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { updateClientAction } from '@/lib/ui-actions/admin-actions';

export type EditClientInitial = {
  name: string;
  telegram: string | null;
  country: string | null;
  tier: 'STANDARD' | 'PRO' | 'VIP';
  preferredCarrier: string | null;
  preferredRegion: string | null;
  emailRenewal: boolean;
  emailIncidents: boolean;
  emailMarketing: boolean;
  telegramAll: boolean;
  preRenewalReminderHours: number;
};

export function EditClientModal({
  open, onClose, clientId, initial,
  carriers, regions,
}: {
  open: boolean; onClose: () => void; clientId: string; initial: EditClientInitial;
  carriers: string[]; regions: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setForm(initial); setErr(null); } }, [open, initial]);

  function submit() {
    setErr(null);
    start(async () => {
      try {
        await updateClientAction(clientId, {
          name: form.name,
          telegram: form.telegram,
          country: form.country,
          tier: form.tier,
          preferredCarrier: form.preferredCarrier,
          preferredRegion: form.preferredRegion,
          emailRenewal: form.emailRenewal,
          emailIncidents: form.emailIncidents,
          emailMarketing: form.emailMarketing,
          telegramAll: form.telegramAll,
          preRenewalReminderHours: Number(form.preRenewalReminderHours),
        });
        toast('Client saved', clientId, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Edit client" size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <SectionTitle>Identity</SectionTitle>
      <Grid cols={2}>
        <Field label="Display name"><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Telegram"><input className="form-input" placeholder="@handle" value={form.telegram ?? ''} onChange={e => setForm({ ...form, telegram: e.target.value || null })} /></Field>
        <Field label="Country">
          <select className="form-select" value={form.country ?? 'US'} onChange={e => setForm({ ...form, country: e.target.value })}>
            {['US','UK','DE','FR','ES','IT','CA','AU','JP','BR','RU','IN','UAE','Other'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tier">
          <select className="form-select" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value as any })}>
            <option value="STANDARD">Standard</option><option value="PRO">Pro</option><option value="VIP">VIP</option>
          </select>
        </Field>
      </Grid>

      <SectionTitle>Preferences</SectionTitle>
      <Grid cols={2}>
        <Field label="Preferred carrier">
          <select className="form-select" value={form.preferredCarrier ?? ''} onChange={e => setForm({ ...form, preferredCarrier: e.target.value || null })}>
            <option value="">— None —</option>
            {carriers.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Preferred region">
          <select className="form-select" value={form.preferredRegion ?? ''} onChange={e => setForm({ ...form, preferredRegion: e.target.value || null })}>
            <option value="">— None —</option>
            {regions.map(r => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Pre-renewal reminder (hours)" tip="Hours before expiry to send the renewal reminder. Default inherited from the global Settings → Notifications value.">
          <input className="form-input" type="number" min={0} max={720} value={form.preRenewalReminderHours} onChange={e => setForm({ ...form, preRenewalReminderHours: parseInt(e.target.value || '0', 10) })} />
        </Field>
        <div />
      </Grid>

      <SectionTitle>Notification channels</SectionTitle>
      <Grid cols={2}>
        <Toggle label="Email — renewal reminders"   value={form.emailRenewal}    onChange={v => setForm({ ...form, emailRenewal: v })} />
        <Toggle label="Email — service incidents"   value={form.emailIncidents}  onChange={v => setForm({ ...form, emailIncidents: v })} />
        <Toggle label="Email — product updates"     value={form.emailMarketing}  onChange={v => setForm({ ...form, emailMarketing: v })} />
        <Toggle label="Telegram — all notifications" value={form.telegramAll}    onChange={v => setForm({ ...form, telegramAll: v })} disabled={!form.telegram} hint={!form.telegram ? 'Auto-disabled if Telegram handle is empty. Re-enable it after adding a Telegram handle.' : undefined} />
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
function Field({ label, required, tip, children }: { label: string; required?: boolean; tip?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}{tip && <span className="help-tip" data-tip={tip}>i</span>}</label>
      {children}
    </div>
  );
}
function Toggle({ label, value, onChange, disabled, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', opacity: disabled ? 0.5 : 1 }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <span className={`toggle-v2 ${value ? 'on' : ''}`} onClick={() => !disabled && onChange(!value)} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }} />
    </div>
  );
}
