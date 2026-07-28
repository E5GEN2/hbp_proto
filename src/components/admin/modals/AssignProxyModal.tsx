'use client';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { assignProxyAction, listAssignCandidatesAction } from '@/lib/ui-actions/admin-actions';
import { CandidatePicker, type Candidate } from './CandidatePicker';

// Assign modal (owner revision, admin review 2026-07-28): candidates load on
// OPEN — two groups (plan-matching + any-pool override, pool always visible) —
// and an auto-assign option runs the server's pool-first pick inside one
// transaction (never stale, never over-fills). Manual picks work cross-pool
// and even cross-region: soft preferences, flagged in the picker, allowed by
// the server (assignProxyManually). The live deficit comes from the fetch, so
// the cap tracks a concurrent assign; on a submit error we re-fetch.
type Groups = { matching: Candidate[]; others: Candidate[]; plan: { carrier: string; region: string; pool: string }; deficit: number };

export function AssignProxyModal({
  open, onClose, orderId, qtyNeeded,
}: { open: boolean; onClose: () => void; orderId: string; qtyNeeded: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Groups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    let stale = false;
    setLoadError(null);
    listAssignCandidatesAction(orderId)
      .then(g => { if (!stale) { setGroups(g); setSelected(prev => new Set([...prev].filter(id => inGroups(g, id)))); } })
      .catch((e: any) => { if (!stale) setLoadError(e?.message ?? 'Failed to load candidates'); });
    return () => { stale = true; };
  }

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setErr(null);
      setLoadError(null);
      setGroups(null);
      return;
    }
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  // Prefer the freshly-fetched deficit; fall back to the render-time prop until
  // the fetch lands.
  const need = groups?.deficit ?? qtyNeeded;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < need) next.add(id);
      return next;
    });
  }

  function submit(auto: boolean) {
    setErr(null);
    if (!auto && selected.size === 0) return setErr('Pick at least one proxy');
    start(async () => {
      try {
        const r = await assignProxyAction(orderId, auto ? null : [...selected]);
        const n = r.assigned?.length ?? selected.size;
        toast('Proxies assigned', `${n} to ${orderId}` + (r.fullyAssigned ? ' · order activated' : ''), 'success');
        onClose();
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? 'Failed');
        load(); // re-sync deficit + candidate list (e.g. a concurrent assign)
      }
    });
  }

  const matchCount = groups?.matching.length ?? 0;
  const loading = groups === null && loadError === null;
  return (
    <Modal
      open={open} onClose={onClose} title={`Assign proxies · ${orderId}`} size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn primary" onClick={() => submit(false)} disabled={pending || selected.size === 0}>
            {pending ? 'Assigning…' : `Assign ${selected.size} ${selected.size === 1 ? 'proxy' : 'proxies'}`}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
        Order needs <strong style={{ color: 'var(--text)' }}>{need} {need === 1 ? 'proxy' : 'proxies'}</strong>.
      </div>

      {loadError ? (
        <div style={{ padding: 12, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{loadError}</span>
          <button className="btn sm" onClick={load}>Retry</button>
        </div>
      ) : (
        <>
          {/* Auto path — the same pool-first matcher every automated path uses */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Auto-assign from pool</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {loading ? 'Loading candidates…'
                  : matchCount === 0 ? 'No matching available proxies — pick manually below or register more.'
                  : `Pool-first pick of up to ${Math.min(need, matchCount)} matching ${plural(Math.min(need, matchCount))} (${matchCount} available).`}
              </div>
            </div>
            <button className="btn primary" onClick={() => submit(true)} disabled={pending || loading || matchCount === 0}>
              {pending ? 'Assigning…' : 'Auto-assign'}
            </button>
          </div>

          <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 8px' }}>
            Or pick specific proxies
          </div>
          {loading
            ? <div className="empty" style={{ padding: '24px 20px' }}><div className="empty-desc">Loading candidates…</div></div>
            : <CandidatePicker matching={groups!.matching} others={groups!.others} plan={groups!.plan}
                selected={selected} onToggle={toggle} maxSelected={need} />}
        </>
      )}
      {err && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-dim)', color: 'var(--danger)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
    </Modal>
  );
}

function inGroups(g: Groups, id: string) {
  return g.matching.some(p => p.id === id) || g.others.some(p => p.id === id);
}
function plural(n: number) { return n === 1 ? 'proxy' : 'proxies'; }
