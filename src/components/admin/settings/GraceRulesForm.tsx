'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { saveGraceRulesAction } from '@/lib/settings-actions';

type Grace = {
  defaultGraceHours: number;
  preRenewalReminderHours: number;
  secondReminderHours: number;
  thirdReminderHours: number;
  VIPGraceHours: number;
  ProGraceHours: number;
  StandardGraceHours: number;
  autoRenew24hBeforeExpiry: boolean;
  keepProxyDuringGrace: boolean;
  autoSuspendAfter3Fails: boolean;
};

export function GraceRulesForm({ initial }: { initial: Grace }) {
  const router = useRouter();
  const toast = useToast();
  const [g, setG] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(g) !== JSON.stringify(initial);

  function save() {
    start(async () => {
      try {
        await saveGraceRulesAction(g);
        toast('Grace rules saved', '', 'success');
        router.refresh();
      } catch (e: any) { toast('Validation failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 18 }}>
        <Num label="Default grace period (hours)" value={g.defaultGraceHours} onChange={v => setG({ ...g, defaultGraceHours: v })} max={720} />
        <Num label="Pre-renewal reminder (hours)" value={g.preRenewalReminderHours} onChange={v => setG({ ...g, preRenewalReminderHours: v })} max={720} />
        <Num label="Second reminder (hours)" value={g.secondReminderHours} onChange={v => setG({ ...g, secondReminderHours: v })} max={168} hint="Must be < pre-renewal" />
        <Num label="Third reminder (hours)" value={g.thirdReminderHours} onChange={v => setG({ ...g, thirdReminderHours: v })} max={168} hint="Must be < second reminder" />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Per-tier grace</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
        <Num label="VIP grace (hours)" value={g.VIPGraceHours} onChange={v => setG({ ...g, VIPGraceHours: v })} max={720} />
        <Num label="Pro grace (hours)" value={g.ProGraceHours} onChange={v => setG({ ...g, ProGraceHours: v })} max={720} />
        <Num label="Standard grace (hours)" value={g.StandardGraceHours} onChange={v => setG({ ...g, StandardGraceHours: v })} max={720} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Auto-behavior</div>
      <Toggle label="Auto-renew 24h before expiry (if card on file)" value={g.autoRenew24hBeforeExpiry} onChange={v => setG({ ...g, autoRenew24hBeforeExpiry: v })} />
      <Toggle label="Keep proxy reachable during grace period" value={g.keepProxyDuringGrace} onChange={v => setG({ ...g, keepProxyDuringGrace: v })} />
      <Toggle label="Auto-suspend after 3 failed auto-renews" value={g.autoSuspendAfter3Fails} onChange={v => setG({ ...g, autoSuspendAfter3Fails: v })} />
      <div style={{ marginTop: 20 }}>
        <button className="btn primary" disabled={!dirty || pending} onClick={save}>{pending ? 'Saving…' : 'Save grace rules'}</button>
      </div>
    </>
  );
}

function Num({ label, value, onChange, max, hint }: { label: string; value: number; onChange: (n: number) => void; max: number; hint?: string }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-input mono" type="number" min={0} max={max} value={value} onChange={e => onChange(parseInt(e.target.value || '0', 10))} />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => onChange(!value)} />
    </div>
  );
}
