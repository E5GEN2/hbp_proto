'use client';

// Shared proxy-candidate table for the Assign and Replace modals: the
// plan-matching group first, then every other AVAILABLE+HEALTHY proxy as an
// explicit override section. Pool is always visible (it is a soft routing
// preference, not a constraint — the admin sees where each proxy lives);
// override rows carry a "≠ plan" warning chip so a cross-carrier/region pick
// is a deliberate act, never an accident.
export type Candidate = { id: string; carrier: string; region: string; pool: string; ip: string; port: number; health: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function CandidatePicker({
  matching, others, plan, selected, onToggle, maxSelected,
}: {
  matching: Candidate[];
  others: Candidate[];
  plan: { carrier: string; region: string; pool: string };
  selected: Set<string>;
  onToggle: (id: string) => void;
  maxSelected: number;
}) {
  const atCap = selected.size >= maxSelected;
  const row = (p: Candidate, mismatch: boolean) => (
    <tr key={p.id} onClick={() => onToggle(p.id)} style={{ cursor: 'pointer' }}>
      <td className="col-chk">
        <span className={`chk ${selected.has(p.id) ? 'checked' : ''}`} style={!selected.has(p.id) && atCap ? { opacity: .35 } : undefined} />
      </td>
      <td className="col-id"><span className="td-link">{p.id}</span></td>
      <td className="col-text" style={mismatch ? { color: 'var(--warning)' } : undefined}>
        {p.carrier} · {p.region}{mismatch && <span className="chip warning" style={{ marginLeft: 8 }}>≠ plan</span>}
      </td>
      <td className="col-text">{p.pool}</td>
      <td className="col-text td-mono"><span className="cell-tip" data-tip={`${p.ip}:${p.port}`}>{p.ip}:{p.port}</span></td>
      <td className="col-status"><span className={`chip ${p.health.toLowerCase()}`}>{cap(p.health)}</span></td>
    </tr>
  );
  const sectionRow = (label: string) => (
    <tr>
      <td colSpan={6} style={{ padding: '8px 20px', fontSize: 10.5, fontWeight: 650, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--surface-2)' }}>{label}</td>
    </tr>
  );
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
      <table className="dt" style={{ marginBottom: 0, minWidth: 662 }}>
        {/* ATS colgroup, modal budget B=678: chk 52, Proxy 103, Pool 108,
            Credentials 150 (td-mono ellipsis + tooltip), Health 98;
            Carrier·Region auto (~167). Plain % only; floor 662 = B−16. */}
        <colgroup>
          <col style={{ width: '7.6696%' }} />
          <col style={{ width: '15.1917%' }} />
          <col />
          <col style={{ width: '15.9292%' }} />
          <col style={{ width: '22.1239%' }} />
          <col style={{ width: '14.4543%' }} />
        </colgroup>
        <thead><tr><th className="col-chk"></th><th className="col-id">Proxy</th><th className="col-text">Carrier · Region</th><th className="col-text">Pool</th><th className="col-text">Credentials</th><th className="col-status">Health</th></tr></thead>
        <tbody>
          {matching.length === 0 && others.length === 0 && (
            <tr><td colSpan={6}><div className="empty"><div className="empty-desc">No available healthy proxies at all. Register more via Proxies → + Register proxy.</div></div></td></tr>
          )}
          {matching.length > 0 && sectionRow(`Matching plan — ${plan.carrier} · ${plan.region}`)}
          {matching.map(p => row(p, false))}
          {others.length > 0 && sectionRow(`Other available — override (plan is ${plan.carrier} · ${plan.region})`)}
          {others.map(p => row(p, true))}
        </tbody>
      </table>
    </div>
  );
}
