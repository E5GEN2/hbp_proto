// Pure crypto-payment-window logic — no React, so it unit-tests standalone and
// both the pay panel and any server code can share one source of truth about
// what "the window lapsed" means.
//
// Window reality (2026-08-12): floating-rate charges live ~7 days
// (payment.payExpiresAt = NP valid_until). Sending is_fee_paid_by_user:true
// silently converts a charge to FIXED rate with a 10-MINUTE window (the
// 2026-08-10 incident) — nowpayments.ts must never re-add it. Everything here
// treats the window length as data, so both regimes stay handled: at the
// window NP kills the charge and later funds land on a dead charge
// (→ MANUAL_REVIEW). These helpers drive the pay panel's phase without ever
// telling the client a dead address is still live.

// Transfer visibly in flight at NP — the window no longer matters for it.
export function transferDetected(npStatus: string | null): boolean {
  return npStatus === 'confirming' || npStatus === 'confirmed' || npStatus === 'sending' || npStatus === 'partially_paid';
}

// The SERVER says the window closed — a mirrored npStatus 'expired'/'failed'.
// This is the ONLY signal that may REPLACE the pay view with the recovery
// screen. The local clock must never do that on its own: a client clock set
// more than the ~10-min window fast would render the panel already-lapsed at
// mount and permanently hide the address (audit C15). The server clock is
// authoritative for "the charge is actually dead"; repay likewise has no
// server-clock gate.
export function serverWindowClosed(npStatus: string | null): boolean {
  if (transferDetected(npStatus)) return false;
  return npStatus === 'expired' || npStatus === 'failed';
}

// The LOCAL countdown has reached zero but the server hasn't confirmed death
// yet. We keep the address on screen (the charge may still be live — a fast
// clock, or the expired IPN just hasn't landed) and only surface an inline
// "get a fresh address" affordance. Never hides the address.
export function localWindowPassed(npStatus: string | null, msLeft: number | null): boolean {
  if (transferDetected(npStatus)) return false;
  if (serverWindowClosed(npStatus)) return false;
  return msLeft != null && msLeft <= 0;
}

// A "long" window carries no time pressure worth narrating. Floating-rate
// charges live ~7 days (valid_until) — counting that down ("10080:00") would
// manufacture urgency where none exists. Anything above this threshold hides
// the countdown line entirely; the threshold stays low enough that a
// regression to the 10-minute fixed-rate window (the is_fee_paid_by_user
// trap) would immediately show the countdown again.
export const LONG_WINDOW_MS = 2 * 3_600_000; // 2h

// Show the countdown: every coin, while the charge is live, nothing is
// detected yet, AND the window is short enough to matter. 'waiting' must NOT
// hide it (NP 'waiting' = "no transfer seen"; the reconciler mirrors npStatus
// onto open payments within minutes).
export function showWindowCountdown(npStatus: string | null, msLeft: number | null): boolean {
  if (transferDetected(npStatus)) return false;
  if (npStatus === 'expired' || npStatus === 'failed') return false;
  return msLeft != null && msLeft > 0 && msLeft <= LONG_WINDOW_MS;
}

export function statusLine(npStatus: string | null): { text: string; warn?: boolean } {
  switch (npStatus) {
    case 'confirming': return { text: 'Payment detected — confirming on the network…' };
    case 'confirmed':
    case 'sending': return { text: 'Confirmed — finalizing your payment…' };
    // No remainder amount is shown because none is known client-side: with
    // multi-day floating windows the on-screen pay_amount is a stale quote, so
    // "send the remaining balance" next to the FULL original amount invited a
    // double-pay (review 2026-08-12). Support reconciles; the admin was
    // already alerted by the underpaid branch.
    case 'partially_paid': return { text: 'Partial amount received — don’t resend the full amount. Support has been notified; message us to settle the difference.', warn: true };
    default: return { text: 'Waiting for your transfer…' };
  }
}

export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  // Roll hours out separately — the countdown can now start at 2:00:00 (the
  // LONG_WINDOW_MS ceiling); "120:00" read as two minutes at a glance.
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Classify a webhook/reconcile IPN into the settlement action our policy takes.
// Pure mirror of the route/reconciler branch order, extracted so the money
// policy is unit-testable without a DB. `beforeStatus` is the payment row's
// status just before we act (null = unknown/never-seen id).
export type PaymentPhase = 'AWAITING' | 'FAILED' | 'CANCELLED' | 'MANUAL_REVIEW' | 'CONFIRMED' | 'OTHER' | null;
export type IpnAction = 'settle' | 'manual_review' | 'fail' | 'underpaid_alert' | 'noop';

// Which locally-dead payment statuses a caller-authorised settle may revive.
// The money is on-chain in every one of these; NP has no cancel API, so a
// charge stays payable ~7 days no matter how WE labelled it. CONFIRMED is
// absent (already settled — reviving would double-credit) and so is AWAITING
// (that is the normal path, not a resurrection).
export const RESURRECTABLE_STATUSES = ['FAILED', 'MANUAL_REVIEW', 'CANCELLED'] as const;

export function isResurrectable(status: string | null | undefined): boolean {
  return (RESURRECTABLE_STATUSES as readonly string[]).includes(status ?? '');
}

export function classifyIpn(status: string, fundsArrived: boolean, beforeStatus: PaymentPhase): IpnAction {
  if (status === 'finished') return 'settle';
  if (status === 'failed' || status === 'expired' || status === 'refunded') {
    if (status !== 'refunded' && fundsArrived &&
        (beforeStatus === 'AWAITING' || beforeStatus === 'FAILED' || beforeStatus === 'CANCELLED')) {
      return 'manual_review';
    }
    if (status === 'expired') return 'noop'; // open cart — the 72h sweep is the reaper
    return 'fail'; // real NP failure / refunded → fail the AWAITING charge
  }
  if (status === 'partially_paid') {
    if (beforeStatus === 'FAILED' || beforeStatus === 'CANCELLED') return 'manual_review';
    return 'underpaid_alert';
  }
  return 'noop'; // waiting / confirming / confirmed / sending
}
