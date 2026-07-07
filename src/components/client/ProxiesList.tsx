'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { FormSelect } from '@/components/ui/FormSelect';

export type ProxyRow = {
  id: string;
  orderId: string;
  carrier: string;
  region: string;
  autoRotateMin: number;
  uptime: number;
  speedMbps: number;
  health: 'healthy' | 'degraded' | 'offline';
  ip: string;
  port: number;
  username: string;
  password: string;
};

type Format = 'ip:port:user:pass' | 'user:pass@ip:port' | 'json' | 'csv';
type Proto = 'http' | 'socks5';

const PAGE_SIZE = 10;
/* Flexible .dt column width = applyDtAnchors() done in pure CSS:
   usable = 100% − anchor-l (64px chk + 164px Proxy ID = 228px); each col gets
   usable * --w / --col-total (19). table-layout:fixed honours the calc widths. */
const FLEX = (w: number) => `calc(100% * ${w} / 19)`;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const fmtAutoRotate = (m: number) => (m ? `${m} min` : '—');

const FORMATS: Format[] = ['ip:port:user:pass', 'user:pass@ip:port', 'json', 'csv'];
const FORMAT_LABEL: Record<Format, string> = {
  'ip:port:user:pass': 'ip:port:user:pass',
  'user:pass@ip:port': 'user:pass@ip:port',
  json: 'JSON',
  csv: 'CSV',
};

function formatExport(proxies: ProxyRow[], format: Format, proto: Proto): string {
  const portOf = (p: ProxyRow) => (proto === 'socks5' ? p.port + 1000 : p.port);
  if (format === 'ip:port:user:pass')
    return proxies.map(p => `${proto}://${p.ip}:${portOf(p)}:${p.username}:${p.password}`).join('\n');
  if (format === 'user:pass@ip:port')
    return proxies.map(p => `${proto}://${p.username}:${p.password}@${p.ip}:${portOf(p)}`).join('\n');
  if (format === 'json')
    return JSON.stringify(
      proxies.map(p => ({ id: p.id, protocol: proto, ip: p.ip, port: portOf(p), username: p.username, password: p.password, carrier: p.carrier, region: p.region })),
      null,
      2,
    );
  return ['id,protocol,ip,port,username,password,carrier,region']
    .concat(proxies.map(p => [p.id, proto, p.ip, portOf(p), p.username, p.password, p.carrier, p.region].join(',')))
    .join('\n');
}

