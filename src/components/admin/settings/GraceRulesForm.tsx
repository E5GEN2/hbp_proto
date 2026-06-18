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
      } catch (e: any) { toast('Validation failed', e.message, 'warning'); }
    });
  }

  type NumKey = 'defaultGraceHours' | 'preRenewalReminderHours' | 'secondReminderHours' | 'thirdReminderHours' | 'VIPGraceHours' | 'ProGraceHours' | 'StandardGraceHours';
  const num = (k: NumKey) => (
    <input className="form-input" type="number" min={0} max={720} step={1}
      value={g[k]} onChange={e => setG({ ...g, [k]: parseInt(e.target.value || '0', 10) })} />
  );

  return (
    <div className="form-grid cols-2">
      <div className="form-field full"><div className="subsection-title">Global defaults</div></div>
      <div className="form-field"><div className="form-label">Default grace period (hours) <span className="req">*</span></div>{num('defaultGraceHours')}</div>
      <div className="form-field"><div className="form-label">Pre-renewal reminder (hours before expiry) <span className="req">*</span></div>{num('preRenewalReminderHours')}</div>
      <div className="form-field"><div className="form-label">Second reminder</div>{num('secondReminderHours')}</div>
      <div className="form-field"><div className="form-label">Third reminder (at expiry)</div>{num('thirdReminderHours')}</div>

      <div className="form-field full"><label className="hstack"><span className={`toggle-v2 ${g.autoRenew24hBeforeExpiry ? 'on' : ''}`} onClick={() => setG({ ...g, autoRenew24hBeforeExpiry: !g.autoRenew24hBeforeExpiry })} /> Auto-renew: charge 24h before expiry if card on file</label></div>
      <div className="form-field full"><label className="hstack"><span className={`toggle-v2 ${g.keepProxyDuringGrace ? 'on' : ''}`} onClick={() => setG({ ...g, keepProxyDuringGrace: !g.keepProxyDuringGrace })} /> Keep proxy assigned during grace (client can still use)</label></div>
      <div className="form-field full"><label className="hstack"><span className={`toggle-v2 ${g.autoSuspendAfter3Fails ? 'on' : ''}`} onClick={() => setG({ ...g, autoSuspendAfter3Fails: !g.autoSuspendAfter3Fails })} /> Auto-suspend after 3 failed auto-renew attempts</label></div>

      <div className="form-field full" style={{ marginTop: 10 }}><div className="subsection-title">Per-tier overrides</div></div>
      <div className="form-field"><div className="form-label">VIP grace (hours)</div>{num('VIPGraceHours')}</div>
      <div className="form-field"><div className="form-label">Pro grace (hours)</div>{num('ProGraceHours')}</div>
      <div className="form-field"><div className="form-label">Standard grace (hours) <span className="req">*</span></div>{num('StandardGraceHours')}</div>

      <div className="form-actions-row">
        <button className="btn" disabled={!dirty || pending} onClick={() => setG(initial)}>Reset</button>
        <button className="btn primary" disabled={!dirty || pending} onClick={save}>{pending ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}
