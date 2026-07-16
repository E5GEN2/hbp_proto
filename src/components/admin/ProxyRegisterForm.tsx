'use client';
import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormSelect } from '@/components/ui/FormSelect';
import { useToast } from '@/components/ui/Toast';
import { registerProxiesAction } from '@/lib/ui-actions/admin-actions';

type Catalog = { carriers: string[]; regions: string[]; pools: string[] };

type Draft = {
  modem: string; carrier: string; region: string; pool: string;
  ip: string; port: string; username: string; password: string; rotationUrl: string;
};
const EMPTY: Draft = { modem: '', carrier: '', region: '', pool: '', ip: '', port: '', username: '', password: '', rotationUrl: '' };

const MAX_MANUAL = 10;
const MAX_IMPORT = 200; // matches the server-side batch cap
const PREVIEW_MAX = 250; // rows rendered in the import preview — a mis-picked huge file must not hang the tab
const IMPORT_FORMAT = 'deviceid:carrier:region:pool:host:port:login:pass[:rotationurl]';

type ParsedLine = { n: number; draft?: Draft; error?: string };

const DEVICE_ID_TIP = 'Identifier of the physical device (modem) serving this proxy. Free-form — use whatever your fleet tooling calls it.';
const POOL_TIP = 'A named group of proxies a plan can draw from. Pools encode carrier + region + any segregation rules (e.g. clean IPs, premium tier).';
const ROTATION_URL_TIP = 'Optional. Endpoint that forces an IP rotation on this device when requested. Leave empty if the device has none.';

function parseImport(text: string, catalog: Catalog): ParsedLine[] {
  const find = (list: string[], v: string) => list.find(x => x.toLowerCase() === v.trim().toLowerCase());
  const out: ParsedLine[] = [];
  const endpoints = new Set<string>();
  const lines = text.split(/\r?\n/);
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    n++;
    const parts = line.split(':');
    if (parts.length < 8) {
      out.push({ n, error: `expected 8 colon-separated fields, got ${parts.length}` });
      continue;
    }
    const [modem, carrier, region, pool, ip, portStr, username, password] = parts.map(p => p.trim());
    // Field 9 is the optional rotation URL; it contains colons itself
    // (http://…) so everything past the 8th separator is rejoined — which
    // means the password itself must not contain ':'.
    const rotationUrl = parts.length > 8 ? parts.slice(8).join(':').trim() : '';
    if (!modem || !carrier || !region || !pool || !ip || !portStr || !username || !password) {
      out.push({ n, error: 'empty field' });
      continue;
    }
    if (rotationUrl && !/^https?:\/\//i.test(rotationUrl)) {
      out.push({ n, error: "rotation URL must start with http:// or https:// (password must not contain ':')" });
      continue;
    }
    // Digits-only: Number() would accept '1e3'/'0x50' here while the submit
    // path sends a different value — the two must agree on every input.
    const port = /^\d+$/.test(portStr) ? Number(portStr) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      out.push({ n, error: `bad port «${portStr}»` });
      continue;
    }
    const c = find(catalog.carriers, carrier);
    if (!c) { out.push({ n, error: `unknown carrier «${carrier}»` }); continue; }
    const r = find(catalog.regions, region);
    if (!r) { out.push({ n, error: `unknown region «${region}»` }); continue; }
    const p = find(catalog.pools, pool);
    if (!p) { out.push({ n, error: `unknown pool «${pool}»` }); continue; }
    // Same key as the server: ip:port:login — one host:port may carry several
    // proxies that differ only by credentials.
    const endpoint = `${ip}:${port}:${username}`;
    if (endpoints.has(endpoint)) { out.push({ n, error: `duplicate ${endpoint}` }); continue; }
    endpoints.add(endpoint);
    out.push({ n, draft: { modem, carrier: c, region: r, pool: p, ip, port: portStr, username, password, rotationUrl } });
  }
  return out;
}

