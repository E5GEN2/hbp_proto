import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { npVerifySignature } from '@/lib/nowpayments';
import { npGetPayment } from '@/lib/np-api';
import { settleAwaitingPayment, failAwaitingPayment } from '@/lib/settle-payment';
import { sendAdminTelegram, adminCryptoAttentionAlert, adminIpnMismatchAlert } from '@/lib/telegram';
import { appUrl } from '@/lib/app-url';
import { hitRateLimit, clientIp } from '@/lib/rate-limit';
import { classifyIpn, resolveIpnAction, type PaymentPhase } from '@/lib/crypto-window';

export const dynamic = 'force-dynamic';

// Amount fields of whichever record we trust for the event — the API's when
// it was fetched, otherwise the IPN's.
type Amounts = { actually_paid?: unknown; pay_currency?: unknown; pay_amount?: unknown };

// Flood bounds (review find): NOWPayments itself sends a handful of IPNs per
// payment from a few IPs, so a signed flood can only come from a leaked
// secret. Per-IP cap on the route; per-payment caps on the evidence rows and
// on the Telegram ping (in-memory, synchronous — no findFirst/create race).
const IPN_IP_LIMIT = 60;              // per minute
const NOTE_ROWS_PER_HOUR = 5;         // PAYMENT.IPN_MISMATCH / IPN_STALE rows per payment
const HOUR_MS = 60 * 60 * 1000;

// Money arrived but the charge won't auto-settle (underpaid, or funds hit an
// expired/failed charge) — push the exact payment to the ops chat so support
// acts from Telegram instead of hunting in the NOWPayments dashboard. Best-
// effort: a lookup/send failure must never fail the IPN ack.
async function alertAdminAttention(paymentId: string, reason: string, amt: Amounts) {
  try {
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { orderId: true, client: { select: { id: true, name: true } } },
    });
    if (!p) return;
    const cur = String(amt?.pay_currency ?? '').toUpperCase();
    await sendAdminTelegram(adminCryptoAttentionAlert({
      paymentId,
      reason,
      clientName: p.client?.name ?? p.client?.id ?? '—',
      clientId: p.client?.id ?? '—',
      received: `${amt?.actually_paid ?? '?'} ${cur}`.trim(),
      expected: `${amt?.pay_amount ?? '?'} ${cur}`.trim(),
      orderRef: p.orderId ?? 'balance top-up',
      adminUrl: appUrl(`/admin/payments/${paymentId}`),
    }));
  } catch (e) {
    console.warn(`[nowpayments] admin attention alert failed for ${paymentId}`, e);
  }
}

// Two different things an IPN can disagree with the API about:
//  • suspicious — the IPN asked for a state change the charge does not
//    support at all (a forged event from a leaked secret, a replay, or a
//    charge that is not ours). Nothing is acted on; PAYMENT.IPN_MISMATCH row
//    + one Telegram ping per payment per hour ("someone holds the secret").
//  • stale — the IPN is merely behind or ahead of NOWPayments' record (the
//    routine "charge expired, then the transfer confirmed" shape, or an
//    out-of-order retry). We act on the API; PAYMENT.IPN_STALE row, no ping.
// Rows are capped per payment per hour so a flood cannot grow the table.
async function noteIpn(kind: 'suspicious' | 'stale', paymentId: string, ipnStatus: string, apiStatus: string, detail: string) {
  const action = kind === 'suspicious' ? 'PAYMENT.IPN_MISMATCH' : 'PAYMENT.IPN_STALE';
  if (hitRateLimit(`ipn-note:${action}:${paymentId}`, NOTE_ROWS_PER_HOUR, HOUR_MS) === 0) {
    await prisma.log.create({ data: { actorId: null, action, objectType: 'PAYMENT', objectId: paymentId, detail } });
  } else {
    console.warn(`[nowpayments] ${action} for ${paymentId} suppressed (>${NOTE_ROWS_PER_HOUR}/h): ${detail}`);
  }
  if (kind === 'suspicious' && hitRateLimit(`ipn-ping:${paymentId}`, 1, HOUR_MS) === 0) {
    await sendAdminTelegram(adminIpnMismatchAlert({ paymentId, ipnStatus, apiStatus, adminUrl: appUrl(`/admin/payments/${paymentId}`) }));
  }
}

