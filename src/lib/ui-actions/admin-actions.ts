// Client-side mirror of @/lib/admin-actions (audit B-9): unwrapAction() turns
// the guarded {__actionError} return back into a thrown Error so
// try/catch → toast(e.message) call sites show the real message.
import * as S from '@/lib/admin-actions';
import { unwrapAction } from './unwrap';

export const markPaidAction = unwrapAction(S.markPaidAction);
export const refundPaymentAction = unwrapAction(S.refundPaymentAction);
export const cancelOrderAction = unwrapAction(S.cancelOrderAction);
export const suspendOrderAction = unwrapAction(S.suspendOrderAction);
export const resumeOrderAction = unwrapAction(S.resumeOrderAction);
export const extendOrderAction = unwrapAction(S.extendOrderAction);
export const assignProxyAction = unwrapAction(S.assignProxyAction);
export const sendCredentialsAction = unwrapAction(S.sendCredentialsAction);
export const markProxyFaultyAction = unwrapAction(S.markProxyFaultyAction);
export const releaseProxyAction = unwrapAction(S.releaseProxyAction);
export const returnProxyToPoolAction = unwrapAction(S.returnProxyToPoolAction);
export const markProxyHealthyAction = unwrapAction(S.markProxyHealthyAction);
export const setProxyMaintenanceAction = unwrapAction(S.setProxyMaintenanceAction);
export const togglePlanActiveAction = unwrapAction(S.togglePlanActiveAction);
export const createPlanAction = unwrapAction(S.createPlanAction);
export const updatePlanAction = unwrapAction(S.updatePlanAction);
export const deletePlanAction = unwrapAction(S.deletePlanAction);
export const createOrderAction = unwrapAction(S.createOrderAction);
export const createClientAction = unwrapAction(S.createClientAction);
export const updateClientAction = unwrapAction(S.updateClientAction);
export const setClientRiskAction = unwrapAction(S.setClientRiskAction);
export const registerProxyAction = unwrapAction(S.registerProxyAction);
export const addNoteAction = unwrapAction(S.addNoteAction);
export const adjustBalanceAction = unwrapAction(S.adjustBalanceAction);
export const blockClientAction = unwrapAction(S.blockClientAction);
export const unblockClientAction = unwrapAction(S.unblockClientAction);
