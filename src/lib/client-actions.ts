'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { mockPaymentsAllowed } from './runtime-flags';
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
  revalidatePath('/admin', 'layout');
}

export async function clientCancelOrderAction(orderId: string) {
  const clientId = await getClientUserId();
  const r = await T.clientCancelNewOrder({ orderId, clientId });
  bust();
  return r;
}

export async function clientToggleAutoRenewAction(orderId: string, on: boolean) {
  const clientId = await getClientUserId();
  const r = await T.clientToggleAutoRenew({ orderId, clientId, on });
  bust();
  return r;
}

export async function clientRequestRefundAction(paymentId: string, reason: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRequestRefund({ paymentId, clientId, reason });
  bust();
  return r;
}

export async function clientRequestReplacementAction(proxyId: string, reason: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRequestReplacement({ proxyId, clientId, reason });
  bust();
  return r;
}

export async function clientRenewOrderAction(orderId: string) {
  const clientId = await getClientUserId();
  const r = await T.clientRenewOrder({ orderId, clientId });
  bust();
  return r;
}

export type ProfileSaveInput = {
  name?: string;
  telegram?: string | null;
  country?: string | null;
};

export async function saveProfileAction(input: ProfileSaveInput) {
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
}

export async function changePasswordAction(newPassword: string) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters');
  const clientId = await getClientUserId();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: clientId }, data: { passwordHash } });
  await prisma.log.create({
    data: { actorId: clientId, action: 'AUTH.PASSWORD_CHANGE', objectType: 'AUTH', objectId: clientId, detail: 'Client changed password' },
  });
  return { ok: true };
}

export async function saveNotifPrefsAction(prefs: {
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
}

export async function depositAction({ amount, method }: { amount: number; method: 'card' | 'crypto' }) {
  const clientId = await getClientUserId();
  if (method === 'card' && !mockPaymentsAllowed()) throw new Error('Card top-ups are not available yet — use crypto or contact support.');
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) throw new Error('Deposit must be between $1 and $10,000');
  const me = await prisma.user.findUnique({ where: { id: clientId } });
  if (!me) throw new Error('Not found');

  const rows = await prisma.payment.findMany({ where: { id: { startsWith: 'PAY-' } }, select: { id: true } });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const payId = `PAY-${String(max + 1).padStart(5, '0')}`;
  const invRows = await prisma.invoice.findMany({ where: { id: { startsWith: 'INV-' } }, select: { id: true } });
  let invMax = 0;
  for (const r of invRows) {
    const m = /(\d+)/.exec(r.id);
    if (m) invMax = Math.max(invMax, parseInt(m[1], 10));
  }
  const invId = `INV-${String(invMax + 1).padStart(5, '0')}`;

  const isInstant = method === 'card';
  const now = new Date();

  await prisma.$transaction(async tx => {
    await tx.payment.create({
      data: {
        id: payId,
        orderId: null,
        clientId,
        provider: method === 'card' ? 'Stripe' : 'CoinPayments',
        method: method === 'card' ? 'Wallet top-up' : 'USDT-TRC20',
        gross: amount, fees: 0, net: amount,
        status: isInstant ? 'CONFIRMED' : 'AWAITING',
        confirmedAt: isInstant ? now : null,
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
                title: `Deposit of $${amount} added to your balance · new bal $${newBal}`,
                kind: 'SUCCESS', link: '/billing' },
      });
    }
    await tx.log.create({
      data: { actorId: clientId, action: isInstant ? 'PAYMENT.CONFIRM' : 'PAYMENT.PENDING', objectType: 'PAYMENT', objectId: payId,
              detail: `Deposit ${method} · $${amount}` },
    });
  });

  bust();
  return { ok: true, paymentId: payId, instant: isInstant };
}
