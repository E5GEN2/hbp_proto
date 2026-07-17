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
