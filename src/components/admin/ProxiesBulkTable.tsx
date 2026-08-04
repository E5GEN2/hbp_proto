'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { fmtAdminStamp } from '@/lib/date';
import { releaseProxyAction, markProxyFaultyAction, returnProxyToPoolAction, markProxyHealthyAction } from '@/lib/ui-actions/admin-actions';
import { ReplaceProxyModal } from './modals/ReplaceProxyModal';

type Row = {
  id: string;
  currentOrderId: string | null;
  carrier: string;
  region: string;
  pool: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  modem: string;
  trafficUsedMB: number;
  uptime: number;
  status: string;
  registeredAt: Date;
  histReleasedAt?: Date | null;
  histReason?: string | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
// History rows describe the client's PAST assignment, so the status chip shows
// why it ended — the proxy's live status belongs to whoever holds it now.
// Note the order itself may still be ACTIVE: REPLACEMENT / QTY_DOWN_ON_RENEWAL
// release a proxy mid-order, so History can hold rows of a living order.
const HIST_REASON: Record<string, { label: string; chip: string }> = {
  ORDER_EXPIRED: { label: 'Expired', chip: 'expired' },
  CANCEL: { label: 'Cancelled', chip: 'cancelled' },
  REPLACEMENT: { label: 'Replaced', chip: 'released' },
  QTY_DOWN_ON_RENEWAL: { label: 'Qty reduced', chip: 'released' },
  RENEWAL_CARRYOVER: { label: 'Carried over', chip: 'released' },
  MIGRATED: { label: 'Migrated', chip: 'released' },
  PRE_BIND_PENDING_RENEWAL: { label: 'Pre-bind', chip: 'released' },
  RENEWAL_CANCELLED_BY_OPERATOR: { label: 'Renewal cancelled', chip: 'released' },
  RELEASED: { label: 'Released', chip: 'released' },
};
// Canon Proxies .dt: 64 chk + 168 Proxy ID = 232 fixed; flex cols sum 29
// (canon 26 + 3 for the Registered date column added by product ask).

export function ProxiesBulkTable({ proxies, historyMode = false }: { proxies: Row[]; historyMode?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'release' | 'faulty'>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function clear() { setSelected(new Set()); }

  const sel = proxies.filter(p => selected.has(p.id));
  const canRelease = sel.length > 0 && sel.every(p => ['ASSIGNED', 'FAULTY'].includes(p.status));
  const canFaulty = sel.length > 0 && sel.every(p => p.status !== 'FAULTY');
  const canReturn = sel.length > 0 && sel.every(p => p.status === 'RELEASED');
  const canHealthy = sel.length > 0 && sel.every(p => p.status === 'FAULTY');
  // Replace is single-only (prototype): one serving/faulty proxy attached to an
  // order gets swapped for a fresh one from the pool.
  const one = sel.length === 1 ? sel[0] : null;
  const canReplace = !!one && ['ASSIGNED', 'FAULTY'].includes(one.status) && !!one.currentOrderId;

  // Owner revision (2026-07-28): Replace goes through the full modal —
  // auto-or-specific pick + required reason. This path used to fire the
  // action with no confirmation at all, which would have bypassed the
  // required-reason rule.
  const [replaceOpen, setReplaceOpen] = useState(false);

  async function bulkRun(action: (id: string) => Promise<any>, label: string) {
    start(async () => {
      let ok = 0, failed = 0;
      for (const p of sel) { try { await action(p.id); ok++; } catch { failed++; } }
      toast(`${label} · ${ok}/${sel.length} done${failed ? ` · ${failed} failed` : ''}`, '', failed ? 'warning' : 'success');
      clear();
      router.refresh();
    });
  }

  return (
    <>
      <div className={`bulk-bar ${!historyMode && selected.size > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{selected.size} selected</span>
        <div className="bulk-actions">
          {canReturn && <button className="btn sm primary" disabled={pending} onClick={() => bulkRun(returnProxyToPoolAction, 'Returned to pool')}>Return to pool</button>}
          {canHealthy && <button className="btn sm primary" disabled={pending} onClick={() => bulkRun(markProxyHealthyAction, 'Marked healthy')}>Mark healthy</button>}
          {canReplace && <button className="btn sm primary" disabled={pending} onClick={() => setReplaceOpen(true)}>Replace</button>}
          {canRelease && <button className="btn sm" disabled={pending} onClick={() => setConfirm('release')}>Release</button>}
          {canFaulty && <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('faulty')}>Mark faulty</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt dt-proxies" style={{ minWidth: 1120 }}>
          {/* ATS colgroup, pan-variant (owner: keep all 11 columns). B*=1120
              = min-width — pans ≤126px at 1280, zero at ≥1406. Anchors: chk
              52, Proxy ID 103, Assigned-to 103, Carrier·Region 114 (wraps),
              Pool 96 (wraps), Hardware ID 110 (td-mono ellipsis+tip), Data
              30D 87, Uptime 100, Registered 133, Status 124 ("Maintenance"
              fits; historyMode labels clip-guarded + tooltip); Credentials
              auto (td-mono ellipsis+tip — the natural absorber).
              Plain % of 1120. */}
          <colgroup>
            <col style={{ width: '4.6429%' }} />
            <col style={{ width: '9.1964%' }} />
            <col style={{ width: '9.1964%' }} />
            <col style={{ width: '10.1786%' }} />
            <col style={{ width: '8.5714%' }} />
            <col />
            <col style={{ width: '9.8214%' }} />
            <col style={{ width: '7.7679%' }} />
            <col style={{ width: '8.9286%' }} />
            <col style={{ width: '11.8750%' }} />
            <col style={{ width: '11.0714%' }} />
          </colgroup>
          <thead><tr>
            <th className="col-chk"></th>
            <th className="col-id">Proxy ID</th>
            <th className="col-id">Assigned to</th>
            <th className="col-text">Carrier · Region</th>
            <th className="col-text"><span className="th-label">Pool<span className="help-tip" data-tip="A named group of proxies a plan can draw from. Pools encode carrier + region + any segregation rules (e.g. clean IPs, premium tier).">i</span></span></th>
            <th className="col-text"><span className="th-label">Credentials<span className="help-tip" data-tip="Full connection credentials the customer uses: host:port:login:password.">i</span></span></th>
            <th className="col-text">Hardware ID</th>
            <th className="col-num"><span className="th-label">Data 30D<span className="help-tip" data-tip="Aggregate egress traffic on this proxy over the last 30 days, in GB.">i</span></span></th>
            <th className="col-num">Uptime 30d</th>
            <th className="col-date">{historyMode ? 'Released' : 'Registered'}</th>
            <th className="col-status">Status</th>
          </tr></thead>
          <tbody>
            {proxies.length === 0 ? (
              <tr><td colSpan={11}><div className="empty"><div className="empty-desc">No proxies match these filters.</div></div></td></tr>
            ) : proxies.map(p => {
              const maint = p.status === 'MAINTENANCE';
              return (
                <tr key={p.id} style={selected.has(p.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                  {/* History is read-only: bulk actions target the proxy's LIVE
                      assignment, which may belong to another client by now. */}
                  <td className="col-chk">{!historyMode && <span className={`chk ${selected.has(p.id) ? 'checked' : ''}`} onClick={() => toggle(p.id)} />}</td>
                  <td className="col-id"><Link href={`/admin/proxies/${p.id}`} className="td-link">{p.id}</Link></td>
                  <td className="col-id">{p.currentOrderId ? <Link href={`/admin/orders/${p.currentOrderId}`} className="td-link">{p.currentOrderId}</Link> : <span className="muted">—</span>}</td>
                  <td className="col-text muted">{p.carrier} · {p.region}</td>
                  <td className="col-text muted">{p.pool}</td>
                  <td className="col-text td-mono"><span className="cell-tip" data-tip={`${p.ip}:${p.port}:${p.username}:${p.password}`}>{p.ip}:{p.port}:{p.username}:{p.password}</span></td>
                  <td className="col-text td-mono"><span className="cell-tip" data-tip={p.modem}>{p.modem}</span></td>
                  <td className="col-num">{maint ? '—' : `${(p.trafficUsedMB / 1024).toFixed(1)} GB`}</td>
                  <td className="col-num">{maint ? '—' : `${p.uptime}%`}</td>
                  <td className="col-date">{fmtAdminStamp(historyMode ? p.histReleasedAt : p.registeredAt)}</td>
                  <td className="col-status">{historyMode
                    ? (() => { const r = HIST_REASON[p.histReason ?? 'RELEASED'] ?? { label: cap((p.histReason ?? 'RELEASED').replace(/_/g, ' ')), chip: 'released' }; return <span className={`chip ${r.chip} cell-tip chip-clip`} data-tip={r.label}>{r.label}</span>; })()
                    : <span className={`chip ${p.status.toLowerCase()}`}>{cap(p.status)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmAction
        open={confirm === 'release'} onClose={() => setConfirm(null)}
        title={`Release ${selected.size} ${selected.size === 1 ? 'proxy' : 'proxies'}`}
        message="The selected proxies return to the available pool. Any current assignment is closed."
        impact={['Status → AVAILABLE', 'Active assignments closed with security-reset markers', 'Orders may need re-assignment']}
        confirmLabel="Release" confirmTone="danger"
        onConfirm={async () => { await bulkRun(releaseProxyAction, 'Released'); setConfirm(null); }}
      />
      <ConfirmAction
        open={confirm === 'faulty'} onClose={() => setConfirm(null)}
        title={`Mark ${selected.size} ${selected.size === 1 ? 'proxy' : 'proxies'} faulty`}
        message="Flags the selected proxies as faulty so they stop being assigned."
        impact={['Status → FAULTY', 'Removed from the available pool', 'Action is logged with the operator']}
        requireReason confirmLabel="Mark faulty" confirmTone="danger"
        onConfirm={async ({ reason }) => { await bulkRun(id => markProxyFaultyAction(id, reason!, false), 'Marked faulty'); setConfirm(null); }}
      />
      {one && one.currentOrderId && (
        <ReplaceProxyModal
          open={replaceOpen}
          onClose={() => { setReplaceOpen(false); clear(); router.refresh(); }}
          orderId={one.currentOrderId}
          proxyId={one.id}
        />
      )}
    </>
  );
}
