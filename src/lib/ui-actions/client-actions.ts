// Client-side mirror of @/lib/client-actions (audit B-9): unwrapAction() turns
// the guarded {__actionError} return back into a thrown Error so
// try/catch → toast(e.message) call sites show the real message.
import * as S from '@/lib/client-actions';
import { unwrapAction } from './unwrap';

export const clientCancelOrderAction = unwrapAction(S.clientCancelOrderAction);
export const clientToggleAutoRenewAction = unwrapAction(S.clientToggleAutoRenewAction);
export const clientRequestRefundAction = unwrapAction(S.clientRequestRefundAction);
export const clientRequestReplacementAction = unwrapAction(S.clientRequestReplacementAction);
export const clientRenewOrderAction = unwrapAction(S.clientRenewOrderAction);
export const saveProfileAction = unwrapAction(S.saveProfileAction);
export const changePasswordAction = unwrapAction(S.changePasswordAction);
export const saveNotifPrefsAction = unwrapAction(S.saveNotifPrefsAction);
export const depositAction = unwrapAction(S.depositAction);
