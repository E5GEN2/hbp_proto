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

export const addPaymentMethodAction = guarded(async function addPaymentMethodAction(input: {
  brand: string;
  number: string;
  exp: string;
  setDefault: boolean;
}) {
  const userId = await getClientUserId();
  const cleanNum = input.number.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(cleanNum)) throw new Error('Card number looks invalid');
  if (!/^\d{2}\/\d{2}$/.test(input.exp)) throw new Error('Expiry must be MM/YY');
  const last4 = cleanNum.slice(-4);

  const id = `pm_${Math.random().toString(36).slice(2, 12)}`;

  await prisma.$transaction(async tx => {
    if (input.setDefault) {
      await tx.paymentMethod.updateMany({
        where: { userId, kind: { in: ['CARD', 'CRYPTO'] } },
        data: { isDefault: false },
      });
    }
    const existingDefault = await tx.paymentMethod.count({ where: { userId, isDefault: true, kind: { in: ['CARD', 'CRYPTO'] } } });
    await tx.paymentMethod.create({
      data: {
        id, userId, kind: 'CARD',
        brand: input.brand, last4, exp: input.exp,
        isDefault: input.setDefault || existingDefault === 0,
      },
    });
    await tx.log.create({
      data: { actorId: userId, action: 'CLIENT.UPDATE', objectType: 'CLIENT', objectId: userId, detail: `Added payment method ${input.brand} •• ${last4}` },
    });
  });

  revalidatePath('/billing');
  return { ok: true, id };
});

export const setDefaultPaymentMethodAction = guarded(async function setDefaultPaymentMethodAction(pmId: string) {
  const userId = await getClientUserId();
  const pm = await prisma.paymentMethod.findUnique({ where: { id: pmId } });
  if (!pm || pm.userId !== userId) throw new Error('Forbidden');
  // Canon (client-panel.html): every method — Balance included — carries
  // «Set as default»; default only preselects the method at checkout.
  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { userId }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: pmId }, data: { isDefault: true } }),
  ]);
  revalidatePath('/billing');
  return { ok: true };
});

export const removePaymentMethodAction = guarded(async function removePaymentMethodAction(pmId: string) {
  const userId = await getClientUserId();
  const pm = await prisma.paymentMethod.findUnique({ where: { id: pmId } });
  if (!pm || pm.userId !== userId) throw new Error('Forbidden');
  if (pm.locked) throw new Error('This method is locked and cannot be removed');
  if (pm.isDefault) {
    const others = await prisma.paymentMethod.count({ where: { userId, id: { not: pmId }, kind: { not: 'BALANCE' } } });
    if (others > 0) throw new Error('Set another method as default first');
  }
  await prisma.paymentMethod.delete({ where: { id: pmId } });
  await prisma.log.create({
    data: { actorId: userId, action: 'CLIENT.UPDATE', objectType: 'CLIENT', objectId: userId, detail: `Removed payment method ${pm.brand} ${pm.last4 ? '•• ' + pm.last4 : ''}` },
  });
  revalidatePath('/billing');
  return { ok: true };
});
