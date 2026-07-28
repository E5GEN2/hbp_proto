'use client';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { FormSelect } from '@/components/ui/FormSelect';
import { replaceProxyAction, listAssignCandidatesAction } from '@/lib/ui-actions/admin-actions';
import { CandidatePicker, type Candidate } from './CandidatePicker';

// Replace modal (owner revision, admin review 2026-07-28). Replaces the old
// yes/no ConfirmAction on every Replace entry point (order detail, proxy
// detail, proxies bulk bar — the bulk path used to skip confirmation
// entirely). Admin chooses auto (server pool-first pick, as before) or a
// specific proxy from ALL available ones with the pool visible, and MUST
// state a replacement reason — it lands in the released assignment's
// reasonDetail and the PROXY.REPLACE audit log. The client notification
// stays reason-free (internal cause is not client-facing).
type Groups = { matching: Candidate[]; others: Candidate[]; plan: { carrier: string; region: string; pool: string } };

// Replacement reasons — the technical five reuse the Mark-faulty vocabulary
// VERBATIM (MarkFaultyModal.CATEGORIES) so the same failure means the same
// label across both flows and analytics join cleanly; the next three are
// replacement-specific (not admin-observed faults): client-initiated, a
// provisioning correction, and a planned swap.
const OTHER = 'Other (write a note)';
const REASONS = [
  { value: 'Connection loss / cannot reach' },
  { value: 'High latency / degraded speed' },
  { value: 'IP banned / blocked at destination' },
  { value: 'Rotation not working' },
  { value: 'Auth failures' },
  { value: 'Client requested replacement' },
  { value: 'Wrong carrier / region assigned' },
  { value: 'Scheduled maintenance / hardware swap' },
  { value: OTHER },
];

export function ReplaceProxyModal({
  open, onClose, orderId, proxyId,
}: { open: boolean; onClose: () => void; orderId: string; proxyId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'auto' | 'pick'>('auto');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [groups, setGroups] = useState<Groups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    let stale = false;
    setLoadError(null);
    listAssignCandidatesAction(orderId)
      .then(g => { if (!stale) { setGroups(g); setPicked(prev => new Set([...prev].filter(id => inGroups(g, id)))); } })
      .catch((e: any) => { if (!stale) setLoadError(e?.message ?? 'Failed to load candidates'); });
    return () => { stale = true; };
  }

  useEffect(() => {
    if (!open) {
      setMode('auto'); setPicked(new Set()); setReason(''); setDetail(''); setErr(null); setLoadError(null); setGroups(null);
      return;
    }
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  function togglePick(id: string) {
    // Single-select: one replacement slot.
    setPicked(prev => (prev.has(id) ? new Set<string>() : new Set([id])));
  }

  function submit() {
    setErr(null);
    if (!reason) return setErr('Pick a replacement reason');
    if (reason === OTHER && !detail.trim()) return setErr('Describe the reason');
    if (mode === 'pick' && picked.size !== 1) return setErr('Pick the replacement proxy');
    const fullReason = reason === OTHER ? detail.trim() : (detail.trim() ? `${reason} — ${detail.trim()}` : reason);
    start(async () => {
      try {
        const r = await replaceProxyAction(orderId, proxyId, {
          newProxyId: mode === 'pick' ? [...picked][0] : undefined,
          reason: fullReason,
        });
        toast('Proxy replaced', `${proxyId} → ${r.replacement}`, 'success');
        onClose();
        router.refresh();
      } catch (e: any) { setErr(e?.message ?? 'Failed'); }
    });
  }

  const matchCount = groups?.matching.length ?? 0;
  return (
    <Modal
      open={open} onClose={onClose} title={`Replace proxy · ${proxyId}`} size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={submit}
            disabled={pending || !reason || (reason === OTHER && !detail.trim()) || (mode === 'pick' && picked.size !== 1)}>
            {pending ? 'Replacing…' : 'Replace'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
        {proxyId} is released back to the pool with rotated credentials; the replacement takes its slot on <strong style={{ color: 'var(--text)' }}>{orderId}</strong> and the client gets the new credentials.
      </div>

      {loadError && (
        <div style={{ marginBottom: 12, padding: 12, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{loadError}</span>
          <button className="btn sm" onClick={load}>Retry</button>
        </div>
      )}

      {/* Mode choice — onClick on the label so the whole card (padding + gap)
          toggles, not just the two child spans. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <label onClick={() => setMode('auto')} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: mode === 'auto' ? 'var(--surface-2)' : 'transparent' }}>
          <span className={`chk ${mode === 'auto' ? 'checked' : ''}`} style={{ marginTop: 1 }} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Auto from pool</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
              {groups === null ? (loadError ? 'Could not load candidates.' : 'Loading…') : matchCount === 0
                ? `No matching available proxies in ${groups.plan.carrier} · ${groups.plan.region} — pick manually below.`
                : `Pool-first pick from ${matchCount} matching available.`}
            </span>
          </span>
        </label>
        <label onClick={() => setMode('pick')} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: mode === 'pick' ? 'var(--surface-2)' : 'transparent' }}>
          <span className={`chk ${mode === 'pick' ? 'checked' : ''}`} style={{ marginTop: 1 }} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Pick a specific proxy</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>Any available proxy, any pool — pool shown per row, plan mismatches flagged.</span>
          </span>
        </label>
      </div>

      {mode === 'pick' && (
        groups === null
          ? <div className="empty" style={{ padding: '24px 20px' }}><div className="empty-desc">{loadError ? 'Could not load candidates.' : 'Loading candidates…'}</div></div>
          : <div style={{ marginBottom: 12 }}>
              <CandidatePicker matching={groups.matching} others={groups.others} plan={groups.plan}
                selected={picked} onToggle={togglePick} maxSelected={1} />
            </div>
      )}

      {/* Required reason */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
        <span className="form-label">Replacement reason</span>
        <FormSelect value={reason} onChange={setReason} options={REASONS} placeholder="Choose…" />
        <textarea
          className="form-input" rows={2}
          placeholder={reason === OTHER ? 'Describe the reason (required)' : 'Details (optional)'}
          value={detail} onChange={e => setDetail(e.target.value)}
        />
      </div>

      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}

function inGroups(g: Groups, id: string) {
  return g.matching.some(p => p.id === id) || g.others.some(p => p.id === id);
}
