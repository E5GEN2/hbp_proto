'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as A from '@/lib/admin-actions';

function useAction<T extends (...args: any[]) => Promise<any>>(fn: T) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const call = (...args: Parameters<T>) => {
    setErr(null);
    start(async () => {
      try {
        await fn(...args);
        router.refresh();
      } catch (e: any) { setErr(e.message ?? 'Failed'); }
    });
  };
  return { call, pending, err, setErr };
}

function Prompt({ open, onClose, onConfirm, title, fields, confirmLabel = 'Confirm', tone = 'primary', busy }:
  { open: boolean; onClose: () => void; onConfirm: (vals: Record<string, string>) => void; title: string; fields: { name: string; label: string; type?: string; placeholder?: string; default?: string }[]; confirmLabel?: string; tone?: 'primary' | 'danger'; busy?: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.name, f.default ?? ''])));
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">{title}</div><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields.map(f => (
            <div key={f.name}>
              <label className="form-label">{f.label}</label>
              {f.type === 'textarea'
                ? <textarea className="form-textarea" placeholder={f.placeholder} value={vals[f.name]} onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))} />
                : <input className="form-input" type={f.type ?? 'text'} placeholder={f.placeholder} value={vals[f.name]} onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))} />}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${tone}`} disabled={busy} onClick={() => onConfirm(vals)}>{busy ? '…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── PAYMENT BUTTONS ──────────────────────────────────────────────── */

export function MarkPaidButton({ paymentId, label = 'Mark paid' }: { paymentId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.markPaidAction);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)} disabled={pending}>{label}</button>
      <Prompt
        open={open}
        onClose={() => setOpen(false)}
        title="Mark payment confirmed"
        fields={[
          { name: 'source', label: 'Confirmation source', placeholder: 'bank-transfer / on-chain / cash / other', default: 'bank-transfer' },
          { name: 'ref', label: 'Reference / txn ID (optional)' },
        ]}
        confirmLabel="Confirm payment"
        busy={pending}
        onConfirm={async (v) => {
          await call(paymentId, v.source || 'manual', v.ref || undefined);
          setOpen(false);
        }}
      />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

export function RefundButton({ paymentId, amount }: { paymentId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.refundPaymentAction);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)} disabled={pending}>Refund</button>
      <Prompt
        open={open}
        onClose={() => setOpen(false)}
        title={`Refund payment`}
        fields={[
          { name: 'amount', label: 'Refund amount (USD)', type: 'number', default: String(amount) },
          { name: 'reason', label: 'Reason', type: 'textarea', placeholder: 'Customer-not-satisfied / Service-not-delivered / Goodwill / Other' },
        ]}
        confirmLabel="Issue refund"
        tone="danger"
        busy={pending}
        onConfirm={async (v) => {
          await call(paymentId, parseFloat(v.amount), v.reason || 'no reason given');
          setOpen(false);
        }}
      />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

/* ─── ORDER BUTTONS ────────────────────────────────────────────────── */

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.cancelOrderAction);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)} disabled={pending}>Cancel order</button>
      <Prompt
        open={open}
        onClose={() => setOpen(false)}
        title={`Cancel order ${orderId}`}
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea', placeholder: 'Why cancelling? (audited)' }]}
        confirmLabel="Cancel order"
        tone="danger"
        busy={pending}
        onConfirm={async (v) => {
          await call(orderId, v.reason || 'no reason given');
          setOpen(false);
        }}
      />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

export function SuspendButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.suspendOrderAction);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={pending}>Suspend</button>
      <Prompt open={open} onClose={() => setOpen(false)} title={`Suspend ${orderId}`}
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea' }]}
        confirmLabel="Suspend" busy={pending}
        onConfirm={async (v) => { await call(orderId, v.reason || ''); setOpen(false); }} />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

export function ResumeButton({ orderId }: { orderId: string }) {
  const { call, pending, err } = useAction(A.resumeOrderAction);
  return (
    <>
      <button className="btn primary" onClick={() => call(orderId)} disabled={pending}>{pending ? '…' : 'Resume'}</button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

export function ExtendButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.extendOrderAction);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={pending}>Extend</button>
      <Prompt open={open} onClose={() => setOpen(false)} title={`Extend ${orderId}`}
        fields={[{ name: 'days', label: 'Additional days', type: 'number', default: '30' }]}
        confirmLabel="Extend" busy={pending}
        onConfirm={async (v) => { await call(orderId, parseInt(v.days, 10) || 30); setOpen(false); }} />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

export function SendCredentialsButton({ orderId }: { orderId: string }) {
  const { call, pending, err } = useAction(A.sendCredentialsAction);
  return (
    <>
      <button className="btn" onClick={() => call(orderId, 'EMAIL')} disabled={pending}>{pending ? '…' : 'Send credentials'}</button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

/* ─── PROXY BUTTONS ────────────────────────────────────────────────── */

export function MarkFaultyButton({ proxyId }: { proxyId: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.markProxyFaultyAction);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)} disabled={pending}>Mark faulty</button>
      <Prompt open={open} onClose={() => setOpen(false)} title={`Mark proxy ${proxyId} faulty`}
        fields={[
          { name: 'reason', label: 'Fault category', placeholder: 'connection-loss / high-latency / banned / other' },
          { name: 'autoReplace', label: 'Auto-replace? (yes/no)', default: 'yes' },
        ]}
        confirmLabel="Mark faulty" tone="danger" busy={pending}
        onConfirm={async (v) => {
          await call(proxyId, v.reason || 'unspecified', /^(y|yes|true|1)$/i.test(v.autoReplace));
          setOpen(false);
        }} />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

export function ReleaseProxyButton({ proxyId }: { proxyId: string }) {
  const { call, pending, err } = useAction(A.releaseProxyAction);
  return (
    <>
      <button className="btn" onClick={() => { if (confirm(`Release ${proxyId} to pool?`)) call(proxyId); }} disabled={pending}>{pending ? '…' : 'Release'}</button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

/* ─── PLAN BUTTONS ─────────────────────────────────────────────────── */

export function TogglePlanButton({ planId, active }: { planId: string; active: boolean }) {
  const { call, pending, err } = useAction(A.togglePlanActiveAction);
  return (
    <>
      <button className={`btn ${active ? '' : 'primary'}`} onClick={() => call(planId, !active)} disabled={pending}>
        {pending ? '…' : active ? 'Disable plan' : 'Enable plan'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

/* ─── CLIENT BUTTONS ───────────────────────────────────────────────── */

export function AdjustBalanceButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const { call, pending, err } = useAction(A.adjustBalanceAction);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={pending}>Adjust balance</button>
      <Prompt open={open} onClose={() => setOpen(false)} title="Adjust balance"
        fields={[
          { name: 'delta', label: 'Amount (signed, USD)', type: 'number', placeholder: '+50 or -25', default: '50' },
          { name: 'reason', label: 'Reason', placeholder: 'goodwill / promo / dispute resolution' },
          { name: 'note', label: 'Internal note (optional)', type: 'textarea' },
        ]}
        confirmLabel="Apply" busy={pending}
        onConfirm={async (v) => {
          await call(userId, parseFloat(v.delta), v.reason || 'manual adjust', v.note || undefined);
          setOpen(false);
        }} />
      {err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

export function BlockUnblockButton({ userId, blocked }: { userId: string; blocked: boolean }) {
  const [open, setOpen] = useState(false);
  const block = useAction(A.blockClientAction);
  const unblock = useAction(A.unblockClientAction);
  if (blocked) {
    return (
      <>
        <button className="btn primary" onClick={() => unblock.call(userId)} disabled={unblock.pending}>{unblock.pending ? '…' : 'Unblock client'}</button>
        {unblock.err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{unblock.err}</span>}
      </>
    );
  }
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)} disabled={block.pending}>Block client</button>
      <Prompt open={open} onClose={() => setOpen(false)} title="Block client"
        fields={[
          { name: 'reason', label: 'Reason', placeholder: 'Fraud / TOS violation / Abuse / Other' },
          { name: 'suspend', label: 'Suspend active orders? (yes/no)', default: 'yes' },
        ]}
        confirmLabel="Block" tone="danger" busy={block.pending}
        onConfirm={async (v) => {
          await block.call(userId, v.reason || 'unspecified', /^(y|yes|true|1)$/i.test(v.suspend));
          setOpen(false);
        }} />
      {block.err && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>{block.err}</span>}
    </>
  );
}
