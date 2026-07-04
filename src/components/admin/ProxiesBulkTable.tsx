'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmAction } from '@/components/ui/ConfirmAction';
import { releaseProxyAction, markProxyFaultyAction } from '@/lib/ui-actions/admin-actions';

type Row = {
  id: string;
  currentOrderId: string | null;
  carrier: string;
  region: string;
  pool: string;
  ip: string;
  port: number;
  modem: string;
  trafficUsedMB: number;
  uptime: number;
  status: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
// Canon Proxies .dt: 64 chk + 168 Proxy ID = 232 fixed; flex cols sum 26.
const FLEX = (w: number) => `calc((100% - 232px) * ${w} / 26)`;

export function ProxiesBulkTable({ proxies }: { proxies: Row[] }) {
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
      <div className={`bulk-bar ${selected.size > 0 ? 'visible' : ''}`}>
        <span className="bulk-count">{selected.size} selected</span>
        <div className="bulk-actions">
          {canRelease && <button className="btn sm" disabled={pending} onClick={() => setConfirm('release')}>Release</button>}
          {canFaulty && <button className="btn sm danger" disabled={pending} onClick={() => setConfirm('faulty')}>Mark faulty</button>}
          <button className="btn sm" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="dt">
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 168 }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(2) }} />
            <col style={{ width: FLEX(4) }} />
          </colgroup>
          <thead><tr>
            <th className="col-chk"></th>
            <th className="col-id">Proxy ID</th>
            <th className="col-id">Assigned to</th>
            <th className="col-text">Carrier · Region</th>
            <th className="col-text">Pool</th>
            <th className="col-text">Credentials</th>
            <th className="col-text">Hardware ID</th>
            <th className="col-num">Data 30D</th>
            <th className="col-num">Uptime 30d</th>
            <th className="col-status">Status</th>
          </tr></thead>
          <tbody>
            {proxies.length === 0 ? (
              <tr><td colSpan={10}><div className="empty"><div className="empty-desc">No proxies match these filters.</div></div></td></tr>
            ) : proxies.map(p => {
              const maint = p.status === 'MAINTENANCE';
              return (
                <tr key={p.id} style={selected.has(p.id) ? { background: 'var(--accent-subtle)' } : undefined}>
                  <td className="col-chk"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} style={{ accentColor: 'var(--accent)' }} /></td>
                  <td className="col-id"><Link href={`/admin/proxies/${p.id}`} className="td-link">{p.id}</Link></td>
                  <td className="col-id">{p.currentOrderId ? <Link href={`/admin/orders/${p.currentOrderId}`} className="td-link">{p.currentOrderId}</Link> : <span className="muted">—</span>}</td>
                  <td className="col-text muted">{p.carrier} · {p.region}</td>
                  <td className="col-text muted">{p.pool}</td>
                  <td className="col-text td-mono">{p.ip}:{p.port}</td>
                  <td className="col-text td-mono">{p.modem}</td>
                  <td className="col-num">{maint ? '—' : `${(p.trafficUsedMB / 1024).toFixed(1)} GB`}</td>
                  <td className="col-num">{maint ? '—' : `${p.uptime}%`}</td>
                  <td className="col-status"><span className={`chip ${p.status.toLowerCase()}`}>{cap(p.status)}</span></td>
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
    </>
  );
}
