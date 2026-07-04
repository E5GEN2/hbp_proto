'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions, isAdminRole } from './auth';
import { prisma } from './prisma';
import { ANNOUNCEMENT_KEY, type Announcement, type AnnouncementVariant } from './announcement';

async function getAdminActor() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('Unauthorized');
  if (!isAdminRole(session.user.role)) throw new Error('Forbidden');
  return { id: session.user.id, name: session.user.name ?? undefined };
}

function bust() {
  revalidatePath('/admin/settings', 'layout');
  revalidatePath('/catalog');
  revalidatePath('/checkout');
  revalidatePath('/marketing');
}

/* ─── SYSTEM FLAGS ─────────────────────────────────────────────────── */

export async function setSystemFlagAction(key: string, value: any) {
  const actor = await getAdminActor();
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as any },
    create: { key, value: value as any },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: key, detail: `${key} = ${JSON.stringify(value)}` },
  });
  bust();
  return { ok: true };
}

/* ─── MARKETING ANNOUNCEMENT ───────────────────────────────────────── */

const ANN_VARIANTS: AnnouncementVariant[] = ['promo', 'info', 'warning'];

export async function saveAnnouncementAction(data: Announcement) {
  const actor = await getAdminActor();
  const value: Announcement = {
    enabled: !!data.enabled,
    text: String(data.text ?? '').slice(0, 200),
    href: String(data.href ?? '').slice(0, 300),
    variant: ANN_VARIANTS.includes(data.variant) ? data.variant : 'promo',
  };
  await prisma.systemSetting.upsert({
    where: { key: ANNOUNCEMENT_KEY },
    update: { value: value as any },
    create: { key: ANNOUNCEMENT_KEY, value: value as any },
  });
  await prisma.log.create({
    data: {
      actorId: actor.id,
      action: 'FLAG.UPDATE',
      objectType: 'SYSTEM',
      objectId: ANNOUNCEMENT_KEY,
      detail: `enabled=${value.enabled} · ${JSON.stringify(value.text)}`,
    },
  });
  bust(); // bust() already revalidates /marketing
  return { ok: true };
}

/* ─── GRACE RULES ──────────────────────────────────────────────────── */

const GRACE_FIELDS = [
  'defaultGraceHours', 'preRenewalReminderHours', 'secondReminderHours', 'thirdReminderHours',
  'VIPGraceHours', 'ProGraceHours', 'StandardGraceHours',
  'autoRenew24hBeforeExpiry', 'keepProxyDuringGrace', 'autoSuspendAfter3Fails',
] as const;

export async function saveGraceRulesAction(data: Record<string, any>) {
  const actor = await getAdminActor();
  // Monotonicity validation
  const second = Number(data.secondReminderHours ?? 0);
  const third = Number(data.thirdReminderHours ?? 0);
  const pre = Number(data.preRenewalReminderHours ?? 0);
  if (second && pre && second >= pre) throw new Error('Second reminder must be < Pre-renewal reminder');
  if (third && second && third >= second) throw new Error('Third reminder must be < Second reminder');
  for (const k of GRACE_FIELDS) {
    if (typeof data[k] === 'number' && (data[k] < 0 || data[k] > 720)) throw new Error(`${k} must be 0-720`);
  }
  const filtered: Record<string, any> = {};
  for (const k of GRACE_FIELDS) if (data[k] !== undefined) filtered[k] = data[k];
  await prisma.systemSetting.upsert({
    where: { key: 'grace' },
    update: { value: filtered },
    create: { key: 'grace', value: filtered },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: 'grace', detail: 'Grace rules saved' },
  });
  bust();
  return { ok: true };
}

/* ─── DISPLAY ──────────────────────────────────────────────────────── */

export async function setTimeFormatAction(timeFormat: 'UTC' | 'GMT') {
  const actor = await getAdminActor();
  await prisma.systemSetting.upsert({
    where: { key: 'display' },
    update: { value: { timeFormat } },
    create: { key: 'display', value: { timeFormat } },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: 'display.timeFormat', detail: timeFormat },
  });
  bust();
  return { ok: true };
}

/* ─── CATALOG ──────────────────────────────────────────────────────── */

export async function addCatalogItemAction(kind: string, value: string) {
  const actor = await getAdminActor();
  if (!value.trim()) throw new Error('Value required');
  const exists = await prisma.catalogItem.findFirst({ where: { kind: kind as any, value: value.trim() } });
  if (exists) throw new Error('Already exists');
  const last = await prisma.catalogItem.findFirst({ where: { kind: kind as any }, orderBy: { sortOrder: 'desc' } });
  await prisma.catalogItem.create({
    data: { kind: kind as any, value: value.trim(), sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'CATALOG.UPDATE', objectType: 'SYSTEM', objectId: `catalog.${kind}`, detail: `Added "${value.trim()}"` },
  });
  bust();
  return { ok: true };
}

