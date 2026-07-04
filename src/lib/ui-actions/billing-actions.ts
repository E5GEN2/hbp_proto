// Client-side mirror of @/lib/billing-actions (audit B-9): unwrapAction() turns
// the guarded {__actionError} return back into a thrown Error so
// try/catch → toast(e.message) call sites show the real message.
import * as S from '@/lib/billing-actions';
import { unwrapAction } from './unwrap';

export const addPaymentMethodAction = unwrapAction(S.addPaymentMethodAction);
export const setDefaultPaymentMethodAction = unwrapAction(S.setDefaultPaymentMethodAction);
export const removePaymentMethodAction = unwrapAction(S.removePaymentMethodAction);
