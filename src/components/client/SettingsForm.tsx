'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/client-actions';

export function ProfileForm({ initial }: {
  initial: { name: string; telegram: string | null; country: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [telegram, setTelegram] = useState(initial.telegram ?? '');
  const [country, setCountry] = useState(initial.country ?? 'US');
  const [pending, start] = useTransition();
  const dirty = name !== initial.name || telegram !== (initial.telegram ?? '') || country !== (initial.country ?? 'US');

  function save() {
    start(async () => {
      try {
        await CA.saveProfileAction({ name, telegram: telegram || null, country });
        toast('Profile saved', '', 'success');
        router.refresh();
      } catch (e: any) { toast('Save failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <form className="form-grid-3">
        <div><label className="form-label">Display name</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label className="form-label">Telegram</label><input className="form-input" placeholder="@handle" value={telegram} onChange={e => setTelegram(e.target.value)} /></div>
        <div><label className="form-label">Country</label>
          <select className="form-select" value={country} onChange={e => setCountry(e.target.value)}>
            {['US','UK','DE','FR','ES','IT','CA','AU','JP','BR','RU','IN','UAE','Other'].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </form>
      <div style={{ marginTop: 20 }}>
        <button className="btn primary" onClick={save} disabled={!dirty || pending}>{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </>
  );
}

export function ChangePasswordForm() {
  const toast = useToast();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    if (a.length < 8) return toast('Too short', 'Min 8 characters', 'warning');
    if (a !== b) return toast('Passwords don\'t match', '', 'warning');
    start(async () => {
      try {
        await CA.changePasswordAction(a);
        toast('Password updated', '', 'success');
        setA(''); setB('');
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <div className="form-grid-2">
        <div><label className="form-label">New password</label><input className="form-input" type="password" value={a} onChange={e => setA(e.target.value)} /></div>
        <div><label className="form-label">Confirm</label><input className="form-input" type="password" value={b} onChange={e => setB(e.target.value)} /></div>
      </div>
      <button className="btn primary" onClick={submit} disabled={pending || !a || !b} style={{ marginTop: 16 }}>{pending ? 'Updating…' : 'Update password'}</button>
    </>
  );
}

export function NotifPrefsForm({ initial }: {
  initial: { emailRenewal: boolean; emailIncidents: boolean; emailMarketing: boolean; telegramAll: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();

  function setPref<K extends keyof typeof prefs>(k: K, v: boolean) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    start(async () => {
      try {
        await CA.saveNotifPrefsAction({ [k]: v });
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'danger');
        setPrefs(prefs); // revert
      }
    });
  }

  return (
    <>
      <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Email notifications</h3>
      <Row label="Renewal reminders" value={prefs.emailRenewal} onChange={v => setPref('emailRenewal', v)} disabled={pending} />
      <Row label="Service incidents" value={prefs.emailIncidents} onChange={v => setPref('emailIncidents', v)} disabled={pending} />
      <Row label="Product updates" value={prefs.emailMarketing} onChange={v => setPref('emailMarketing', v)} disabled={pending} />
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '24px 0' }} />
      <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Telegram notifications</h3>
      <Row label="All notifications" value={prefs.telegramAll} onChange={v => setPref('telegramAll', v)} disabled={pending} />
    </>
  );
}

function Row({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }} onClick={() => !disabled && onChange(!value)} />
    </div>
  );
}
