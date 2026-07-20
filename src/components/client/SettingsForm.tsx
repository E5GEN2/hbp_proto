'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import * as CA from '@/lib/ui-actions/client-actions';
import { FormSelect } from '@/components/ui/FormSelect';

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
      <div className="settings-form-grid cols-3">
        <div className="settings-field">
          <label className="settings-field-label">Display name</label>
          <input className="form-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        </div>
        <div className="settings-field">
          <label className="settings-field-label">Telegram</label>
          <div className="form-input-prefix">
            <input className="form-input" placeholder="username" maxLength={32} value={telegram} onChange={e => setTelegram(e.target.value)} />
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">Country</label>
          <FormSelect
            value={country}
            onChange={setCountry}
            options={['US','UK','DE','FR','ES','IT','CA','AU','JP','BR','RU','IN','UAE','Other'].map(c => ({ value: c }))}
          />
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" onClick={save} disabled={!dirty || pending}>{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </>
  );
}

export function ChangePasswordForm() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    if (!cur) return toast('Current password required', '', 'warning');
    if (a.length < 8) return toast('Too short', 'Min 8 characters', 'warning');
    if (a !== b) return toast('Passwords don\'t match', '', 'warning');
    start(async () => {
      try {
        await CA.changePasswordAction(cur, a);
        toast('Password updated', '', 'success');
        setCur(''); setA(''); setB('');
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <div className="settings-form-grid">
        <div className="settings-field full">
          <label className="settings-field-label">Current password</label>
          <input className="form-input" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} />
        </div>
        <div className="settings-field">
          <label className="settings-field-label">New password</label>
          <input className="form-input" type="password" autoComplete="new-password" value={a} onChange={e => setA(e.target.value)} />
        </div>
        <div className="settings-field">
          <label className="settings-field-label">Confirm new password</label>
          <input className="form-input" type="password" autoComplete="new-password" value={b} onChange={e => setB(e.target.value)} />
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" onClick={submit} disabled={pending || !cur || !a || !b}>{pending ? 'Updating…' : 'Update password'}</button>
      </div>
    </>
  );
}

const EMAIL_CHANNELS: { key: 'emailRenewal' | 'emailIncidents' | 'emailMarketing'; title: string; caption: string }[] = [
  { key: 'emailRenewal',   title: 'Renewal reminders', caption: 'Sent before an order expires (per plan\u2019s reminder window).' },
  { key: 'emailIncidents', title: 'Service incidents', caption: 'Outages, degraded health, planned maintenance.' },
  { key: 'emailMarketing', title: 'Product updates',   caption: 'New features, releases, occasional offers. No spam.' },
];

export function NotifPrefsForm({ initial, email }: {
  initial: { emailRenewal: boolean; emailIncidents: boolean; emailMarketing: boolean; telegramAll: boolean };
  email: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();

  function setPref<K extends keyof typeof prefs>(k: K, v: boolean) {
    const prev = prefs;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    start(async () => {
      try {
        await CA.saveNotifPrefsAction({ [k]: v });
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'danger');
        setPrefs(prev); // revert
      }
    });
  }

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Email notifications</div>
        <div className="settings-section-desc">
          Choose which emails we send to <strong>{email}</strong>. Critical security alerts
          (password changes) and payment receipts can&rsquo;t be disabled.
        </div>
        <div style={{ margin: '0 -20px' }}>
          {EMAIL_CHANNELS.map(c => (
            <ToggleRow key={c.key} title={c.title} caption={c.caption} value={prefs[c.key]} disabled={pending} onChange={v => setPref(c.key, v)} />
          ))}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Telegram Notifications</div>
        <div style={{ margin: '0 -20px' }}>
          <ToggleRow title="All notifications" caption="Mirror of all email notifications via Telegram." value={prefs.telegramAll} disabled={pending} onChange={v => setPref('telegramAll', v)} />
        </div>
      </div>
    </>
  );
}

function ToggleRow({ title, caption, value, onChange, disabled }: {
  title: string; caption: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-row-body">
        <div className="toggle-row-title">{title}</div>
        <div className="toggle-row-caption">{caption}</div>
      </div>
      <span
        className={`toggle ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={value}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
        onClick={() => !disabled && onChange(!value)}
      />
    </div>
  );
}
