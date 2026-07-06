// Transactional email via the Resend REST API. Deliberately no SDK — this
// environment has no local Node toolchain to refresh pnpm-lock, and the API
// is a single POST.
//
// RESEND_API_KEY unset → sendEmail() logs and reports false. Callers must
// treat "not sent" as non-fatal: email never blocks a payment or an order.
// The one flow that REQUIRES email (password reset) checks emailEnabled()
// up front and tells the user recovery is unavailable instead of pretending.

import { appUrl } from './app-url';

const RESEND_API = 'https://api.resend.com/emails';

export function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress() {
  return process.env.EMAIL_FROM ?? 'Comet Proxy <no-reply@odatai.com>';
}

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  if (!emailEnabled()) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${input.subject}" → ${input.to}`);
    return false;
  }
  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[email] Resend ${r.status} for "${input.subject}" → ${input.to}: ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[email] send failed for "${input.subject}" → ${input.to}`, e);
    return false;
  }
}

// ── Templates ────────────────────────────────────────────────────────────────
// Single-column inline-styled HTML — renders the same in Gmail/Outlook/Apple
// Mail. Brand: Comet Proxy wordmark, soft-gold accent from the site palette.

const GOLD = '#B58A4A';
const INK = '#0A0F1D';

function shell(title: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f2ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="padding:0 8px 18px;">
    <span style="font:700 17px/1 Arial,Helvetica,sans-serif;color:${INK};letter-spacing:.4px;">COMET</span>
    <span style="font:700 17px/1 Arial,Helvetica,sans-serif;color:${GOLD};letter-spacing:.4px;">&nbsp;PROXY</span>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #e6e1d8;border-radius:12px;padding:32px;">
    <div style="font:700 19px/1.35 Arial,Helvetica,sans-serif;color:${INK};margin-bottom:14px;">${title}</div>
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:18px 8px 0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:#8a8477;">
    Need help? Message support on <a href="https://t.me/US5Gwetrust" style="color:${GOLD};">Telegram</a>.<br>
    You received this email because of activity on your Comet Proxy account.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function p(text: string) {
  return `<div style="font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#3d3a33;margin:0 0 14px;">${text}</div>`;
}

function cta(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 14px;"><tr>
<td style="background:${INK};border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:12px 26px;font:600 14px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

export function passwordResetEmail(link: string) {
  return {
    subject: 'Reset your Comet Proxy password',
    html: shell(
      'Reset your password',
      p('We received a request to reset the password for your Comet Proxy account. Click the button below to choose a new one.') +
      cta('Set new password', link) +
      p(`This link expires in <strong>60 minutes</strong> and can be used once. If the button doesn't work, copy this address into your browser:<br><a href="${link}" style="color:${GOLD};word-break:break-all;">${link}</a>`) +
      p('If you didn’t request this, you can safely ignore this email — your password stays unchanged.'),
    ),
    text: `Reset your Comet Proxy password: ${link}\nThe link expires in 60 minutes. If you didn't request this, ignore this email.`,
  };
}

export function welcomeEmail(name: string) {
  return {
    subject: 'Welcome to Comet Proxy',
    html: shell(
      `Welcome, ${name}!`,
      p('Your Comet Proxy account is ready. Order mobile proxies, manage credentials and track renewals from your dashboard.') +
      cta('Open dashboard', appUrl('/dashboard')) +
      p('Questions? Our support team is one message away on Telegram.'),
    ),
    text: `Welcome to Comet Proxy, ${name}! Your account is ready: ${appUrl('/dashboard')}`,
  };
}

export function orderPaidEmail(orderId: string, active: boolean) {
  return {
    subject: `Payment received — order ${orderId}`,
    html: shell(
      'Payment received',
      p(`Your crypto payment for order <strong>${orderId}</strong> is confirmed.`) +
      p(active
        ? 'Your proxies are active — credentials are available on the order page.'
        : 'Our team is preparing your proxies. Typical delivery is within 24 hours — we’ll notify you the moment they’re live.') +
      cta('View order', appUrl(`/orders/${orderId}`)),
    ),
    text: `Payment for order ${orderId} confirmed. ${active ? 'Your proxies are active.' : 'Provisioning is in progress.'} ${appUrl(`/orders/${orderId}`)}`,
  };
}

export function orderRenewedEmail(orderId: string, newExpiry: string) {
  return {
    subject: `Order ${orderId} renewed`,
    html: shell(
      'Order renewed',
      p(`Your renewal payment is confirmed. Order <strong>${orderId}</strong> now runs until <strong>${newExpiry}</strong>.`) +
      cta('View order', appUrl(`/orders/${orderId}`)),
    ),
    text: `Order ${orderId} renewed — new expiry ${newExpiry}. ${appUrl(`/orders/${orderId}`)}`,
  };
}

export function autoRenewedEmail(orderId: string, newExpiry: string, via: string) {
  return {
    subject: `Order ${orderId} auto-renewed`,
    html: shell(
      'Order auto-renewed',
      p(`Your order <strong>${orderId}</strong> was renewed automatically (${via}). It now runs until <strong>${newExpiry}</strong>.`) +
      cta('View order', appUrl(`/orders/${orderId}`)),
    ),
    text: `Order ${orderId} auto-renewed (${via}) — new expiry ${newExpiry}. ${appUrl(`/orders/${orderId}`)}`,
  };
}

export function autoRenewFailedGraceEmail(orderId: string, graceEnd: string, reason: string) {
  return {
    subject: `Action needed — auto-renew failed for ${orderId}`,
    html: shell(
      'Auto-renew failed',
      p(`We couldn’t renew order <strong>${orderId}</strong> automatically: ${reason}.`) +
      p(`Your proxies <strong>keep working until ${graceEnd}</strong>. Top up your balance and we’ll retry, or renew manually from the order page.`) +
      cta('Renew now', appUrl(`/orders/${orderId}`)),
    ),
    text: `Auto-renew failed for ${orderId}: ${reason}. Proxies keep working until ${graceEnd} — top up your balance or renew manually: ${appUrl(`/orders/${orderId}`)}`,
  };
}

export function autoRenewFailedExpiredEmail(orderId: string) {
  return {
    subject: `Order ${orderId} expired — auto-renew could not complete`,
    html: shell(
      'Order expired',
      p(`We couldn’t renew order <strong>${orderId}</strong> automatically and its term has ended.`) +
      p('You can renew it manually from the order page — your configuration is preserved.') +
      cta('Renew order', appUrl(`/orders/${orderId}`)),
    ),
    text: `Order ${orderId} expired — auto-renew could not complete. Renew manually: ${appUrl(`/orders/${orderId}`)}`,
  };
}

export function depositConfirmedEmail(amount: string, newBalance: string) {
  return {
    subject: 'Balance top-up confirmed',
    html: shell(
      'Top-up confirmed',
      p(`Your crypto deposit of <strong>${amount}</strong> is confirmed. New balance: <strong>${newBalance}</strong>.`) +
      cta('View billing', appUrl('/billing')),
    ),
    text: `Deposit of ${amount} confirmed. New balance: ${newBalance}. ${appUrl('/billing')}`,
  };
}
