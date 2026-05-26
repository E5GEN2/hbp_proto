'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from './auth';
import { prisma } from './prisma';
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
