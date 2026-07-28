'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { FormSelect } from '@/components/ui/FormSelect';
import { recordNav } from '@/lib/nav-history';

export type ProxyRow = {
  id: string;
  orderId: string;
  carrier: string;
  region: string;
  autoRotateMin: number;
  uptime: number;
  speedMbps: number;
  health: 'healthy' | 'degraded' | 'offline';
  underMaintenance: boolean;
  ip: string;
  port: number;
  username: string;
  password: string;
  rotationUrl: string | null;
};

type Format = 'ip:port:user:pass' | 'user:pass@ip:port' | 'json' | 'csv';
type Proto = 'socks5' | 'http';

const PAGE_SIZE = 10;
/* Flexible .dt column width = applyDtAnchors() done in pure CSS:
   usable = 100% − anchor-l (64px chk + 164px Proxy ID = 228px); each col gets
   usable * --w / --col-total (19). table-layout:fixed honours the calc widths. */
const FLEX = (w: number) => `calc(100% * ${w} / 19)`;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const FORMATS: Format[] = ['ip:port:user:pass', 'user:pass@ip:port', 'json', 'csv'];
const FORMAT_LABEL: Record<Format, string> = {
  'ip:port:user:pass': 'ip:port:user:pass',
  'user:pass@ip:port': 'user:pass@ip:port',
  json: 'JSON',
  csv: 'CSV',
};

// includeUrl appends each proxy's IP-rotation URL (when it has one) on its own
// line under the credentials — for the string forms — or as a field for
// json/csv. Owner ask: the rotation URL is what a client actually acts on.
function formatExport(proxies: ProxyRow[], format: Format, proto: Proto, includeUrl: boolean): string {
  // Same port for both protocols — only the scheme prefix differs (owner:
  // the real credentials are identical for HTTP and SOCKS5).
  const portOf = (p: ProxyRow) => p.port;
  const urlTail = (p: ProxyRow) => (includeUrl && p.rotationUrl ? `\n${p.rotationUrl}` : '');
  if (format === 'ip:port:user:pass')
    return proxies.map(p => `${proto}://${p.ip}:${portOf(p)}:${p.username}:${p.password}${urlTail(p)}`).join('\n');
  if (format === 'user:pass@ip:port')
    return proxies.map(p => `${proto}://${p.username}:${p.password}@${p.ip}:${portOf(p)}${urlTail(p)}`).join('\n');
  if (format === 'json')
    return JSON.stringify(
      proxies.map(p => ({
        id: p.id, protocol: proto, ip: p.ip, port: portOf(p), username: p.username, password: p.password,
        carrier: p.carrier, region: p.region, ...(includeUrl ? { rotationUrl: p.rotationUrl ?? null } : {}),
      })),
      null, 2,
    );
  const header = ['id', 'protocol', 'ip', 'port', 'username', 'password', 'carrier', 'region', ...(includeUrl ? ['rotationUrl'] : [])];
  return [header.join(',')]
    .concat(proxies.map(p => [p.id, proto, p.ip, portOf(p), p.username, p.password, p.carrier, p.region, ...(includeUrl ? [p.rotationUrl ?? ''] : [])].join(',')))
    .join('\n');
}

