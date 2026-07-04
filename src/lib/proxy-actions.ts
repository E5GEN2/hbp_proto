'use server';

import { guarded } from './action-guard';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';

async function getClientUserId() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('Not signed in');
  if (session.user.role !== 'CLIENT') throw new Error('Client-only');
  return session.user.id;
}

async function ensureOwnership(proxyId: string, userId: string) {
  const a = await prisma.assignment.findFirst({
    where: { proxyId, releasedAt: null },
    include: { order: { select: { clientId: true } } },
  });
  if (!a || a.order.clientId !== userId) throw new Error('Forbidden');
  return a;
}

export const addWhitelistIpAction = guarded(async function addWhitelistIpAction(proxyId: string, ip: string) {
  const userId = await getClientUserId();
  await ensureOwnership(proxyId, userId);
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw new Error('Invalid IPv4 address');
  const count = await prisma.proxyWhitelist.count({ where: { proxyId } });
  if (count >= 5) throw new Error('Whitelist cap (5) reached. Remove one first.');
  await prisma.proxyWhitelist.create({ data: { proxyId, ip, addedBy: userId } });
  await prisma.log.create({
    data: { actorId: userId, action: 'PROXY.WHITELIST_ADD', objectType: 'PROXY', objectId: proxyId, detail: `Client added ${ip}` },
  });
  revalidatePath(`/proxies/${proxyId}`);
  return { ok: true };
});

export const removeWhitelistIpAction = guarded(async function removeWhitelistIpAction(proxyId: string, ip: string) {
  const userId = await getClientUserId();
  await ensureOwnership(proxyId, userId);
  await prisma.proxyWhitelist.deleteMany({ where: { proxyId, ip } });
  await prisma.log.create({
    data: { actorId: userId, action: 'PROXY.WHITELIST_REMOVE', objectType: 'PROXY', objectId: proxyId, detail: `Client removed ${ip}` },
  });
  revalidatePath(`/proxies/${proxyId}`);
  return { ok: true };
});

export const updateAutoRotateAction = guarded(async function updateAutoRotateAction(proxyId: string, minutes: number) {
  const userId = await getClientUserId();
  await ensureOwnership(proxyId, userId);
  const allowed = [0, 5, 10, 30, 60, 240];
  if (!allowed.includes(minutes)) throw new Error(`Interval must be one of ${allowed.join(', ')}`);
  await prisma.proxy.update({ where: { id: proxyId }, data: { autoRotateMin: minutes } });
  await prisma.log.create({
    data: {
      actorId: userId, action: 'PROXY.UPDATE', objectType: 'PROXY', objectId: proxyId,
      detail: minutes === 0 ? 'Auto-rotation disabled (manual / URL only)' : `Auto-rotation set to every ${minutes} min`,
    },
  });
  revalidatePath(`/proxies/${proxyId}`);
  return { ok: true };
});

export const updateProxyLabelAction = guarded(async function updateProxyLabelAction(proxyId: string, label: string) {
  const userId = await getClientUserId();
  await ensureOwnership(proxyId, userId);
  const clean = label.trim().slice(0, 40);
  await prisma.proxy.update({ where: { id: proxyId }, data: { label: clean || null } });
  await prisma.log.create({
    data: { actorId: userId, action: 'PROXY.UPDATE', objectType: 'PROXY', objectId: proxyId, detail: `Label set to "${clean}"` },
  });
  revalidatePath(`/proxies/${proxyId}`);
  return { ok: true };
});

export const logCredentialViewAction = guarded(async function logCredentialViewAction(proxyId: string) {
  const userId = await getClientUserId();
  await ensureOwnership(proxyId, userId);
  // Cheap audit — for any client view of credentials per LIFECYCLE_CONTRACT.md
  await prisma.log.create({
    data: { actorId: userId, action: 'PROXY.CREDENTIALS_VIEWED', objectType: 'PROXY', objectId: proxyId, detail: 'Client viewed credentials in portal' },
  });
  return { ok: true };
});
