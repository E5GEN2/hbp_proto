const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(d: Date | null | undefined) {
  if (!d) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateTime(d: Date | null | undefined) {
  if (!d) return '—';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(d)} ${h}:${m}`;
}

// Admin-style "22 Apr · 09:42"
export function fmtAdminStamp(d: Date | null | undefined) {
  if (!d) return '—';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${h}:${m}`;
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
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