export function ProxiesList({ rows, initialSearch = '', initialCarrier = '' }: { rows: ProxyRow[]; initialSearch?: string; initialCarrier?: string }) {
  const toast = useToast();
  const [search, setSearch] = useState(initialSearch);
  const [carrier, setCarrier] = useState(initialCarrier);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Export modal
  const [exportSubject, setExportSubject] = useState<ProxyRow[] | null>(null);
  const [exportContext, setExportContext] = useState('');
  const [fmt, setFmt] = useState<Format>('ip:port:user:pass');
  const [proto, setProto] = useState<Proto>('socks5');
  // Opt-in (owner: "a button that ADDS the rotation URL"). Off by default keeps
  // the string forms one-proxy-per-line for importers; clicking adds the URL
  // on its own line under each credential line.
  const [includeUrl, setIncludeUrl] = useState(false);

  // Carrier options come from the client's OWN proxies (which are admin-
  // provisioned from the catalog) — no hard-coded phantom carriers. Sorted.
  const carriers = useMemo(() => [...new Set(rows.map(r => r.carrier))].sort(), [rows]);

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

  // Persist search/carrier to the URL + the nav-history stack so the backlink
  // returns to /proxies WITH the filters intact — a client can search an order,
  // drill into a proxy/order, and come back to the same filtered view (owner
  // ask). history.replaceState keeps it client-side (no server round-trip per
  // keystroke); recordNav refreshes the stack top since NavBacklink's effect
  // doesn't re-run on a query-only change.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (search) sp.set('q', search);
    if (carrier) sp.set('carrier', carrier);
    const qs = sp.toString();
    const url = `/proxies${qs ? `?${qs}` : ''}`;
    window.history.replaceState(window.history.state, '', url);
    recordNav(url, 'Proxies');
  }, [search, carrier]);

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

  async function bulkCopyCreds() {
    const ps = selectedProxies();
    if (!ps.length) return;
    // Owner ask: copy the selected proxies' credentials AND their rotation URLs.
    const text = formatExport(ps, 'ip:port:user:pass', 'socks5', true);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied credentials', `${ps.length} ${ps.length === 1 ? 'proxy' : 'proxies'} · with rotation URL`, 'success');
    } catch {
      toast('Copy failed', 'Clipboard unavailable', 'danger');
    }
  }

  function openExport(subject: ProxyRow[], context: string) {
    if (!subject.length) {
      toast('Nothing to export', '', 'warning');
      return;
    }
    setExportSubject(subject);
    setExportContext(context);
    setFmt('ip:port:user:pass');
    setProto('socks5');
    setIncludeUrl(false);
  }
  async function copyExport() {
    if (!exportSubject) return;
    const text = formatExport(exportSubject, fmt, proto, effectiveIncludeUrl);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', `Exported as ${proto.toUpperCase()} · ${fmt}`, 'success');
    } catch {
      toast('Copy failed', 'Clipboard unavailable', 'danger');
    }
  }

  const anyRotationUrl = exportSubject?.some(p => p.rotationUrl) ?? false;
  // Never add an all-null rotationUrl field/column to json/csv when the subject
  // has no URLs (the string forms are already per-row gated on p.rotationUrl).
  const effectiveIncludeUrl = includeUrl && anyRotationUrl;

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
          options={[{ value: '', label: 'All carriers' }, ...carriers.map(c => ({ value: c }))]}
        />
        <div className="filter-divider" />
        <button className="btn" onClick={resetFilters}>
          Reset filters
        </button>
        <div className="filter-spacer" />
        <button className="btn" onClick={() => openExport(filtered, search || carrier ? 'filtered' : 'all')}>
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
          <span>
            <span>{selCount}</span> selected
          </span>
        </div>
        <div className="bulk-actions">
          <button className="btn sm" onClick={bulkCopyCreds}>
            Copy credentials
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="dt dt-proxies">
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
                  <td className="col-text muted">{p.carrier} · {p.region}</td>
                  {/* Auto rotation / Uptime / Speed show a dash until real
                      telemetry lands (owner decision, Phase-2 backlog) — there
                      is no live data behind these columns yet. Health stays a
                      live chip: it is an operator-set status (Mark faulty /
                      Maintenance / sweep), not telemetry (owner: live statuses
                      must show). */}
                  <td className="col-text muted center">—</td>
                  <td className="col-text muted center">—</td>
                  <td className="col-text muted center">—</td>
                  <td className="col-status">
                    {p.underMaintenance
                      ? <span className="chip maintenance" data-tip="This proxy is under scheduled maintenance — service may be briefly interrupted.">Maintenance</span>
                      : <span className={`chip ${p.health}`}>{cap(p.health)}</span>}
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
            <button className={`export-proto ${proto === 'socks5' ? 'active' : ''}`} onClick={() => setProto('socks5')}>
              SOCKS5
            </button>
            <button className={`export-proto ${proto === 'http' ? 'active' : ''}`} onClick={() => setProto('http')}>
              HTTP
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
        <div className="export-row">
          <span className="export-label">Rotation URL</span>
          <button
            className={`export-proto ${effectiveIncludeUrl ? 'active' : ''}`}
            onClick={() => setIncludeUrl(v => !v)}
            disabled={!anyRotationUrl}
            title={anyRotationUrl ? '' : 'None of these proxies has a rotation URL'}
          >
            {!anyRotationUrl ? 'No rotation URL' : includeUrl ? 'Included' : 'Add IP rotation URL'}
          </button>
        </div>
        <pre className="export-preview">{exportSubject ? formatExport(exportSubject, fmt, proto, effectiveIncludeUrl) : ''}</pre>
      </Modal>
    </>
  );
}
