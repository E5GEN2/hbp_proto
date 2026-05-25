export function money(n: number | string) {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (Number.isInteger(v)) return `$${v}`;
  return `$${v.toFixed(2)}`;
}

export function moneySigned(n: number | string) {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v >= 0) return `+${money(v)}`;
  return `−${money(-v)}`;
}