export function ProxyRegisterForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'manual' | 'import'>('manual');
  const [rows, setRows] = useState<Draft[]>([{ ...EMPTY }]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const validImports = useMemo(() => parsed.filter(l => l.draft).map(l => l.draft!), [parsed]);
  const importErrors = parsed.length - validImports.length;
  const overCap = validImports.length > MAX_IMPORT;
  const registerCount = mode === 'manual' ? rows.length : validImports.length;

  const setRow = (i: number, patch: Partial<Draft>) =>
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onFile(file: File) {
    setErr(null);
    if (file.size > 512 * 1024) {
      setFileName(file.name);
      setParsed([]);
      setErr('File is too large (max 512 KB). Split it and import in parts.');
      return;
    }
    setFileName(file.name);
    setParsed(parseImport(await file.text(), catalog));
  }

  function toInput(d: Draft) {
    return {
      modem: d.modem.trim(), carrier: d.carrier, region: d.region, pool: d.pool,
      ip: d.ip.trim(), port: Number(d.port.trim()),
      username: d.username.trim(), password: d.password.trim(),
      rotationUrl: d.rotationUrl.trim() || null,
    };
  }

  function submit() {
    setErr(null);
    if (mode === 'manual') {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.modem.trim() || !r.carrier || !r.region || !r.pool || !r.ip.trim() || !r.username.trim() || !r.password.trim()) {
          setErr(`Proxy ${i + 1}: all fields are required`);
          return;
        }
        const port = /^\d+$/.test(r.port.trim()) ? Number(r.port.trim()) : NaN;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          setErr(`Proxy ${i + 1}: port must be a whole number between 1 and 65535`);
          return;
        }
        if (r.rotationUrl.trim() && !/^https?:\/\//i.test(r.rotationUrl.trim())) {
          setErr(`Proxy ${i + 1}: rotation URL must start with http:// or https://`);
          return;
        }
      }
    } else if (overCap) {
      setErr(`The file has ${validImports.length} valid lines — the batch limit is ${MAX_IMPORT}. Split the file and import in parts.`);
      return;
    }
    const inputs = (mode === 'manual' ? rows : validImports).map(toInput);
    start(async () => {
      try {
        const r = await registerProxiesAction(inputs);
        const n = r.proxyIds.length;
        toast(`${n} ${n === 1 ? 'proxy' : 'proxies'} registered`, n <= 3 ? r.proxyIds.join(', ') : `${r.proxyIds[0]} … ${r.proxyIds[n - 1]}`, 'success');
        router.push('/admin/proxies');
        router.refresh();
      } catch (e: any) {
        let msg: string = e?.message ?? 'Failed';
        if (mode === 'import') {
          // The server numbers items by position in the submitted (valid-only)
          // array — map that back to the preview's line numbers, which also
          // count the skipped invalid lines.
          const m = /^Proxy #(\d+): (.*)$/.exec(msg);
          const line = m ? parsed.filter(l => l.draft)[parseInt(m[1], 10) - 1]?.n : undefined;
          if (m && line !== undefined) msg = `Line ${line}: ${m[2]}`;
        }
        setErr(msg);
      }
    });
  }

  const badge = mode === 'manual'
    ? `${rows.length} of ${MAX_MANUAL} · manual entry`
    : fileName
      ? `${validImports.length} valid${importErrors ? ` · ${importErrors} ${importErrors === 1 ? 'error' : 'errors'}` : ''}`
      : 'No file loaded';

  const manualSections = (
    <>
      {rows.map((r, i) => (
        <Fragment key={i}>
          {/* Network targeting row — Carrier / Region / Pool on one line */}
          <div className="panel-section">
            <div className="panel-title-row">
              <div className="panel-title">Proxy {i + 1}</div>
              {i === 0
                ? <span className="form-required-note"><span className="req">*</span>Required fields</span>
                : <button type="button" className="btn sm" onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} disabled={pending}>Remove</button>}
            </div>
            <div className="infra-grid">
              <div className="form-field">
                <div className="form-label">Carrier <span className="req">*</span></div>
                <FormSelect value={r.carrier} onChange={v => setRow(i, { carrier: v })} options={catalog.carriers.map(c => ({ value: c }))} placeholder="Choose…" />
              </div>
              <div className="form-field">
                <div className="form-label">Region <span className="req">*</span></div>
                <FormSelect value={r.region} onChange={v => setRow(i, { region: v })} options={catalog.regions.map(x => ({ value: x }))} placeholder="Choose…" />
              </div>
              <div className="form-field">
                <div className="form-label">Pool <span className="req">*</span><span className="help-tip" data-tip={POOL_TIP}>i</span></div>
                <FormSelect value={r.pool} onChange={v => setRow(i, { pool: v })} options={catalog.pools.map(x => ({ value: x }))} placeholder="Choose…" />
              </div>
            </div>
          </div>
          {/* Device block — divider comes from .panel-section + .panel-section */}
          <div className="panel-section">
            <div className="infra-grid">
              <div className="form-field">
                <div className="form-label">Device ID <span className="req">*</span><span className="help-tip" data-tip={DEVICE_ID_TIP}>i</span></div>
                <input className="form-input mono" value={r.modem} onChange={e => setRow(i, { modem: e.target.value })} maxLength={64} />
              </div>
            </div>
            <div className="proxy-cred-grid" style={{ marginTop: 16 }}>
              <div className="form-field">
                <div className="form-label">Host <span className="req">*</span></div>
                <input className="form-input mono" value={r.ip} onChange={e => setRow(i, { ip: e.target.value })} maxLength={64} />
              </div>
              <div className="form-field">
                <div className="form-label">Port <span className="req">*</span></div>
                <input className="form-input mono" type="number" min={1} max={65535} step={1} value={r.port} onChange={e => setRow(i, { port: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Username <span className="req">*</span></div>
                <input className="form-input mono" value={r.username} onChange={e => setRow(i, { username: e.target.value })} maxLength={64} />
              </div>
              <div className="form-field">
                <div className="form-label">Password <span className="req">*</span></div>
                <input className="form-input mono" value={r.password} onChange={e => setRow(i, { password: e.target.value })} maxLength={128} />
              </div>
            </div>
            <div className="form-field" style={{ marginTop: 16 }}>
              <div className="form-label">Rotation URL<span className="help-tip" data-tip={ROTATION_URL_TIP}>i</span></div>
              <input className="form-input mono" value={r.rotationUrl} onChange={e => setRow(i, { rotationUrl: e.target.value })} maxLength={512} />
            </div>
          </div>
        </Fragment>
      ))}
      <div className="panel-section">
        <button
          type="button" className="btn" disabled={pending || rows.length >= MAX_MANUAL}
          onClick={() => setRows(prev => [...prev, { ...EMPTY }])}
        >
          + Add proxy{rows.length >= MAX_MANUAL ? ` (${MAX_MANUAL} max)` : ''}
        </button>
      </div>
    </>
  );

  const importSection = (
    <div className="panel-section">
      <div className="panel-title-row">
        <div className="panel-title">Import from file</div>
        <span className="form-required-note">One proxy per line · <span className="mono">{IMPORT_FORMAT}</span></span>
      </div>
      <input
        ref={fileRef} type="file" accept=".txt,.csv,.list,text/plain" style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ''; // allow re-selecting the same file after edits
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={pending}>Choose file…</button>
        {fileName && <span className="t-note mono">{fileName}</span>}
      </div>
      {parsed.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="dt">
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col />
            </colgroup>
            <thead><tr>
              <th className="col-num">#</th>
              <th className="col-text">Device ID</th>
              <th className="col-text">Carrier · Region</th>
              <th className="col-text">Pool</th>
              <th className="col-text">Endpoint</th>
              <th className="col-text">Login</th>
              <th className="col-status">Check</th>
            </tr></thead>
            <tbody>
              {parsed.slice(0, PREVIEW_MAX).map(l => (
                <tr key={l.n}>
                  <td className="col-num">{l.n}</td>
                  <td className="col-text td-mono"><span className="cell-tip" data-tip={l.draft?.modem ?? '—'}>{l.draft?.modem ?? '—'}</span></td>
                  <td className="col-text muted">{l.draft ? `${l.draft.carrier} · ${l.draft.region}` : '—'}</td>
                  <td className="col-text muted">{l.draft?.pool ?? '—'}</td>
                  <td className="col-text td-mono">
                    {l.draft
                      ? <span className="cell-tip" data-tip={`${l.draft.ip}:${l.draft.port}${l.draft.rotationUrl ? ` · rotate: ${l.draft.rotationUrl}` : ''}`}>{l.draft.ip}:{l.draft.port}</span>
                      : '—'}
                  </td>
                  <td className="col-text td-mono">{l.draft?.username ?? '—'}</td>
                  <td className="col-status">
                    {l.draft
                      ? <span className="chip available">OK</span>
                      : <span style={{ color: 'var(--danger)', fontSize: 11 }}>{l.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed.length > PREVIEW_MAX && (
        <div className="form-required-note" style={{ marginTop: 10 }}>
          Preview shows the first {PREVIEW_MAX} of {parsed.length} lines.
        </div>
      )}
      {parsed.length > 0 && importErrors > 0 && (
        <div className="form-required-note" style={{ marginTop: 10 }}>
          Lines with errors are skipped — only the {validImports.length} valid {validImports.length === 1 ? 'line' : 'lines'} will be registered.
        </div>
      )}
    </div>
  );

  return (
    <div className="page-shell">
      <div className="detail-header compact">
        <div className="detail-header-status">
          <div className="plan-create-title">Register proxy</div>
          <span className="badge-soft">{badge}</span>
        </div>
        <div className="detail-header-actions">
          <Link href="/admin/proxies" className="btn">Cancel</Link>
          <button type="button" className="btn primary" onClick={submit} disabled={pending || registerCount === 0}>
            {pending ? 'Registering…' : `Register ${registerCount > 1 ? `${registerCount} proxies` : 'proxy'}`}
          </button>
        </div>
      </div>
      {err && <div className="exc-banner danger" style={{ marginBottom: 0 }}><div className="exc-banner-body"><div className="exc-banner-desc">{err}</div></div></div>}
      <div className="panel">
        <div className="tabs">
          <button type="button" className={`tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
            Manual entry<span className="tab-count">{rows.length}</span>
          </button>
          <button type="button" className={`tab ${mode === 'import' ? 'active' : ''}`} onClick={() => setMode('import')}>
            Import from file{parsed.length > 0 && <span className="tab-count">{validImports.length}</span>}
          </button>
        </div>
        {mode === 'manual' ? manualSections : importSection}
      </div>
    </div>
  );
}
