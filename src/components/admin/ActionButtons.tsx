'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as A from '@/lib/ui-actions/admin-actions';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { MarkPaidModal } from './modals/MarkPaidModal';
import { RefundModal } from './modals/RefundModal';
import { MarkFaultyModal } from './modals/MarkFaultyModal';
import { RiskModal } from './modals/RiskModal';
import { BlockClientModal } from './modals/BlockClientModal';
import { CancelOrderModal } from './modals/CancelOrderModal';
import { SuspendOrderModal } from './modals/SuspendOrderModal';
import { ExtendOrderModal } from './modals/ExtendOrderModal';

function useAction<T extends (...args: any[]) => Promise<any>>(fn: T) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const call = (...args: Parameters<T>) =>
    new Promise<Awaited<ReturnType<T>>>((resolve, reject) => {
      setErr(null);
      start(async () => {
        try {
          const r = await fn(...args);
          router.refresh();
          resolve(r as any);
        } catch (e: any) {
          setErr(e?.message ?? 'Failed');
          reject(e);
        }
      });
    });
  return { call, pending, err, setErr };
}

/* ─── PAYMENT BUTTONS ──────────────────────────────────────────────── */

export function MarkPaidButton({ paymentId, label = 'Mark paid', paymentLabel }: { paymentId: string; label?: string; paymentLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>{label}</button>
      <MarkPaidModal open={open} onClose={() => setOpen(false)} paymentId={paymentId} paymentLabel={paymentLabel} />
    </>
  );
}

export function RefundButton({ paymentId, amount }: { paymentId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Refund</button>
      <RefundModal open={open} onClose={() => setOpen(false)} paymentId={paymentId} maxAmount={amount} />
    </>
  );
}

/* ─── ORDER BUTTONS ────────────────────────────────────────────────── */

export function CancelOrderButton({ orderId, wasPaid = false, assignmentCount = 0 }: { orderId: string; wasPaid?: boolean; assignmentCount?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Cancel order</button>
      <CancelOrderModal open={open} onClose={() => setOpen(false)} orderId={orderId} wasPaid={wasPaid} assignmentCount={assignmentCount} />
    </>
  );
}

export function SuspendButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Suspend</button>
      <SuspendOrderModal open={open} onClose={() => setOpen(false)} orderId={orderId} />
    </>
  );
}

