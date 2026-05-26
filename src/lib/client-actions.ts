'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
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
