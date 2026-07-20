// App-wide money formatter (P1-5). en-US grouping is HARD-CODED — the app is
// English-only, and browser-locale toLocaleString() (the old NotificationsBell
// chip) rendered "1 234,56" on ru-RU browsers and risked hydration mismatches.
// Non-finite input renders as an em-dash, matching fmtDate's null convention.
// UI convention: integers drop the cents ("$1,290"), fractions always show two
// ("$12.50"). Never emits a sign — callers prepend their own − where needed.
export function money(n: number | string) {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const s = Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

// Ledger-grade documents (invoice PDF) always show cents: "$129.00".
export function money2dp(n: number | string) {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