export function ResumeButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { call, pending, err } = useAction(A.resumeOrderAction);
  return (
    <>
      <button className="btn" onClick={async () => { try { await call(orderId); toast('Order resumed', orderId, 'success'); } catch {} }} disabled={pending}>
        {pending ? '…' : 'Resume'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

export function ExtendButton({
  orderId, currentQty = 1, currentDuration = 30, currentExpiry,
}: { orderId: string; currentQty?: number; currentDuration?: number; currentExpiry?: Date | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Extend</button>
      <ExtendOrderModal
        open={open} onClose={() => setOpen(false)}
        orderId={orderId}
        currentQty={currentQty}
        currentDuration={currentDuration}
        currentExpiry={currentExpiry ?? null}
      />
    </>
  );
}

export function SendCredentialsButton({ orderId }: { orderId: string }) {
  const toast = useToast();
  const { call, pending, err } = useAction(A.sendCredentialsAction);
  return (
    <>
      <button className="btn primary" onClick={async () => { try { await call(orderId, 'EMAIL'); toast('Credentials sent', orderId + ' · email', 'success'); } catch {} }} disabled={pending}>
        {pending ? '…' : 'Send credentials'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </>
  );
}

/* ─── PROXY BUTTONS ────────────────────────────────────────────────── */

export function MarkFaultyButton({ proxyId }: { proxyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Mark faulty</button>
      <MarkFaultyModal open={open} onClose={() => setOpen(false)} proxyId={proxyId} />
    </>
  );
}

export function ReturnToPoolButton({ proxyId }: { proxyId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>Return to pool</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title="Return proxy to pool"
        entityLabel={`Proxy · ${proxyId}`}
        message="The proxy becomes AVAILABLE for new assignments."
        impact={[
          'Proxy status → AVAILABLE',
          'Credential / IP rotation markers stamped (next client never inherits live credentials)',
        ]}
        confirmLabel="Return to pool"
        onConfirm={async () => {
          await A.returnProxyToPoolAction(proxyId);
          toast('Proxy returned to pool', proxyId, 'success');
          router.refresh();
        }}
      />
    </>
  );
}

export function MarkHealthyButton({ proxyId }: { proxyId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>Mark healthy</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title="Mark proxy healthy"
        entityLabel={`Proxy · ${proxyId}`}
        message="Clears the faulty state after the hardware issue is fixed."
        impact={[
          'Health → HEALTHY',
          'Back to serving its order (ASSIGNED) if one is still attached, otherwise → AVAILABLE',
          'Replacement-pending exception on the attached order clears',
        ]}
        confirmLabel="Mark healthy"
        onConfirm={async () => {
          await A.markProxyHealthyAction(proxyId);
          toast('Proxy marked healthy', proxyId, 'success');
          router.refresh();
        }}
      />
    </>
  );
}

export function MaintenanceButton({ proxyId, inMaintenance }: { proxyId: string; inMaintenance: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>{inMaintenance ? 'End maintenance' : 'Maintenance'}</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title={inMaintenance ? 'End maintenance' : 'Start maintenance'}
        entityLabel={`Proxy · ${proxyId}`}
        message={inMaintenance
          ? 'The proxy resumes normal duty.'
          : 'The proxy is taken out of rotation; any current assignment is preserved.'}
        impact={inMaintenance
          ? ['Status → ASSIGNED if an order is still attached, otherwise AVAILABLE']
          : ['Status → MAINTENANCE', 'Open assignment (if any) stays attached', 'Not eligible for new assignments while in maintenance']}
        confirmLabel={inMaintenance ? 'End maintenance' : 'Start maintenance'}
        onConfirm={async () => {
          await A.setProxyMaintenanceAction(proxyId, !inMaintenance);
          toast(inMaintenance ? 'Maintenance ended' : 'Maintenance started', proxyId, inMaintenance ? 'success' : 'warning');
          router.refresh();
        }}
      />
    </>
  );
}

export function ReleaseProxyButton({ proxyId }: { proxyId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Release</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title="Release proxy"
        entityLabel={`Proxy · ${proxyId}`}
        message="The proxy returns to the available pool. Any current assignment is closed."
        impact={[
          'Active assignment closed with reason "admin-release"',
          'Proxy status → RELEASED',
          'Order may need re-assignment if it was active',
        ]}
        confirmLabel="Release"
        confirmTone="danger"
        onConfirm={async () => {
          await A.releaseProxyAction(proxyId);
          toast('Proxy released', proxyId, 'warning');
          router.refresh();
        }}
      />
    </>
  );
}

export function ReplaceProxyButton({ proxyId, orderId }: { proxyId: string; orderId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Replace</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title="Replace proxy"
        entityLabel={`Proxy · ${proxyId}`}
        message={`Swap ${proxyId} on order ${orderId} for a fresh healthy proxy from the same pool.`}
        impact={[
          'This proxy is released back to the pool (credentials rotated)',
          'A new AVAILABLE proxy takes its slot on the order',
          'The client is notified and gets the new credentials',
        ]}
        confirmLabel="Replace"
        onConfirm={async () => {
          const r = await A.replaceProxyAction(orderId, proxyId);
          toast('Proxy replaced', `${proxyId} → ${r.replacement}`, 'success');
          router.refresh();
        }}
      />
    </>
  );
}

/* ─── PLAN BUTTONS ─────────────────────────────────────────────────── */

export function TogglePlanButton({ planId, active }: { planId: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  if (active) {
    return (
      <>
        <button className="btn" onClick={() => setOpen(true)}>Disable plan</button>
        <ConfirmAction
          open={open} onClose={() => setOpen(false)}
          title="Disable plan"
          entityLabel={`Plan · ${planId}`}
          message="The plan stops accepting new orders. Existing orders + renewals continue normally."
          impact={[
            'Hidden from the client portal catalog immediately',
            'New purchases blocked',
            'Existing active orders unaffected',
            'You can re-enable from this same screen',
          ]}
          requireReason
          confirmLabel="Disable plan"
          confirmTone="danger"
          onConfirm={async ({ reason }) => {
            await A.togglePlanActiveAction(planId, false, reason);
            toast('Plan disabled', planId, 'warning');
            router.refresh();
          }}
        />
      </>
    );
  }
  return (
    <button className="btn primary" onClick={async () => {
      try {
        await A.togglePlanActiveAction(planId, true);
        toast('Plan enabled', planId, 'success');
        router.refresh();
      } catch (e: any) {
        toast('Could not enable plan', e?.message ?? 'Failed', 'danger');
      }
    }}>Enable plan</button>
  );
}

/* ─── CLIENT BUTTONS ───────────────────────────────────────────────── */

export function AdjustBalanceButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const [delta, setDelta] = useState('50');
  const [reason, setReason] = useState('Goodwill credit');
  const [note, setNote] = useState('');
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Adjust balance</button>
      <ConfirmAction
        open={open} onClose={() => setOpen(false)}
        title="Adjust balance"
        entityLabel={`Client · ${userId}`}
        message={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5 }}>Signed amount in USD. Positive = credit, negative = debit. A ledger entry is created and the client gets notified.</div>
            <div>
              <label className="form-label">Amount (signed)</label>
              <input className="form-input mono" type="number" step="0.01" value={delta} onChange={e => setDelta(e.target.value)} placeholder="+50 or -25" />
            </div>
            <div>
              <label className="form-label">Reason</label>
              <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="goodwill / promo / dispute" />
            </div>
            <div>
              <label className="form-label">Internal note (optional)</label>
              <textarea className="form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
        }
        confirmLabel="Apply adjustment"
        confirmTone="primary"
        onConfirm={async () => {
          const d = parseFloat(delta);
          if (isNaN(d) || d === 0) throw new Error('Amount must be a non-zero number');
          if (!reason.trim()) throw new Error('Reason required');
          const r = await A.adjustBalanceAction(userId, d, reason.trim(), note.trim() || undefined);
          toast(d >= 0 ? `Credited $${d}` : `Debited $${Math.abs(d)}`, `New balance: $${r.newBalance}`, 'success');
          router.refresh();
        }}
      />
    </>
  );
}

export function BlockUnblockButton({ userId, blocked }: { userId: string; blocked: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  if (blocked) {
    return (
      <button className="btn primary" onClick={async () => {
        await A.unblockClientAction(userId);
        toast('Client unblocked', userId, 'success');
        router.refresh();
      }}>Unblock client</button>
    );
  }
  return (
    <>
      <button className="btn danger" onClick={() => setOpen(true)}>Block client</button>
      <BlockClientModal open={open} onClose={() => setOpen(false)} userId={userId} />
    </>
  );
}

export function SetRiskButton({ userId, currentRisk }: { userId: string; currentRisk: 'NONE' | 'REVIEW' | 'FLAG' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Set risk flag</button>
      <RiskModal open={open} onClose={() => setOpen(false)} userId={userId} currentRisk={currentRisk} />
    </>
  );
}
