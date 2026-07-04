// Client-side mirror of @/lib/settings-actions (audit B-9): unwrapAction() turns
// the guarded {__actionError} return back into a thrown Error so
// try/catch → toast(e.message) call sites show the real message.
import * as S from '@/lib/settings-actions';
import { unwrapAction } from './unwrap';

export const setSystemFlagAction = unwrapAction(S.setSystemFlagAction);
export const saveAnnouncementAction = unwrapAction(S.saveAnnouncementAction);
export const saveGraceRulesAction = unwrapAction(S.saveGraceRulesAction);
export const setTimeFormatAction = unwrapAction(S.setTimeFormatAction);
export const addCatalogItemAction = unwrapAction(S.addCatalogItemAction);
export const removeCatalogItemAction = unwrapAction(S.removeCatalogItemAction);
export const setProviderEnabledAction = unwrapAction(S.setProviderEnabledAction);
export const toggleNotificationRuleAction = unwrapAction(S.toggleNotificationRuleAction);
export const upsertProvisioningRuleAction = unwrapAction(S.upsertProvisioningRuleAction);
export const deleteProvisioningRuleAction = unwrapAction(S.deleteProvisioningRuleAction);
