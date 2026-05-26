'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { HelpTip } from '@/components/ui/HelpTip';
import { setSystemFlagAction } from '@/lib/settings-actions';

export function SystemFlagsForm({ initial }: {
  initial: {
    systemAutoProvisionOnPayment: boolean;
    autoReplaceOnFaulty: boolean;
    autoReleaseAfterGrace: boolean;
    require2FAForRefund: boolean;
    requireNoteOnSuspend: boolean;
    freezeNewOrders: boolean;
    flags: { maxConcurrentOrdersPerClient: number; maxProxyReplacementsPerOrder: number; supportRefundCapUSD: number; discountCapWithoutSuperApprovalPercent: number };
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  function flip(key: keyof typeof state, hint?: string) {
    const next = !state[key];
    setState({ ...state, [key]: next } as any);
    start(async () => {
      try {
        await setSystemFlagAction(key, next);
        toast(`${key} ${next ? 'enabled' : 'disabled'}`, hint ?? '', next ? 'success' : 'warning');
        router.refresh();
      } catch (e: any) {
        toast('Save failed', e.message, 'danger');
        setState(state);
      }
    });
  }

  function saveLimit(key: keyof typeof state.flags, n: number) {
    setState({ ...state, flags: { ...state.flags, [key]: n } });
    start(async () => {
      try {
        const existingFlags = { ...state.flags, [key]: n };
        await setSystemFlagAction('flags', existingFlags);
        toast('Limit saved', `${key} = ${n}`, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'danger'); }
    });
  }

  return (
    <>
      <Section label="Operational toggles">
        <Toggle label="Auto-provision proxies on payment confirm" hint="When ON, payment confirm immediately assigns proxies from the pool." value={state.systemAutoProvisionOnPayment} onChange={() => flip('systemAutoProvisionOnPayment')} pending={pending} />
        <Toggle label="Auto-replace on faulty proxy" hint="Health probe → auto-pick a replacement from the same pool." value={state.autoReplaceOnFaulty} onChange={() => flip('autoReplaceOnFaulty')} pending={pending} />
        <Toggle label="Auto-release proxies after grace" hint="Expired orders past grace window cycle proxies back into the pool." value={state.autoReleaseAfterGrace} onChange={() => flip('autoReleaseAfterGrace')} pending={pending} />
        <Toggle label="Require 2FA for refund" value={state.require2FAForRefund} onChange={() => flip('require2FAForRefund')} pending={pending} />
        <Toggle label="Require note on suspend" value={state.requireNoteOnSuspend} onChange={() => flip('requireNoteOnSuspend')} pending={pending} />
      </Section>
      <Section label="Emergency">
        <Toggle danger label="Freeze new orders" hint="Client portal will reject all new orders. Existing active orders are NOT affected. Auto-renewals continue normally." value={state.freezeNewOrders} onChange={() => flip('freezeNewOrders', 'Client portal will reject new orders')} pending={pending} />
      </Section>
      <Section label="Limits">
        <NumberRow label="Max concurrent orders per client" min={1} max={999} value={state.flags.maxConcurrentOrdersPerClient} onSave={n => saveLimit('maxConcurrentOrdersPerClient', n)} pending={pending} />
        <NumberRow label="Max proxy replacements per order" min={1} max={10} value={state.flags.maxProxyReplacementsPerOrder} onSave={n => saveLimit('maxProxyReplacementsPerOrder', n)} pending={pending} />
        <NumberRow label="Support refund cap (USD)" min={0} max={99999} value={state.flags.supportRefundCapUSD} onSave={n => saveLimit('supportRefundCapUSD', n)} pending={pending} />
        <NumberRow label="Discount cap without Super approval (%)" min={0} max={100} value={state.flags.discountCapWithoutSuperApprovalPercent} onSave={n => saveLimit('discountCapWithoutSuperApprovalPercent', n)} pending={pending} />
      </Section>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ label, hint, value, onChange, pending, danger }: { label: string; hint?: string; value: boolean; onChange: () => void; pending: boolean; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, paddingRight: 16 }}>
        <div style={{ fontSize: 13, color: danger && value ? 'var(--danger)' : 'var(--text)', fontWeight: danger ? 600 : 400 }}>
          {label}{hint && <HelpTip>{hint}</HelpTip>}
        </div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{hint.slice(0, 80)}{hint.length > 80 ? '…' : ''}</div>}
      </div>
      <span className={`toggle ${value ? 'on' : ''} ${danger && value ? 'danger' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.6 : 1 }} onClick={onChange} />
    </div>
  );
}

function NumberRow({ label, min, max, value, onSave, pending }: { label: string; min: number; max: number; value: number; onSave: (n: number) => void; pending: boolean }) {
  const [local, setLocal] = useState(String(value));
  const dirty = parseInt(local, 10) !== value;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input className="form-input mono" type="number" min={min} max={max} value={local} onChange={e => setLocal(e.target.value)} style={{ width: 90, textAlign: 'right' }} />
        {dirty && <button className="btn sm primary" disabled={pending} onClick={() => onSave(parseInt(local, 10))}>Save</button>}
      </div>
    </div>
  );
}
