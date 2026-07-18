'use server';

import { guarded } from './action-guard';

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

export const markPaidAction = guarded(async function markPaidAction(paymentId: string, source: string, externalRef?: string) {
  const actor = await getAdminActor();
  const r = await T.markPaymentPaid({ paymentId, actor, source, externalRef });
  bust();
  return r;
});

export const refundPaymentAction = guarded(async function refundPaymentAction(paymentId: string, amount: number, reason: string) {
  const actor = await getAdminActor();
  const r = await T.refundPayment({ paymentId, actor, amount, reason });
  bust();
  return r;
});

export const cancelOrderAction = guarded(async function cancelOrderAction(orderId: string, reason: string) {
  const actor = await getAdminActor();
  const r = await T.cancelOrder({ orderId, actor, reason });
  bust();
  return r;
});

export const suspendOrderAction = guarded(async function suspendOrderAction(orderId: string, reason: string) {
  const actor = await getAdminActor();
  const r = await T.suspendOrder({ orderId, actor, reason });
  bust();
  return r;
});

export const resumeOrderAction = guarded(async function resumeOrderAction(orderId: string) {
  const actor = await getAdminActor();
  const r = await T.resumeOrder({ orderId, actor });
  bust();
  return r;
});

export const extendOrderAction = guarded(async function extendOrderAction(orderId: string, additionalDays?: number) {
  const actor = await getAdminActor();
  const r = await T.extendOrder({ orderId, actor, additionalDays, paymentMethod: 'comp' });
  bust();
  return r;
});

export const assignProxyAction = guarded(async function assignProxyAction(orderId: string, proxyIds: string[]) {
  const actor = await getAdminActor();
  const r = await T.assignProxyManually({ orderId, proxyIds, actor });
  bust();
  return r;
});

export const sendCredentialsAction = guarded(async function sendCredentialsAction(orderId: string, channel: 'EMAIL' | 'TELEGRAM' | 'BOTH') {
  const actor = await getAdminActor();
  const r = await T.sendCredentials({ orderId, actor, channel });
  bust();
  return r;
});

export const markProxyFaultyAction = guarded(async function markProxyFaultyAction(proxyId: string, reason: string, autoReplace: boolean) {
  const actor = await getAdminActor();
  const r = await T.markProxyFaulty({ proxyId, actor, reason, autoReplace });
  bust();
  return r;
});

export const releaseProxyAction = guarded(async function releaseProxyAction(proxyId: string) {
  const actor = await getAdminActor();
  const r = await T.releaseProxy({ proxyId, actor });
  bust();
  return r;
});

export const returnProxyToPoolAction = guarded(async function returnProxyToPoolAction(proxyId: string) {
  const actor = await getAdminActor();
  const r = await T.returnProxyToPool({ proxyId, actor });
  bust();
  return r;
});

export const replaceProxyAction = guarded(async function replaceProxyAction(orderId: string, proxyId: string) {
  const actor = await getAdminActor();
  const r = await T.replaceProxy({ orderId, proxyId, actor });
  bust();
  return r;
});

export const markProxyHealthyAction = guarded(async function markProxyHealthyAction(proxyId: string) {
  const actor = await getAdminActor();
  const r = await T.markProxyHealthy({ proxyId, actor });
  bust();
  return r;
});

export const setProxyMaintenanceAction = guarded(async function setProxyMaintenanceAction(proxyId: string, on: boolean) {
  const actor = await getAdminActor();
  const r = await T.setProxyMaintenance({ proxyId, on, actor });
  bust();
  return r;
});

export const togglePlanActiveAction = guarded(async function togglePlanActiveAction(planId: string, active: boolean, reason?: string) {
  const actor = await getAdminActor();
  const r = await T.togglePlanActive({ planId, actor, active, reason });
  bust();
  return r;
});

export const createPlanAction = guarded(async function createPlanAction(input: T.PlanInput) {
  const actor = await getAdminActor();
  const r = await T.createPlan({ input, actor });
  bust();
  return r;
});

export const updatePlanAction = guarded(async function updatePlanAction(planId: string, input: Partial<T.PlanInput>) {
  const actor = await getAdminActor();
  const r = await T.updatePlan({ planId, input, actor });
  bust();
  return r;
});

export const deletePlanAction = guarded(async function deletePlanAction(planId: string) {
  const actor = await getAdminActor();
  const r = await T.deletePlan({ planId, actor });
  bust();
  return r;
});

export const createOrderAction = guarded(async function createOrderAction(input: T.NewOrderInput) {
  const actor = await getAdminActor();
  const r = await T.createOrderByAdmin({ input, actor });
  bust();
  return r;
});

export const createClientAction = guarded(async function createClientAction(input: T.NewClientInput) {
  const actor = await getAdminActor();
  const r = await T.createClient({ input, actor });
  bust();
  return r;
});

export const updateClientAction = guarded(async function updateClientAction(userId: string, input: T.UpdateClientInput) {
  const actor = await getAdminActor();
  const r = await T.updateClient({ userId, input, actor });
  bust();
  return r;
});

export const setClientRiskAction = guarded(async function setClientRiskAction(userId: string, risk: 'NONE' | 'REVIEW' | 'FLAG', note?: string) {
  const actor = await getAdminActor();
  const r = await T.setClientRisk({ userId, risk, note, actor });
  bust();
  return r;
});

export const registerProxiesAction = guarded(async function registerProxiesAction(inputs: T.RegisterProxyInput[]) {
  const actor = await getAdminActor();
  const r = await T.registerProxies({ inputs, actor });
  bust();
  return r;
});

export const addNoteAction = guarded(async function addNoteAction(
  objectType: 'ORDER' | 'PAYMENT' | 'PROXY' | 'CLIENT' | 'PLAN',
  objectId: string,
  body: string,
) {
  const actor = await getAdminActor();
  const r = await T.addEntityNote({ objectType, objectId, body, actor });
  bust();
  return r;
});

export const adjustBalanceAction = guarded(async function adjustBalanceAction(userId: string, delta: number, reason: string, note?: string) {
  const actor = await getAdminActor();
  const r = await T.adjustBalance({ userId, actor, delta, reason, note });
  bust();
  return r;
});

export const blockClientAction = guarded(async function blockClientAction(userId: string, reason: string, suspendActiveOrders: boolean) {
  const actor = await getAdminActor();
  const r = await T.blockClient({ userId, actor, reason, suspendActiveOrders });
  bust();
  return r;
});

export const unblockClientAction = guarded(async function unblockClientAction(userId: string) {
  const actor = await getAdminActor();
  const r = await T.unblockClient({ userId, actor });
  bust();
  return r;
});
