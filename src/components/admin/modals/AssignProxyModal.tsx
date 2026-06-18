'use client';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { assignProxyAction } from '@/lib/admin-actions';

type ProxyOpt = { id: string; carrier: string; region: string; pool: string; ip: string; port: number; health: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function AssignProxyModal({
  open, onClose, orderId, qtyNeeded, candidates,
}: { open: boolean; onClose: () => void; orderId: string; qtyNeeded: number; candidates: ProxyOpt[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setErr(null);
    }
  }, [open]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < qtyNeeded) next.add(id);
      return next;
    });
  }

  function submit() {
    setErr(null);
    if (selected.size === 0) return setErr('Pick at least one proxy');
    start(async () => {
      try {
        const r = await assignProxyAction(orderId, [...selected]);
        toast('Proxies assigned', `${selected.size} to ${orderId}` + (r.fullyAssigned ? ' · order activated' : ''), 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  return (
    <Modal
      open={open} onClose={onClose} title={`Assign proxies · ${orderId}`} size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={pending || selected.size === 0}>
            {pending ? 'Assigning…' : `Assign ${selected.size} ${selected.size === 1 ? 'proxy' : 'proxies'}`}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
        Order needs <strong style={{ color: 'var(--text)' }}>{qtyNeeded} {qtyNeeded === 1 ? 'proxy' : 'proxies'}</strong>. Pick from available, carrier/region-matching candidates.
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <table className="dt" style={{ marginBottom: 0 }}>
          <thead><tr><th className="col-chk"></th><th className="col-id">Proxy</th><th className="col-text">Carrier · Region</th><th className="col-text">Pool</th><th className="col-text">Credentials</th><th className="col-status">Health</th></tr></thead>
          <tbody>
            {candidates.length === 0
              ? <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No matching available proxies. Register more via Proxies → + Register proxy.</div></div></td></tr>
              : candidates.map(p => (
                <tr key={p.id} onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
                  <td className="col-chk">
                    <input type="checkbox" readOnly checked={selected.has(p.id)} disabled={!selected.has(p.id) && selected.size >= qtyNeeded} style={{ accentColor: 'var(--accent)' }} />
                  </td>
                  <td className="col-id"><span className="td-link">{p.id}</span></td>
                  <td className="col-text">{p.carrier} · {p.region}</td>
                  <td className="col-text">{p.pool}</td>
                  <td className="col-text td-mono">{p.ip}:{p.port}</td>
                  <td className="col-status"><span className={`chip ${p.health.toLowerCase()}`}>{cap(p.health)}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}
