'use client';
import { FormSelect } from '@/components/ui/FormSelect';
import { useState, useTransition, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { extendOrderAction } from '@/lib/ui-actions/admin-actions';
import { fmtAdminStamp } from '@/lib/date';

type Mode = 'same' | 'changeQty' | 'swap';

export function ExtendOrderModal({
  open, onClose, orderId, currentQty, currentDuration, currentExpiry,
}: {
  open: boolean; onClose: () => void;
  orderId: string;
  currentQty: number;
  currentDuration: number;
  currentExpiry: Date | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>('same');
  const [periodDays, setPeriodDays] = useState(currentDuration);
  const [newQty, setNewQty] = useState(currentQty);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode('same');
      setPeriodDays(currentDuration);
      setNewQty(currentQty);
      setChargeMode('comp');
      setErr(null);
    }
  }, [open, currentDuration, currentQty]);

  const newExpiry = useMemo(() => {
    const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
    return new Date(base.getTime() + periodDays * 86_400_000);
  }, [currentExpiry, periodDays]);

  const qtyDelta = newQty - currentQty;
  const carryover = mode === 'changeQty' ? Math.min(currentQty, newQty) : currentQty;
  const adds = mode === 'changeQty' ? Math.max(0, qtyDelta) : 0;
  const drops = mode === 'changeQty' ? Math.max(0, -qtyDelta) : 0;

  function submit() {
    setErr(null);
    if (periodDays < 1) return setErr('Period must be ≥ 1 day');
    if (mode === 'changeQty' && (newQty < 1 || newQty > 20)) return setErr('Quantity must be 1-20');
    start(async () => {
      try {
        const r = await extendOrderAction(orderId, periodDays);
        toast('Order extended', `New expiry: ${fmtAdminStamp(r.newExpiry)}`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title={`Extend order · ${orderId}`}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending}>{pending ? 'Extending…' : 'Extend'}</button>
        </>
      }
    >
      <div style={{ marginBottom: 16, display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
        <ModeTab active={mode === 'same'}      onClick={() => setMode('same')}      label="Same proxies" />
        <ModeTab active={mode === 'changeQty'} onClick={() => setMode('changeQty')} label="Change quantity" />
        <ModeTab active={mode === 'swap'}      onClick={() => setMode('swap')}      label="Swap proxies" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="form-label">Extension period</label>
          <FormSelect
            value={String(periodDays)}
            onChange={v => setPeriodDays(parseInt(v, 10))}
            placeholder={null}
            options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
          />
        </div>
        <div>
          <label className="form-label">Charge method</label>
          {/* The old select ('balance' / 'invoice') was decorative twice over:
              extendOrder never charges anything AND chargeMode was never even
              sent (extendOrderAction hardcodes comp). Owner decision 2026-07-20:
              honest static label until real extension charging is designed. */}
          <div className="form-input" style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', cursor: 'default' }}>
            No charge — manual / goodwill extension
          </div>
        </div>
        {mode === 'changeQty' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">New quantity</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => setNewQty(q => Math.max(1, q - 1))}>−</button>
              <input className="form-input mono" value={newQty} readOnly style={{ width: 60, textAlign: 'center' }} />
              <button type="button" className="btn sm" onClick={() => setNewQty(q => Math.min(20, q + 1))}>+</button>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 8 }}>was {currentQty}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius-md)' }}>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Delta summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 12.5 }}>
          <Stat label="Carryover" value={carryover} />
          <Stat label="Add" value={adds} tone="success" />
          <Stat label="Drop" value={drops} tone="danger" />
          <Stat label="Total" value={mode === 'changeQty' ? newQty : currentQty} bold />
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: 'var(--muted)' }}>New expiry</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtAdminStamp(newExpiry)}</span>
        </div>
      </div>
      {mode === 'swap' && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--info-dim)', color: 'var(--info)', borderRadius: 6, fontSize: 12 }}>
          Proxy swap UI lands in the next iteration. For now, the extend bumps expiry; use Force Replace on each proxy to swap.
        </div>
      )}
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '8px 12px', fontSize: 12.5,
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: 6, fontWeight: 500,
      }}>{label}</button>
  );
}
function Stat({ label, value, tone, bold }: { label: string; value: number; tone?: string; bold?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 16, marginTop: 2, color: tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--text)', fontWeight: bold ? 700 : 500 }}>
        {value}
      </div>
    </div>
  );
}
