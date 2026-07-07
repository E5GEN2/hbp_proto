'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { HelpTip } from '@/components/ui/HelpTip';
import { setSystemFlagAction } from '@/lib/ui-actions/settings-actions';

type Flags = { maxConcurrentOrdersPerClient: number; maxProxyReplacementsPerOrder: number; supportRefundCapUSD: number; discountCapWithoutSuperApprovalPercent: number };

export function SystemFlagsForm({ initial }: {
  initial: {
    systemAutoProvisionOnPayment: boolean;
    autoReplaceOnFaulty: boolean;
    autoReleaseAfterGrace: boolean;
    require2FAForRefund: boolean;
    requireNoteOnSuspend: boolean;
    freezeNewOrders: boolean;
    flags: Flags;
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
        toast('Save failed', e.message, 'warning');
        setState(state);
      }
    });
  }

  function saveLimit(key: keyof Flags, n: number) {
    setState({ ...state, flags: { ...state.flags, [key]: n } });
    start(async () => {
      try {
        await setSystemFlagAction('flags', { ...state.flags, [key]: n });
        toast('Limit saved', `${key} = ${n}`, 'success');
        router.refresh();
      } catch (e: any) { toast('Failed', e.message, 'warning'); }
    });
  }

  return (
    <div className="form-grid cols-2">
      <div className="form-field full"><div className="subsection-title">Operational flags</div></div>
      <FlagToggle label="Auto-provision proxies on order paid" notWired tip="Persisted but not consulted yet — provisioning follows each plan's own Auto-provision switch (snapshotted onto the order at purchase)." on={state.systemAutoProvisionOnPayment} onClick={() => flip('systemAutoProvisionOnPayment')} pending={pending} />
      <FlagToggle label="Auto-replace on faulty-proxy detection" notWired tip="Persisted but not consulted yet — the Mark-faulty modal has its own per-action auto-replace checkbox." on={state.autoReplaceOnFaulty} onClick={() => flip('autoReplaceOnFaulty')} pending={pending} />
      <FlagToggle label="Auto-release proxies after grace window" tip="Once grace ends, return the proxy to the pool. Disable only for custom contracts." on={state.autoReleaseAfterGrace} onClick={() => flip('autoReleaseAfterGrace')} pending={pending} />
      <FlagToggle label="Require 2FA for every refund action" notWired on={state.require2FAForRefund} onClick={() => flip('require2FAForRefund')} pending={pending} />
      <FlagToggle label="Require internal note for suspend / block" notWired on={state.requireNoteOnSuspend} onClick={() => flip('requireNoteOnSuspend')} pending={pending} />
      <div className="form-field full">
        <label className="hstack">
          <span className={`toggle-v2 danger ${state.freezeNewOrders ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={() => flip('freezeNewOrders', 'Client portal will reject new orders')} />
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Freeze new orders (emergency)</span>
          <HelpTip>Blocks the client portal from creating any new orders. Existing orders unaffected. Use during incidents only.</HelpTip>
        </label>
      </div>

      <div className="form-field full" style={{ marginTop: 10 }}><div className="subsection-title">Limits</div></div>
      <LimitField label="Max concurrent orders per client" notWired min={1} max={999} value={state.flags.maxConcurrentOrdersPerClient} onSave={n => saveLimit('maxConcurrentOrdersPerClient', n)} pending={pending} />
      <LimitField label="Max proxy replacements per order" notWired min={1} max={10} value={state.flags.maxProxyReplacementsPerOrder} onSave={n => saveLimit('maxProxyReplacementsPerOrder', n)} pending={pending} />
      <LimitField label="Support refund cap (USD)" notWired min={0} max={99999} value={state.flags.supportRefundCapUSD} onSave={n => saveLimit('supportRefundCapUSD', n)} pending={pending} />
      <LimitField label="Discount cap without Super approval (%)" notWired min={0} max={100} value={state.flags.discountCapWithoutSuperApprovalPercent} onSave={n => saveLimit('discountCapWithoutSuperApprovalPercent', n)} pending={pending} />

      <div className="form-field full">
        <span className="muted" style={{ fontSize: 11.5 }}>Toggles persist immediately. Limit changes save when you click Save next to the field.</span>
      </div>
    </div>
  );
}

// `notWired` renders the honest B-4 chip: the value persists but nothing
// consults it yet — same idiom as GraceRules / Provisioning rules.
function FlagToggle({ label, tip, on, onClick, pending, notWired }: { label: string; tip?: string; on: boolean; onClick: () => void; pending: boolean; notWired?: boolean }) {
  return (
    <div className="form-field">
      <label className="hstack">
        <span className={`toggle-v2 ${on ? 'on' : ''}`} style={{ cursor: pending ? 'wait' : 'pointer' }} onClick={onClick} />
        <span>{label}</span>
        {notWired && <span className="chip muted" style={{ marginLeft: 4 }}>Not wired — Phase 2</span>}
        {tip && <HelpTip>{tip}</HelpTip>}
      </label>
    </div>
  );
}

function LimitField({ label, min, max, value, onSave, pending, notWired }: { label: string; min: number; max: number; value: number; onSave: (n: number) => void; pending: boolean; notWired?: boolean }) {
  const [local, setLocal] = useState(String(value));
  const dirty = parseInt(local, 10) !== value && local.trim() !== '';
  return (
    <div className="form-field">
      <div className="form-label">{label} <span className="req">*</span>{notWired && <span className="chip muted" style={{ marginLeft: 6, textTransform: 'none', letterSpacing: 'normal' }}>Not wired — Phase 2</span>}</div>
      <div className="hstack">
        <input className="form-input" type="number" min={min} max={max} value={local} onChange={e => setLocal(e.target.value)} style={{ flex: 1 }} />
        {dirty && <button className="btn sm primary" disabled={pending} onClick={() => onSave(parseInt(local, 10))}>Save</button>}
      </div>
    </div>
  );
}