export function ProxiesList({ rows }: { rows: ProxyRow[] }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [carrier, setCarrier] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Export modal
  const [exportSubject, setExportSubject] = useState<ProxyRow[] | null>(null);
  const [exportContext, setExportContext] = useState('');
  const [fmt, setFmt] = useState<Format>('ip:port:user:pass');
  const [proto, setProto] = useState<Proto>('http');

  const filtered = useMemo(
    () =>
      rows.filter(p => {
        if (carrier && p.carrier !== carrier) return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = [p.id, p.ip, p.orderId, p.carrier, p.region].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [rows, carrier, search],
  );

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(page, pages);
  const start = (pg - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(total, pg * PAGE_SIZE);

  function resetFilters() {
    setSearch('');
    setCarrier('');
    setPage(1);
    setSelected(new Set());
    toast('Filters reset', 'Showing all proxies', 'success');
  }
  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selCount = selected.size;
  const selectedProxies = () => rows.filter(p => selected.has(p.id));

  function bulkRotate() {
    const ps = selectedProxies();
    if (!ps.length) return;
    toast('Rotation complete', `${ps.length} ${ps.length === 1 ? 'proxy has' : 'proxies have'} fresh IPs.`, 'success');
  }
  async function bulkCopyCreds() {
    const ps = selectedProxies();
    if (!ps.length) return;
    const text = formatExport(ps, 'ip:port:user:pass', 'http');
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied credentials', `${ps.length} ${ps.length === 1 ? 'proxy' : 'proxies'}`, 'success');
    } catch {
      toast('Copy failed', 'Clipboard unavailable', 'danger');
    }
  }
  function bulkHealthCheck() {
    const ps = selectedProxies();
    if (!ps.length) return;
    const issues = ps.filter(p => p.health !== 'healthy').length;
    if (issues > 0) toast('Health check complete', `${issues} of ${ps.length} ${issues === 1 ? 'proxy needs' : 'proxies need'} attention.`, 'warning');
    else toast('Health check complete', `All ${ps.length} ${ps.length === 1 ? 'proxy is' : 'proxies are'} healthy.`, 'success');
  }

  function openExport(subject: ProxyRow[], context: string) {
    if (!subject.length) {
      toast('Nothing to export', '', 'warning');
      return;
    }
    setExportSubject(subject);
    setExportContext(context);
    setFmt('ip:port:user:pass');
    setProto('http');
  }
  async function copyExport() {
    if (!exportSubject) return;
    const text = formatExport(exportSubject, fmt, proto);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', `Exported as ${proto.toUpperCase()} · ${fmt}`, 'success');
    } catch {
      toast('Copy failed', 'Clipboard unavailable', 'danger');
    }
  }

  return (
    <>
      {/* Filter bar */}
      <div className="filter-bar">
        <div className="search-box">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10 10 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder=""
          />
        </div>
        <FormSelect
          value={carrier}
          onChange={v => {
            setCarrier(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All carriers' },
            { value: 'Verizon' },
            { value: 'T-Mobile' },
            { value: 'AT&T' },
          ]}
        />
        <div className="filter-divider" />
        <button className="btn" onClick={resetFilters}>
          Reset filters
        </button>
        <div className="filter-spacer" />
        <button className="btn" onClick={() => openExport(rows, 'all')}>
          <svg viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export
        </button>
        <Link className="btn primary" href="/catalog">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Buy proxies
        </Link>
      </div>

      {/* Bulk-select bar */}
      <div className={`bulk-bar ${selCount > 0 ? 'visible' : ''}`}>
        <div className="bulk-summary">
          <span className="chk checked" />
          <span>
            <span>{selCount}</span> selected
          </span>
        </div>
        <div className="bulk-actions">
          <button className="btn sm" onClick={bulkRotate}>
            Rotate
          </button>
          <button className="btn sm" onClick={bulkCopyCreds}>
            Copy credentials
          </button>
          <button className="btn sm" onClick={bulkHealthCheck}>
            Run health check
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="dt">
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 'var(--anchor-id)' }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(4) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(3) }} />
            <col style={{ width: FLEX(3) }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-chk" />
              <th className="col-id">Proxy ID</th>
              <th className="col-id">Assigned to</th>
              <th className="col-text">Carrier · Region</th>
              <th className="col-text center">Auto rotation</th>
              <th className="col-text center">Uptime 30D</th>
              <th className="col-text center">Speed</th>
              <th className="col-status">Health</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '48px 20px', textAlign: 'center', background: 'none' }}>
                  <div className="empty-title">No proxies match these filters.</div>
                  <div className="empty-desc">
                    Adjust the filters or{' '}
                    <span className="td-link" style={{ cursor: 'pointer' }} onClick={resetFilters}>
                      clear them
                    </span>
                    .
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map(p => (
                <tr key={p.id}>
                  <td className="col-chk">
                    <span className={`chk ${selected.has(p.id) ? 'checked' : ''}`} onClick={() => toggle(p.id)} />
                  </td>
                  <td className="col-id">
                    <Link className="td-link" href={`/proxies/${p.id}`}>
                      {p.id}
                    </Link>
                  </td>
                  <td className="col-id">
                    <Link className="td-link" href={`/orders/${p.orderId}`}>
                      {p.orderId}
                    </Link>
                  </td>
                  <td className="col-text muted">
                    <span className="cell-tip" data-tip={`${p.carrier} · ${p.region}`}>{p.carrier} · {p.region}</span>
                  </td>
                  <td className="col-text muted center">{fmtAutoRotate(p.autoRotateMin)}</td>
                  <td className="col-text muted center">{p.health === 'offline' ? '—' : `${Math.round(p.uptime ?? 0)}%`}</td>
                  <td className="col-text muted center">{p.health === 'offline' ? '—' : `${p.speedMbps ?? 0} Mbps`}</td>
                  <td className="col-status">
                    <span className={`chip ${p.health}`}>{cap(p.health)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <div className="pagination-info">
          Showing {from}–{to} of {total} {total === 1 ? 'proxy' : 'proxies'}
        </div>
        <div className="pagination-nav">
          <button className={`page-btn ${pg <= 1 ? 'disabled' : ''}`} onClick={() => setPage(Math.max(1, pg - 1))}>
            ‹
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(i => (
            <button key={i} className={`page-btn ${i === pg ? 'active' : ''}`} onClick={() => setPage(i)}>
              {i}
            </button>
          ))}
          <button className={`page-btn ${pg >= pages ? 'disabled' : ''}`} onClick={() => setPage(Math.min(pages, pg + 1))}>
            ›
          </button>
        </div>
      </div>

      {/* Export modal */}
      <Modal
        open={exportSubject !== null}
        onClose={() => setExportSubject(null)}
        size="lg"
        title={
          exportSubject
            ? `Export ${exportSubject.length} ${exportSubject.length === 1 ? 'proxy' : 'proxies'}${exportContext ? ' · ' + exportContext : ''}`
            : ''
        }
        footer={
          <>
            <button className="btn" onClick={() => setExportSubject(null)}>
              Close
            </button>
            <button className="btn primary" onClick={copyExport}>
              <svg viewBox="0 0 24 24">
                <path d="M9 9V5a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-4M3 11a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8z" />
              </svg>
              Copy to clipboard
            </button>
          </>
        }
      >
        <div className="export-row">
          <span className="export-label">Protocol</span>
          <div className="export-proto-group">
            <button className={`export-proto ${proto === 'http' ? 'active' : ''}`} onClick={() => setProto('http')}>
              HTTP
            </button>
            <button className={`export-proto ${proto === 'socks5' ? 'active' : ''}`} onClick={() => setProto('socks5')}>
              SOCKS5
            </button>
          </div>
        </div>
        <div className="export-row">
          <span className="export-label">Format</span>
          <div className="export-tabs">
            {FORMATS.map(f => (
              <div key={f} className={`export-tab ${fmt === f ? 'active' : ''}`} onClick={() => setFmt(f)}>
                {FORMAT_LABEL[f]}
              </div>
            ))}
          </div>
        </div>
        <pre className="export-preview">{exportSubject ? formatExport(exportSubject, fmt, proto) : ''}</pre>
      </Modal>
    </>
  );
}
