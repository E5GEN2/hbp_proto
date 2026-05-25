'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from './auth';
import * as T from './transitions';

async function getAdminActor() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('Unauthorized');
  if (!isAdminRole(session.user.role)) throw new Error('Forbidden');
  return { id: session.user.id, name: session.user.name ?? undefined };
}

function bust() {
  // Bust caches for every page that displays cross-cutting state
  revalidatePath('/admin', 'layout');
  revalidatePath('/dashboard');
  revalidatePath('/orders');
  revalidatePath('/proxies');
  revalidatePath('/billing');
  revalidatePath('/catalog');
}

export async function markPaidAction(paymentId: string, source: string, externalRef?: string) {
  const actor = await getAdminActor();
  const r = await T.markPaymentPaid({ paymentId, actor, source, externalRef });
  bust();
  return r;
}

export async function refundPaymentAction(paymentId: string, amount: number, reason: string) {
  const actor = await getAdminActor();
  const r = await T.refundPayment({ paymentId, actor, amount, reason });
  bust();
  return r;
}

export async function cancelOrderAction(orderId: string, reason: string) {
  const actor = await getAdminActor();
  const r = await T.cancelOrder({ orderId, actor, reason });
  bust();
  return r;
}

export async function suspendOrderAction(orderId: string, reason: string) {
  const actor = await getAdminActor();
  const r = await T.suspendOrder({ orderId, actor, reason });
  bust();
  return r;
}

export async function resumeOrderAction(orderId: string) {
  const actor = await getAdminActor();
  const r = await T.resumeOrder({ orderId, actor });
  bust();
  return r;
}

export async function extendOrderAction(orderId: string, additionalDays?: number) {
  const actor = await getAdminActor();
  const r = await T.extendOrder({ orderId, actor, additionalDays, paymentMethod: 'comp' });
  bust();
  return r;
}

export async function assignProxyAction(orderId: string, proxyIds: string[]) {
  const actor = await getAdminActor();
  const r = await T.assignProxyManually({ orderId, proxyIds, actor });
  bust();
  return r;
}

export async function sendCredentialsAction(orderId: string, channel: 'EMAIL' | 'TELEGRAM' | 'BOTH') {
  const actor = await getAdminActor();
  const r = await T.sendCredentials({ orderId, actor, channel });
  bust();
  return r;
}

export async function markProxyFaultyAction(proxyId: string, reason: string, autoReplace: boolean) {
  const actor = await getAdminActor();
  const r = await T.markProxyFaulty({ proxyId, actor, reason, autoReplace });
  bust();
  return r;
}

export async function releaseProxyAction(proxyId: string) {
  const actor = await getAdminActor();
  const r = await T.releaseProxy({ proxyId, actor });
  bust();
  return r;
}

export async function togglePlanActiveAction(planId: string, active: boolean, reason?: string) {
  const actor = await getAdminActor();
  const r = await T.togglePlanActive({ planId, actor, active, reason });
  bust();
  return r;
}

export async function adjustBalanceAction(userId: string, delta: number, reason: string, note?: string) {
  const actor = await getAdminActor();
  const r = await T.adjustBalance({ userId, actor, delta, reason, note });
  bust();
  return r;
}

export async function blockClientAction(userId: string, reason: string, suspendActiveOrders: boolean) {
  const actor = await getAdminActor();
  const r = await T.blockClient({ userId, actor, reason, suspendActiveOrders });
  bust();
  return r;
}

export async function unblockClientAction(userId: string) {
  const actor = await getAdminActor();
  const r = await T.unblockClient({ userId, actor });
  bust();
  return r;
}
