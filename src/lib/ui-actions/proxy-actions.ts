// Client-side mirror of @/lib/proxy-actions (audit B-9): unwrapAction() turns
// the guarded {__actionError} return back into a thrown Error so
// try/catch → toast(e.message) call sites show the real message.
import * as S from '@/lib/proxy-actions';
import { unwrapAction } from './unwrap';

export const addWhitelistIpAction = unwrapAction(S.addWhitelistIpAction);
export const removeWhitelistIpAction = unwrapAction(S.removeWhitelistIpAction);
export const updateAutoRotateAction = unwrapAction(S.updateAutoRotateAction);
export const updateProxyLabelAction = unwrapAction(S.updateProxyLabelAction);
export const logCredentialViewAction = unwrapAction(S.logCredentialViewAction);
