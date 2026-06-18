const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// All absolute stamps render in UTC. The DB stores UTC instants and the admin
// clock is labelled UTC, so UTC is the correct display — and, critically, it is
// deterministic: a value rendered on the server (server tz) and re-rendered
// during client-component hydration (browser tz) now match, so tables no longer
// throw React #425 hydration-text-mismatch errors.
export function fmtDate(d: Date | null | undefined) {
  if (!d) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function fmtDateTime(d: Date | null | undefined) {
  if (!d) return '—';
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fmtDate(d)} ${h}:${m}`;
}

// Admin-style "22 Apr · 09:42" (UTC)
export function fmtAdminStamp(d: Date | null | undefined) {
  if (!d) return '—';
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${h}:${m}`;
}

export function fmtRel(d: Date | null | undefined) {
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d ago`;
  return fmtDate(d);
}

export function daysLeft(expires: Date | null | undefined) {
  if (!expires) return null;
  const diff = expires.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function fmtTimelineStamp(d: Date | null | undefined) {
  if (!d) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