export async function removeCatalogItemAction(id: number) {
  const actor = await getAdminActor();
  const item = await prisma.catalogItem.findUnique({ where: { id } });
  if (!item) throw new Error('Not found');
  // Plans reference locations by denormalized region STRING (no FK), so
  // deleting a location in use would strand its plans on a dead value and
  // silently drop them from checkout (which only offers live locations).
  if (item.kind === 'REGION') {
    const inUse = await prisma.plan.count({
      where: { region: item.value, active: true, deletedAt: null },
    });
    if (inUse > 0) {
      throw new Error(`${inUse} active ${inUse === 1 ? 'plan uses' : 'plans use'} this location — reassign ${inUse === 1 ? 'it' : 'them'} first`);
    }
  }
  await prisma.catalogItem.delete({ where: { id } });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'CATALOG.UPDATE', objectType: 'SYSTEM', objectId: `catalog.${item.kind}`, detail: `Removed "${item.value}"` },
  });
  bust();
  return { ok: true };
}

/* ─── PROVIDERS ────────────────────────────────────────────────────── */

export async function setProviderEnabledAction(provider: 'stripe' | 'crypto' | 'bank' | 'paypal', enabled: boolean) {
  const actor = await getAdminActor();
  const existing = await prisma.systemSetting.findUnique({ where: { key: 'providers' } });
  const current = (existing?.value as any) ?? {};
  current[provider] = { ...(current[provider] ?? {}), enabled };
  await prisma.systemSetting.upsert({
    where: { key: 'providers' },
    update: { value: current },
    create: { key: 'providers', value: current },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'PROVIDER.UPDATE', objectType: 'SYSTEM', objectId: `provider.${provider}`, detail: `${provider} ${enabled ? 'enabled' : 'disabled'}` },
  });
  bust();
  return { ok: true };
}

/* ─── NOTIFICATIONS ────────────────────────────────────────────────── */

export async function toggleNotificationRuleAction(ruleKey: string, enabled: boolean) {
  const actor = await getAdminActor();
  const existing = await prisma.systemSetting.findUnique({ where: { key: 'notifications' } });
  const current = (existing?.value as any) ?? {};
  current[ruleKey] = enabled;
  await prisma.systemSetting.upsert({
    where: { key: 'notifications' },
    update: { value: current },
    create: { key: 'notifications', value: current },
  });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: `notif.${ruleKey}`, detail: `${ruleKey} ${enabled ? 'enabled' : 'disabled'}` },
  });
  bust();
  return { ok: true };
}

/* ─── PROVISIONING RULES ───────────────────────────────────────────── */

export async function upsertProvisioningRuleAction(data: {
  id?: string;
  carrier: string;
  region: string;
  defaultPool: string;
  fallbackPools: string[];
  autoAssign: boolean;
  notes?: string;
}) {
  const actor = await getAdminActor();
  if (!data.carrier || !data.region || !data.defaultPool) throw new Error('Carrier, region, default pool required');
  if (data.id) {
    await prisma.provisioningRule.update({
      where: { id: data.id },
      data: {
        carrier: data.carrier, region: data.region,
        defaultPool: data.defaultPool, fallbackPools: data.fallbackPools,
        autoAssign: data.autoAssign, notes: data.notes ?? null,
      },
    });
    await prisma.log.create({
      data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: data.id, detail: `Updated rule ${data.carrier}/${data.region}` },
    });
  } else {
    const dupe = await prisma.provisioningRule.findUnique({ where: { carrier_region: { carrier: data.carrier, region: data.region } } });
    if (dupe) throw new Error('Rule already exists — edit that row instead');
    const last = await prisma.provisioningRule.findFirst({ orderBy: { id: 'desc' } });
    let next = 1;
    if (last) {
      const m = /(\d+)/.exec(last.id);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const id = `PRV-${String(next).padStart(3, '0')}`;
    await prisma.provisioningRule.create({
      data: { id, carrier: data.carrier, region: data.region, defaultPool: data.defaultPool, fallbackPools: data.fallbackPools, autoAssign: data.autoAssign, notes: data.notes ?? null },
    });
    await prisma.log.create({
      data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: id, detail: `Created rule ${data.carrier}/${data.region}` },
    });
  }
  bust();
  return { ok: true };
}

export async function deleteProvisioningRuleAction(id: string) {
  const actor = await getAdminActor();
  await prisma.provisioningRule.delete({ where: { id } });
  await prisma.log.create({
    data: { actorId: actor.id, action: 'FLAG.UPDATE', objectType: 'SYSTEM', objectId: id, detail: 'Deleted provisioning rule' },
  });
  bust();
  return { ok: true };
}