// NOWPayments IPN. Authenticated by HMAC signature — no session. order_id on
// the invoice carries our payment id (PAY-#####), so settlement is a lookup.
// Non-2xx responses make NOWPayments retry, so transient errors return 500
// and permanently irrelevant events return 200.
//
// IPN = trigger, API = truth (Railway incident 2026-10-21 follow-up). The HMAC
// only proves the sender holds the IPN secret — which an environment leak can
// hand to anyone. So whenever an IPN would change anything we hold about the
// charge — payment state, or even the npStatus mirror the client's pay panel
// renders — NOWPayments' own record of the charge (GET /payment/{id}, API-key
// auth) is fetched and ITS status is what gets acted on and mirrored. Policy
// table: resolveIpnAction (unit-tested).
export async function POST(req: Request) {
  if (!process.env.NOWPAYMENTS_IPN_SECRET) {
    return NextResponse.json({ error: 'IPN not configured' }, { status: 503 });
  }

  const raw = await req.text();
  if (!npVerifySignature(raw, req.headers.get('x-nowpayments-sig'))) {
    console.warn('[nowpayments] IPN with bad/missing signature rejected');
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }
  // Signed requests only count toward the cap — a legitimate burst (retries
  // after an outage) is far below it, and a 429 just makes NOWPayments retry.
  const wait = hitRateLimit(`ipn:ip:${clientIp(req)}`, IPN_IP_LIMIT, 60_000);
  if (wait > 0) {
    console.warn(`[nowpayments] IPN flood from ${clientIp(req)} — throttled for ${wait}s`);
    return NextResponse.json({ error: 'Too many IPNs' }, { status: 429 });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }

  const paymentId = String(evt?.order_id ?? '');
  const status = String(evt?.payment_status ?? '');
  if (!paymentId.startsWith('PAY-')) {
    console.warn(`[nowpayments] IPN ignored — unrecognized order_id "${paymentId}" (status=${status})`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  // The row is read ONCE: its status is the classifier's `before`, externalRef
  // is the NOWPayments charge we hold for it, and npStatus dedups the
  // underpaid alert across NOWPayments' repeated IPNs for the same event.
  const before = await prisma.payment.findUnique({
    where: { id: paymentId }, select: { status: true, npStatus: true, provider: true, externalRef: true },
  });
  if (!before) {
    console.warn(`[nowpayments] IPN ignored — no payment ${paymentId} (status=${status})`);
    return NextResponse.json({ ok: true, ignored: true });
  }
  const phase = before.status as PaymentPhase;
  const ipnPaid = Number(evt?.actually_paid);
  const ipn = { status, fundsArrived: Number.isFinite(ipnPaid) && ipnPaid > 0 };

  try {
    const asked = classifyIpn(ipn.status, ipn.fundsArrived, phase);

    // A retry of an already-settled charge has nothing left to verify.
    if (asked === 'settle' && before.status === 'CONFIRMED') {
      return NextResponse.json({ ok: true, already: true });
    }

    const hasCharge = before.provider === 'NOWPayments' && !!before.externalRef;

    // The IPN names the NOWPayments charge it is about (payment_id). It must
    // be the charge we hold for this payment — a forger would have to know
    // our externalRef, and this costs no API call.
    if (hasCharge && evt?.payment_id != null && String(evt.payment_id) !== before.externalRef) {
      await noteIpn('suspicious', paymentId, status, '—',
        `IPN carries payment_id ${String(evt.payment_id).slice(0, 40)} but the charge on file is ${before.externalRef} — ignored`);
      return NextResponse.json({ ok: true, ignored: 'charge_mismatch' });
    }

    // Anything that would change what we hold — payment state, or the
    // npStatus mirror the pay panel renders — is checked against the API.
    const wantsApi = asked !== 'noop' || status !== (before.npStatus ?? '');
    let np: Record<string, any> | null = null;
    if (wantsApi) {
      if (!hasCharge) {
        await noteIpn('suspicious', paymentId, status, '—',
          `IPN said ${status} but ${paymentId} has no NOWPayments charge on file (provider ${before.provider}) — ignored`);
        return NextResponse.json({ ok: true, ignored: 'no_charge' });
      }
      np = await npGetPayment(before.externalRef!);
      // The charge we hold must be the one NOWPayments bills to this payment
      // id — anything else is a data mix-up and nothing to act on.
      if (np && np.order_id != null && String(np.order_id) !== paymentId) {
        await noteIpn('suspicious', paymentId, status, String(np.payment_status ?? '?'),
          `NOWPayments charge ${before.externalRef} carries order_id ${String(np.order_id)}, not ${paymentId} — ignored`);
        return NextResponse.json({ ok: true, ignored: 'charge_mismatch' });
      }
    }
    // An answer without a status is no answer (the reconciler skips those too).
    const apiStatus = np ? String(np.payment_status ?? '') : '';
    const apiPaid = Number(np?.actually_paid);
    const apiFunds = Number.isFinite(apiPaid) && apiPaid > 0;
    const api = np && apiStatus ? { status: apiStatus, fundsArrived: apiFunds } : null;
    const verdict = resolveIpnAction(ipn, api, phase);

    if (verdict.unverified) {
      // No API answer (outage, key missing or mid-rotation). Acting on the
      // IPN's word alone is exactly the hole this closes: a 500 makes
      // NOWPayments retry, and the 5-minute reconciler (np-reconcile) settles
      // from the API regardless — money is delayed, never lost, never faked.
      console.warn(`[nowpayments] IPN ${status} for ${paymentId} not verifiable against the API right now — not acting`);
      return NextResponse.json({ error: 'Unverified — NOWPayments API unavailable' }, { status: 500 });
    }
    if (wantsApi && !api) {
      // Informational IPN whose mirror could not be confirmed: nothing to
      // retry for, the reconciler mirrors the real status on its next tick.
      return NextResponse.json({ ok: true, status: before.npStatus ?? null, unverified: true });
    }

    // Mirror ONLY an API-confirmed status onto the row (display-only —
    // settlement keys off our own payment.status). A forged "expired" or
    // "confirming" can no longer swap the client's live pay address for the
    // recovery screen or fake a "payment detected".
    if (api && api.status !== before.npStatus) {
      await prisma.payment.updateMany({ where: { id: paymentId }, data: { npStatus: api.status } });
    }

    if (verdict.mismatch) {
      const what = `IPN said ${status}${ipn.fundsArrived ? ' with funds' : ''} but NOWPayments says ${apiStatus}${apiFunds ? ' with funds' : ''}`;
      if (verdict.action === 'noop') {
        await noteIpn('suspicious', paymentId, status, apiStatus, `${what} — the charge supports no state change; ignored`);
      } else {
        await noteIpn('stale', paymentId, status, apiStatus, `${what} — acting on the API (${verdict.action})`);
      }
    }

    const truth = api ? api.status : status; // the status named in log lines and alerts
    const amt: Amounts = np ?? evt;

    switch (verdict.action) {
      case 'settle': {
        // finished = funds fully received and settled at NP. resurrectFailed: a
        // charge we already failed locally (window expired then paid, or the
        // client paid a regenerated-away address) still settles — the money is
        // on-chain; idempotency must not swallow it. If the order meanwhile
        // settled via a newer charge, the renewal branch just extends the term.
        const result = await settleAwaitingPayment(paymentId, 'NOWPayments IPN', { resurrectFailed: true });
        return NextResponse.json(result);
      }
      case 'manual_review': {
        // Funds landed on a charge that died (expired/failed with funds, or a
        // partial on an already-dead charge) — the money is REAL. Park it in
        // MANUAL_REVIEW for a durable admin surface (awaiting-payments bell +
        // MarkPaid) independent of Telegram, and alert. Accepted from AWAITING
        // *and* the locally-dead states: under the ~10-min window "charge
        // expired, then the transfer confirmed" is the routine late shape, and
        // the charge may already be FAILED (repay/failed-IPN) or CANCELLED (72h
        // sweep). The guarded updateMany is both the race guard and the dedup —
        // only the real flip logs and alerts; IPN retries no-op.
        const flipped = await prisma.payment.updateMany({
          where: { id: paymentId, status: { in: ['AWAITING', 'FAILED', 'CANCELLED'] } },
          data: { status: 'MANUAL_REVIEW' },
        });
        if (flipped.count > 0) {
          await prisma.log.create({
            data: {
              actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
              detail: `NOWPayments IPN: charge ${truth} but funds arrived — received ${amt?.actually_paid ?? '?'} ${amt?.pay_currency ?? ''} of expected ${amt?.pay_amount ?? '?'} → manual review`,
            },
          });
          await alertAdminAttention(paymentId, `charge ${truth} but funds arrived`, amt);
          return NextResponse.json({ ok: true, noted: 'manual_review' });
        }
        return NextResponse.json({ ok: true, already: true });
      }
      case 'fail': {
        // A real NP failure ('failed') or a refund — fail the AWAITING charge.
        // NOTE: 'expired' with no funds does NOT reach here (classifyIpn → noop):
        // the account force-expires every fixed-rate charge at ~10 min, so
        // failing an expired-no-funds charge punished normal wallet latency with
        // a FAILED row + alarming bell (the 2026-08-10 PAY-48127/74487 incident).
        // Such a charge stays AWAITING — the panel offers a fresh address and the
        // 72h sweep is the one reaper — unifying policy with the reconciler.
        const result = await failAwaitingPayment(paymentId, `${truth} (NOWPayments IPN)`);
        return NextResponse.json(result);
      }
      case 'underpaid_alert': {
        // Underpaid on a still-live AWAITING charge: the client may send the
        // remainder — no state change, but a human should know. Log + ops
        // Telegram, deduped on the first partially_paid IPN (NP re-sends it).
        const firstTime = before.npStatus !== 'partially_paid';
        if (firstTime) {
          await prisma.log.create({
            data: {
              actorId: null, action: 'PAYMENT.PARTIAL', objectType: 'PAYMENT', objectId: paymentId,
              detail: `NOWPayments IPN: partially paid — received ${amt?.actually_paid ?? '?'} ${amt?.pay_currency ?? ''} of expected ${amt?.pay_amount ?? '?'}`,
            },
          });
          await alertAdminAttention(paymentId, 'underpaid (rate drift / late payment)', amt);
        }
        return NextResponse.json({ ok: true, noted: 'partially_paid', firstTime });
      }
      case 'noop':
      default:
        // waiting / confirming / confirmed / sending / expired-no-funds (open
        // cart) — nothing to do; the API-confirmed status is mirrored above.
        return NextResponse.json({ ok: true, status: truth, ...(verdict.mismatch ? { mismatch: true } : {}) });
    }
  } catch (e: any) {
    console.error(`[nowpayments] IPN processing failed for ${paymentId} (${status})`, e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
