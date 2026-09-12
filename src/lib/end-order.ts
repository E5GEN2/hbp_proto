// "End order now" — the admin's clock-independent version of what the sweep
// does on its own at grace end (sweep.ts step 1 → 1b): a PAST-DUE order ends
// as EXPIRED and its proxies return to the pool right away. Owner ask
// 2026-09-05 (ORD-21399): until now the only way to finish an expired order
// early was Suspend → Cancel, which showed the client the wrong status AND
// broke the lifecycle — the sweep only walks ACTIVE/EXPIRED, so a SUSPENDED
// order kept its proxy bound forever (capacity lost, no security reset).
//
// This module holds the PURE parts — the eligibility gate (shared by the
// server transition and the admin page so button visibility and refusal can
// never diverge), the write plan and the client copy — so the test suite can
// pin every boundary and branch without a database.

import type { OrderException, OrderStatus } from '@prisma/client';

// ACTIVE    = grace form A (auto-renew retrying; the order stays ACTIVE past due)
// EXPIRED   = grace form B (expired; proxies stay bound until grace end)
// SUSPENDED = the rescue of the old Suspend → Cancel workaround
export const END_ORDER_NOW_STATUSES: OrderStatus[] = ['ACTIVE', 'EXPIRED', 'SUSPENDED'];

// The admin reason is audited free text fanned out to every released
// assignment row and the log line — bounded so it stays readable there.
export const END_ORDER_REASON_MAX = 500;

export type EndOrderNowInput = {
  status: OrderStatus;
  expiresAt: Date | null;
  // Open assignments (releasedAt null) — what the action would release.
  liveAssignments: number;
  // exception RENEWAL_NOT_EXTENDED: a paid renewal never advanced the expiry —
  // the client bought a term they have not received; ending is refused.
  renewalNotExtended?: boolean;
};

export type EndOrderNowGate = { ok: true } | { ok: false; reason: string };

// Past-due only (expiresAt <= now — the sweep's own `lte` due test). Before
// expiry, ending an order is a CANCEL with a refund question; after it the term
// simply ran out and no refund signal is raised.
export function endOrderNowGate(o: EndOrderNowInput, nowMs: number): EndOrderNowGate {
  if (!END_ORDER_NOW_STATUSES.includes(o.status)) {
    return { ok: false, reason: `Only a past-due Active, Expired (in grace) or Suspended order can be ended — this one is ${o.status.toLowerCase().replace(/_/g, ' ')}.` };
  }
  if (!o.expiresAt) {
    return { ok: false, reason: 'This order has no term to end — it was never activated.' };
  }
  if (o.expiresAt.getTime() > nowMs) {
    return { ok: false, reason: 'This order is not past due yet — cancel it instead (the refund question applies before expiry).' };
  }
  if (o.renewalNotExtended) {
    return { ok: false, reason: 'A paid renewal has not been applied to this order (Renewal paid, not extended) — extend it to the paid period first.' };
  }
  // An EXPIRED order whose proxies are already back in the pool is the end
  // state itself — nothing left to end (hides the button, refuses the call).
  if (o.status === 'EXPIRED' && o.liveAssignments === 0) {
    return { ok: false, reason: 'Already ended — this order is expired and its proxies were released.' };
  }
  return { ok: true };
}

// ── What the transaction writes besides the release ─────────────────────────

// Provisioning duties die with the term: nothing is left to assign or replace,
// and nothing could clear them on an EXPIRED order (the sweep leaves them
// stale). A refund case (REFUND_PENDING) stays with finance; a paid-but-not-
// applied renewal (RENEWAL_NOT_EXTENDED) is refused by the gate instead.
export const DUTY_EXCEPTIONS: OrderException[] = ['PAID_NOT_PROVISIONED', 'REPLACEMENT_PENDING', 'RENEWAL_FAULTY_PROXY'];

export type EndOrderPlanInput = {
  status: OrderStatus;
  autoRenew: boolean;
  autoRenewBeforeSuspend: boolean | null;
  exception: OrderException | null;
};

export type EndOrderPlan = {
  // The client's PREFERENCE survives, exactly as through a sweep expiry (step 1
  // never writes autoRenew): it cannot fire on an EXPIRED order (auto-renew and
  // the top-up retry target ACTIVE only) and applies again to the next term
  // once the client renews. The SUSPENDED rescue restores what the suspension
  // parked, the way Resume would.
  autoRenew: boolean;
  autoRenewRestored: boolean;
  clearDuty: boolean;
  // Client channels beyond the portal bell. Form A (ACTIVE + auto-renew): the
  // sweep's own give-up sends the transactional service-loss email and the
  // client holds an emailed "keeps working until <grace end>" promise that
  // this action cuts short — parity demands the same email. The rescue gets
  // an incident notice like Resume sends (gated by emailIncidents). Form B:
  // bell only, like sweep 1b.
  emailMode: 'autoRenewExpired' | 'incident' | null;
  // The rescue closes an order whose suspension recorded a standing manual
  // upstream-rotation duty (the client may hold copied credentials) — the
  // duty carries over to the log and the confirm dialog; nothing automates it.
  rotationDuty: boolean;
};

export function endOrderPlan(o: EndOrderPlanInput): EndOrderPlan {
  const rescue = o.status === 'SUSPENDED';
  const autoRenew = rescue ? (o.autoRenewBeforeSuspend ?? false) : o.autoRenew;
  return {
    autoRenew,
    autoRenewRestored: rescue && autoRenew,
    clearDuty: o.exception !== null && DUTY_EXCEPTIONS.includes(o.exception),
    emailMode: o.status === 'ACTIVE' && o.autoRenew ? 'autoRenewExpired' : rescue ? 'incident' : null,
    rotationDuty: rescue,
  };
}

// The portal bell — the sweep's expiry wording; honest about whether anything
// was released here, and about the next step (Renew only while the grace clock
// still runs, otherwise the portal offers Buy again).
export function endOrderClientNotice(orderId: string, expiredOn: string, released: number, inGrace: boolean): string {
  const next = `${inGrace ? 'Renew' : 'Start a new order'} to get fresh proxies.`;
  return released > 0
    ? `Order ${orderId} expired on ${expiredOn} — its proxies were released. ${next}`
    : `Order ${orderId} expired on ${expiredOn}. ${next}`;
}
