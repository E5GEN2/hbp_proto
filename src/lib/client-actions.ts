'use server';

import { guarded } from './action-guard';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { mockPaymentsAllowed, enabledProviders } from './runtime-flags';
import { npEnabled, npCreateInvoice } from './nowpayments';
import { sendEmail, passwordChangedEmail } from './email';
import { money } from './money';
import { nextPaymentId, nextInvoiceId } from './id';
import { appUrl } from './app-url';
import * as T from './transitions';

async function getClientUserId() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('Not signed in');
  if (session.user.role !== 'CLIENT') throw new Error('This action is for client accounts only');
  return session.user.id;
}

function bust() {
  revalidatePath('/dashboard');
  revalidatePath('/orders');
  revalidatePath('/proxies');
  revalidatePath('/billing');
  revalidatePath('/settings');
  // NOTE deliberately no '/admin' revalidation: these are CLIENT-only actions,
  // the Router Cache is per-browser (a client invalidating admin routes buys
  // nothing), and admin pages are fully dynamic anyway. Each revalidatePath
  // adds in-band work to the action response — the renew-redirect measured
  // ~12s with six of them.
}

export const clientCancelOrderAction = guarded(async function clientCancelOrderAction(orderId: string) {
  const clientId = await getClientUserId();
  const r = await T.clientCancelNewOrder({ orderId, clientId });
  bust();
  return r;
});

export const clientToggleAutoRenewAction = guarded(async function clientToggleAutoRenewAction(orderId: string, on: boolean) {
  const clientId = await getClientUserId();
  const r = await T.clientToggleAutoRenew({ orderId, clientId, on });
  bust();
  return r;
});

export const clientRequestRefundAction = guarded(async function clientRequestRefundAction(paymentId: string, reason: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRequestRefund({ paymentId, clientId, reason });
  bust();
  return r;
});

export const clientRequestReplacementAction = guarded(async function clientRequestReplacementAction(proxyId: string, reason: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRequestReplacement({ proxyId, clientId, reason });
  bust();
  return r;
});

export const clientRenewOrderAction = guarded(async function clientRenewOrderAction(orderId: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRenewOrder({ orderId, clientId });
  // The insufficient-balance branch only computes a checkout redirect — no DB
  // write happened, so skip revalidation entirely: the client is navigating
  // away and every busted path made them wait for it (~12s, audit follow-up).
  if (!('redirect' in r && r.redirect)) bust();
  return r;
});

export type ProfileSaveInput = {
  name?: string;
  telegram?: string | null;
  country?: string | null;
};

export const saveProfileAction = guarded(async function saveProfileAction(input: ProfileSaveInput) {
  const clientId = await getClientUserId();
  if (input.telegram && !/^@?[a-zA-Z0-9_]{5,32}$/.test(input.telegram)) {
    throw new Error('Telegram handle must be 5–32 chars, alphanumeric + underscore');
  }
  await prisma.user.update({
    where: { id: clientId },
    data: {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.telegram !== undefined && { telegram: input.telegram?.replace(/^@/, '') || null }),
      ...(input.country !== undefined && { country: input.country || null }),
    },
  });
  await prisma.log.create({
    data: { actorId: clientId, action: 'CLIENT.UPDATE', objectType: 'CLIENT', objectId: clientId, detail: 'Profile updated by client' },
  });
  bust();
  return { ok: true };
});

export const changePasswordAction = guarded(async function changePasswordAction(currentPassword: string, newPassword: string) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters');
  const clientId = await getClientUserId();
  // Re-authenticate before changing: a left-open or hijacked session must not
  // be able to take over the account by silently swapping the password (B-7).
  const me = await prisma.user.findUnique({ where: { id: clientId } });
  if (!me) throw new Error('Not signed in');
  const ok = await bcrypt.compare(currentPassword ?? '', me.passwordHash);
  if (!ok) throw new Error('Current password is incorrect');
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: clientId }, data: { passwordHash } });
  await prisma.log.create({
    data: { actorId: clientId, action: 'AUTH.PASSWORD_CHANGE', objectType: 'AUTH', objectId: clientId, detail: 'Client changed password' },
  });
  // Security notice — transactional (never pref-gated). The Settings page has
  // promised this alert since day one; until P1-4 it never existed. Best-effort:
  // a mail failure must not fail the completed password change.
  await sendEmail({ to: me.email, ...passwordChangedEmail() });
  return { ok: true };
});

