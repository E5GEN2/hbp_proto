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
// -50 → silent 150% overcharge).
export function assertNewOrderBounds(qty: number, discountPct: number) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
    throw new Error('Quantity must be an integer between 1 and 100');
  }
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error('Discount must be an integer between 0 and 100');
  }
}

// Custom expiry: instant methods only (the term is anchored at creation; for
// crypto/invoice the clock starts at payment confirmation, so an absolute date
// set now would be meaningless — or already past — by then). Bounds: strictly
// after `now`, strictly before now + plan.durationDays.
export function resolveCustomExpiry(
  expiresAt: string | null | undefined,
  method: NewOrderMethod,
  durationDays: number,
  now: Date,
): Date | null {
  if (!expiresAt) return null;
  if (!isInstantMethod(method)) {
    throw new Error('Custom expiry is only available for instantly-confirmed orders (Comp / Stripe) — for awaiting payments the term starts when the payment confirms');
  }
  const parsed = new Date(expiresAt);
  if (isNaN(parsed.getTime())) throw new Error('Invalid expiry date');
  const planEnd = now.getTime() + durationDays * 86_400_000;
  if (parsed.getTime() <= now.getTime()) throw new Error('Expiry must be in the future');
  if (parsed.getTime() >= planEnd) {
    throw new Error(`Expiry must be within the plan term — before ${fmtDate(new Date(planEnd))} (${durationDays}d plan)`);
  }
  return parsed;
}

// Money: comp is free — the money columns must say so ($0 order/payment/
// invoice), not book full list price as revenue. Cent-round the discounted
// price like renewal.ts / auto-renew.ts. The (mock) Stripe rail books a 3%
// processor fee; net = gross − fees (net==gross with a fee booked overstated
// card revenue — audit find).
export function newOrderMoney(planPrice: number, discountPct: number, qty: number, method: NewOrderMethod) {
  const unitPrice = method === 'comp' ? 0 : roundCents(planPrice * (1 - discountPct / 100));
  const total = roundCents(unitPrice * qty);
  const fees = method === 'stripe' ? roundCents(total * 0.03) : 0;
  return { unitPrice, total, fees, net: roundCents(total - fees) };
}
