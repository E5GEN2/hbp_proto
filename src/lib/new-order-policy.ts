// Pure policy for admin New Order (createOrderByAdmin) — input bounds, the
// custom-expiry rule, and the money math. Extracted from transitions.ts for
// standalone assertion tests, same pattern as crypto-window.ts / grace.ts.
import { roundCents } from './balance';
import { fmtDate } from './date';

export type NewOrderMethod = 'stripe' | 'invoice' | 'crypto' | 'comp';

// Instant methods self-confirm at creation; crypto/invoice await Mark paid.
export const isInstantMethod = (m: NewOrderMethod) => m === 'stripe' || m === 'comp';

// Server-side input bounds — the modal constrains these too, but HTML min/max
// don't stop typed values and the action is callable directly. An unclamped
// discount flips the price sign (150 → negative order/payment/invoice money;
// -50 → silent 150% overcharge). The $ discount (flat off the total) is the
// alternative to the % one — at most one may be non-zero, and it may never
// exceed the undiscounted total (that would go negative).
export function assertNewOrderBounds(
  qty: number, discountPct: number, discountUsd: number, planPrice: number,
) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
    throw new Error('Quantity must be an integer between 1 and 100');
  }
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error('Discount must be an integer between 0 and 100');
  }
  if (!Number.isFinite(discountUsd) || discountUsd < 0) {
    throw new Error('Discount amount must be ≥ $0');
  }
  if (Math.round(discountUsd * 100) !== discountUsd * 100) {
    throw new Error('Discount amount must be whole cents');
  }
  if (discountPct > 0 && discountUsd > 0) {
    throw new Error('Use either a percent discount or a $ discount, not both');
  }
  if (discountUsd > roundCents(planPrice * qty)) {
    throw new Error('Discount amount cannot exceed the order total');
  }
}

// Custom expiry: an absolute end date the admin sets at creation. Available for
// EVERY payment method (owner decision 2026-08-21 — the primary use case is
// recreating a paid-then-deleted order with its original end date, and real
// fulfilment is manual): if the order can't activate immediately, the date is
// PERSISTED (Order.customExpiresAt) and consumed at first activation. Bounds:
// strictly after `now`, strictly before now + plan.durationDays.
export function resolveCustomExpiry(
  expiresAt: string | null | undefined,
  _method: NewOrderMethod,
  durationDays: number,
  now: Date,
): Date | null {
  if (!expiresAt) return null;
  const parsed = new Date(expiresAt);
  if (isNaN(parsed.getTime())) throw new Error('Invalid expiry date');
  const planEnd = now.getTime() + durationDays * 86_400_000;
  if (parsed.getTime() <= now.getTime()) throw new Error('Expiry must be in the future');
  if (parsed.getTime() >= planEnd) {
    throw new Error(`Expiry must be within the plan term — before ${fmtDate(new Date(planEnd))} (${durationDays}d plan)`);
  }
  return parsed;
}

// The activation-time application of a persisted custom expiry. If the date is
// still in the future it becomes the order's expiresAt; if it passed while the
// order waited for payment/proxies, fall back to the full plan term from now
// (money-safe: automatic settle paths must never park or kill a paid order) —
// the caller logs the fallback. Manual Assign refuses instead (admin present).
export function applyCustomExpiry(
  customExpiresAt: Date | null,
  durationDays: number,
  now: Date,
): { expiresAt: Date; usedCustom: boolean; stale: boolean } {
  const fullTerm = new Date(now.getTime() + durationDays * 86_400_000);
  if (!customExpiresAt) return { expiresAt: fullTerm, usedCustom: false, stale: false };
  if (customExpiresAt.getTime() > now.getTime()) {
    return { expiresAt: customExpiresAt, usedCustom: true, stale: false };
  }
  return { expiresAt: fullTerm, usedCustom: false, stale: true };
}

// Money: comp is free — the money columns must say so ($0 order/payment/
// invoice), not book full list price as revenue. Cent-round the discounted
// price like renewal.ts / auto-renew.ts. The (mock) Stripe rail books a 3%
// processor fee; net = gross − fees (net==gross with a fee booked overstated
// card revenue — audit find).
// The $ discount comes off the TOTAL (not per unit): total = price×qty − $off,
// and unitPrice becomes the effective per-proxy price (total/qty, cent-rounded
// — unitPrice×qty may drift from total by a cent; `amount` is authoritative
// and unitPrice is never read back for money math).
export function newOrderMoney(
  planPrice: number, discountPct: number, discountUsd: number, qty: number, method: NewOrderMethod,
) {
  let total: number;
  let unitPrice: number;
  if (method === 'comp') {
    unitPrice = 0; total = 0;
  } else if (discountUsd > 0) {
    total = Math.max(0, roundCents(planPrice * qty - discountUsd));
    unitPrice = roundCents(total / qty);
  } else {
    unitPrice = roundCents(planPrice * (1 - discountPct / 100));
    total = roundCents(unitPrice * qty);
  }
  const fees = method === 'stripe' ? roundCents(total * 0.03) : 0;
  return { unitPrice, total, fees, net: roundCents(total - fees) };
}
