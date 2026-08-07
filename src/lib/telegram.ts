// Telegram Bot API sender — REST via fetch, no SDK. Mirrors email.ts: without
// TELEGRAM_BOT_TOKEN every send is a silent no-op so flows never break.
//
// IMPORTANT: the Bot API cannot message a user by @handle — it needs the numeric
// chat_id the user's /start grants. We store User.telegramChatId once the client
// links their account through the bot (linking flow deferred). Until a client is
// linked, sends are skipped and the in-app bell remains the delivery channel.

export function telegramEnabled() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** Best-effort DM to a linked client. Returns true only on a confirmed send. */
export async function sendTelegram(chatId: string | null | undefined, text: string): Promise<boolean> {
  if (!chatId || !telegramEnabled()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      // Sends are awaited on hot paths (checkout response, IPN ack) — a hung
      // Telegram API must never stall them beyond a few seconds.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('[telegram] send failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[telegram] send error', e);
    return false;
  }
}

// A queued incident message, dispatched AFTER the DB transaction commits — an
// external HTTP call must never run inside prisma.$transaction (it would pin a
// connection, and a rolled-back tx must not leave a message already sent).
export type TelegramOutbox = { chatId: string | null; text: string }[];

export async function flushTelegram(outbox: TelegramOutbox): Promise<void> {
  if (outbox.length === 0) return;
  await Promise.allSettled(outbox.map(m => sendTelegram(m.chatId, m.text)));
}

/* ── Admin ops alerts ─────────────────────────────────────────────────
   Fixed ops chat (env TELEGRAM_ADMIN_CHAT_ID — the owner's alert chat, same
   bot as client DMs). Unlike client sends, no per-user linking is involved;
   without the env var every send is a silent no-op, like the rest of this
   module. */

export function adminTelegramEnabled() {
  return telegramEnabled() && !!process.env.TELEGRAM_ADMIN_CHAT_ID;
}

/** Best-effort alert to the admin ops chat. Never throws; bounded by the
    5s send timeout, so it cannot stall a checkout/IPN response. */
export async function sendAdminTelegram(text: string): Promise<boolean> {
  if (!adminTelegramEnabled()) return false;
  return sendTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, text);
}

// parse_mode is HTML — user-supplied strings (client names, plan names) must
// be escaped or a stray '<' kills the whole sendMessage call.
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Alert text for an order that just became paid (or comp-free) — the owner's
    "new order" signal. Built inside the tx, sent after commit. */
export function adminNewOrderAlert(o: {
  orderId: string;
  clientName: string;
  clientId: string;
  planName: string;
  qty: number;
  amount: string;          // preformatted (money())
  method: string;
  status: string;          // final order status after provisioning attempt
  assigned: number;        // proxies actually assigned in the same tx
  adminUrl: string;        // absolute link to /admin/orders/<id>
  via?: string;            // extra context: 'NOWPayments IPN', 'admin · comp', …
}) {
  const provisioned = o.status === 'ACTIVE'
    ? `ACTIVE (${o.assigned}/${o.qty} assigned)`
    : `${o.status} (${o.assigned}/${o.qty} assigned${o.assigned < o.qty ? ' — needs attention' : ''})`;
  return [
    `💰 <b>New paid order ${esc(o.orderId)}</b>`,
    `Client: ${esc(o.clientName)} (${esc(o.clientId)})`,
    `Plan: ${esc(o.planName)} · qty ${o.qty} · ${esc(o.amount)}`,
    `Method: ${esc(o.method)}${o.via ? ` · ${esc(o.via)}` : ''}`,
    `Status: ${esc(provisioned)}`,
    esc(o.adminUrl),
  ].join('\n');
}

/** Crypto payment that arrived but did NOT auto-settle — the "client paid a
    late/expired rate address, order stuck" case. Pushes the exact payment to
    the ops chat so nobody hunts for it in the NOWPayments dashboard. */
export function adminCryptoAttentionAlert(o: {
  paymentId: string;
  reason: string;          // 'underpaid' | 'charge expired with funds' | …
  clientName: string;
  clientId: string;
  received: string;        // e.g. '48.5 USDTTRC20' (may be '?')
  expected: string;        // e.g. '50 USDTTRC20'
  orderRef: string;        // ORD-… or 'balance top-up'
  adminUrl: string;        // absolute link to /admin/payments/<id>
}) {
  return [
    `⚠️ <b>Crypto payment needs review — ${esc(o.paymentId)}</b>`,
    `Reason: ${esc(o.reason)}`,
    `Client: ${esc(o.clientName)} (${esc(o.clientId)}) · ${esc(o.orderRef)}`,
    `Received ${esc(o.received)} of ${esc(o.expected)}`,
    `Confirm or refund here:`,
    esc(o.adminUrl),
  ].join('\n');
}