export const saveNotifPrefsAction = guarded(async function saveNotifPrefsAction(prefs: {
  emailRenewal?: boolean;
  emailIncidents?: boolean;
  emailMarketing?: boolean;
  telegramAll?: boolean;
}) {
  const clientId = await getClientUserId();
  await prisma.user.update({ where: { id: clientId }, data: prefs });
  await prisma.log.create({
    data: { actorId: clientId, action: 'CLIENT.UPDATE', objectType: 'CLIENT', objectId: clientId, detail: 'Notification prefs updated by client' },
  });
  bust();
  return { ok: true };
});

export const depositAction = guarded(async function depositAction({ amount, method }: { amount: number; method: 'card' | 'crypto' }) {
  const clientId = await getClientUserId();
  if (method === 'card' && !mockPaymentsAllowed()) throw new Error('Card top-ups are not available yet — use crypto or contact support.');
  // Admin provider toggles gate NEW charges (audit B-4)
  const providers = await enabledProviders();
  if (method === 'card' && !providers.stripe) throw new Error('Card top-ups are currently disabled.');
  if (method === 'crypto' && !providers.crypto) throw new Error('Crypto top-ups are currently disabled.');
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) throw new Error('Deposit must be between $1 and $10,000');
  const me = await prisma.user.findUnique({ where: { id: clientId } });
  if (!me) throw new Error('Not found');

  const payId = await nextPaymentId();
  const invId = await nextInvoiceId();

  const isInstant = method === 'card';
  const now = new Date();

  // Real crypto top-up: hosted NOWPayments invoice — balance is credited by
  // the IPN webhook once the transfer lands, never by the client.
  let paymentUrl: string | null = null;
  let externalRef: string | null = null;
  if (method === 'crypto' && npEnabled()) {
    const inv = await npCreateInvoice({
      amountUsd: amount,
      paymentId: payId,
      description: `Balance top-up ${money(amount)}`,
      successUrl: appUrl('/billing'),
      cancelUrl: appUrl('/billing'),
    });
    paymentUrl = inv.invoiceUrl;
    externalRef = inv.invoiceId;
  }

  await prisma.$transaction(async tx => {
    await tx.payment.create({
      data: {
        id: payId,
        orderId: null,
        clientId,
        provider: method === 'card' ? 'Stripe' : npEnabled() ? 'NOWPayments' : 'CoinPayments',
        method: method === 'card' ? 'Wallet top-up' : npEnabled() ? 'Crypto' : 'USDT-TRC20',
        gross: amount, fees: 0, net: amount,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
        externalRef,
      },
    });
    if (isInstant) {
      const newBal = Number(me.balance) + amount;
      await tx.user.update({ where: { id: clientId }, data: { balance: newBal } });
      await tx.balanceLedgerEntry.create({
        data: { userId: clientId, op: 'TOPUP', amount, balanceAfter: newBal, refPaymentId: payId, note: `Deposit ${method}` },
      });
      await tx.invoice.create({ data: { id: invId, paymentId: payId, orderId: null, clientId, amount } });
      await tx.notification.create({
        data: { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: clientId,
                title: `Deposit of ${money(amount)} added to your balance · new bal ${money(newBal)}`,
                kind: 'SUCCESS', link: '/billing' },
      });
    }
    await tx.log.create({
      data: { actorId: clientId, action: isInstant ? 'PAYMENT.CONFIRM' : 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: payId,
              detail: `Deposit ${method} · ${money(amount)}` },
    });
  });

  bust();
  return { ok: true, paymentId: payId, instant: isInstant, ...(paymentUrl ? { paymentUrl } : {}) };
});
