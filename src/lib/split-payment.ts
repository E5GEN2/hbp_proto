// Split payment (owner decision 2026-08-27, approach B): the client pays part
// of an order from their balance and tops up the shortfall via crypto. The
// crypto top-up is floored at the crypto minimum, so a small shortfall (or a
// sub-minimum order) still clears NOWPayments — any overshoot beyond the
// shortfall simply stays on the client's balance after the order is paid.
// One helper, three consumers (checkout UI + both server split paths), so the
// displayed top-up always equals the charged one.

const round2 = (n: number) => Math.round(n * 100) / 100;

// The crypto top-up to charge: the shortfall (total − balance) floored at
// `minUsd`. Assumes a PARTIAL balance (0 < balance < total) — the caller gates
// on that; with balance ≥ total there is no shortfall and split is not offered.
export function splitTopupAmount(total: number, balance: number, minUsd: number): number {
  const shortfall = round2(total - balance);
  return Math.max(shortfall, minUsd);
}

// The part of the order the client's existing balance covers = total − topup.
// When the top-up overshoots (shortfall floored up to the minimum), this is
// LESS than the full balance and the difference stays as leftover balance.
export function splitFromBalance(total: number, topup: number): number {
  return round2(total - topup);
}
