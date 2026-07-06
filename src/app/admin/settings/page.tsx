import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';
import { SystemFlagsForm } from '@/components/admin/settings/SystemFlagsForm';
import { GraceRulesForm } from '@/components/admin/settings/GraceRulesForm';
import { DisplayForm } from '@/components/admin/settings/DisplayForm';
import { CatalogManager } from '@/components/admin/settings/CatalogManager';
import { ProvidersForm } from '@/components/admin/settings/ProvidersForm';
import { NotificationsForm } from '@/components/admin/settings/NotificationsForm';
import { ProvisioningRulesForm } from '@/components/admin/settings/ProvisioningRulesForm';
import { AnnouncementForm } from '@/components/admin/settings/AnnouncementForm';
import { coerceAnnouncement } from '@/lib/announcement';
import { fmtAdminStamp } from '@/lib/date';

// Canon tab order (prototype #settingsTabs)
const TABS = [
  { v: 'providers',    l: 'Payment Providers' },
  { v: 'notifications', l: 'Notifications' },
  { v: 'grace',        l: 'Grace Rules' },
  { v: 'admins',       l: 'Admin Users & Roles' },
  { v: 'api',          l: 'API / Webhooks' },
  { v: 'display',      l: 'Display' },
  { v: 'catalog',      l: 'Catalog' },
  { v: 'provisioning', l: 'Provisioning' },
  { v: 'flags',        l: 'System Flags' },
  { v: 'announcements', l: 'Announcements' },
  { v: 'help',         l: 'Help & Process' },
];

// settings-meta descriptive clauses (canon structure; the fabricated
// "Last updated by <name> · <date>" lead is dropped — no such tracking
// on the live portal, per the no-fake-data rule).
const META: Record<string, string[]> = {
  providers:    ['Changes apply immediately to new payments'],
  notifications: ['Toggle changes take effect on the next scheduled notification'],
  grace:        ['Applies to all new orders', 'Existing orders keep their original grace'],
  admins:       ['Super Admin only — all changes are logged in Admin Logs'],
  api:          ['Key & webhook management ships in Phase 2'],
  display:      ['Operator preference · stored per browser', 'No server-side effect'],
  catalog:      ['Master lists that drive every plan dropdown', 'Existing plans keep their snapshotted values'],
  provisioning: ['Default pool policy per Carrier · Region', 'Applies to plans that don’t override'],
  flags:        ['Flags take effect immediately', 'Red flags require confirmation'],
  announcements: ['Controls the promo banner on the public marketing site', 'Saved changes appear on /marketing immediately'],
  help:         ['Workflow visualisations and process documentation'],
};

const ROLE_CHIP: Record<string, { cls: string; label: string }> = {
  ADMIN_SUPER:   { cls: 'super', label: 'Super Admin' },
  ADMIN_OPS:     { cls: 'ops', label: 'Operations' },
  ADMIN_SUPPORT: { cls: 'support', label: 'Support' },
};

const PERMISSIONS: { label: string; super: string; ops: string; support: string }[] = [
  { label: 'View all orders & clients', super: '✓', ops: '✓', support: '✓' },
  { label: 'Create / modify orders', super: '✓', ops: '✓', support: '✓' },
  { label: 'Issue refunds', super: '✓', ops: '✓', support: '✓ (<$100)' },
  { label: 'Block / unblock clients', super: '✓', ops: '✓', support: '—' },
  { label: 'Manage plans & pricing', super: '✓', ops: '✓', support: '—' },
  { label: 'Register / retire proxies', super: '✓', ops: '✓', support: '—' },
  { label: 'Configure providers / webhooks', super: '✓', ops: '—', support: '—' },
  { label: 'Manage admin users & roles', super: '✓', ops: '—', support: '—' },
];

export default async function AdminSettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab ?? 'providers';
  const [settings, catalogItems, templates, provisioningRules, admins] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.catalogItem.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.notificationTemplate.findMany({ orderBy: { updatedAt: 'desc' } }),
    prisma.provisioningRule.findMany({ orderBy: { id: 'asc' } }),
    prisma.user.findMany({ where: { role: { in: ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT'] } }, orderBy: { name: 'asc' } }),
  ]);
  const map = Object.fromEntries(settings.map(s => [s.key, s.value]));
  const providers = (map.providers ?? {}) as any;
  const grace = (map.grace ?? {}) as any;
  const flags = (map.flags ?? {}) as any;
  const display = (map.display ?? { timeFormat: 'UTC' }) as any;
  const notifs = (map.notifications ?? {}) as any;
  const announcement = coerceAnnouncement(map['marketing.announcement']);

  const catalogByKind: Record<string, { id: number; value: string }[]> = {};
  for (const c of catalogItems) {
    (catalogByKind[c.kind] = catalogByKind[c.kind] ?? []).push({ id: c.id, value: c.value });
  }

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Settings' }]} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="panel">
          <div className="tabs" id="settingsTabs">
            {TABS.map(t => (
              <Link key={t.v} href={`/admin/settings?tab=${t.v}`} className={`tab ${tab === t.v ? 'active' : ''}`}>
                {t.l}
              </Link>
            ))}
          </div>

          <div className="settings-section">
            <div className="settings-meta">
              {(META[tab] ?? []).map((clause, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span className="dot" />}
                  <span>{clause}</span>
                </span>
              ))}
            </div>

            {tab === 'providers' && <ProvidersForm initial={providers} />}

            {tab === 'notifications' && (
              <NotificationsForm initial={notifs} templates={templates.map(t => ({ id: t.id, name: t.name, channel: t.channel, trigger: t.trigger, updatedAt: t.updatedAt }))} />
            )}

            {tab === 'grace' && (
              <GraceRulesForm initial={{
                defaultGraceHours: grace.defaultGraceHours ?? 48,
                preRenewalReminderHours: grace.preRenewalReminderHours ?? 72,
                secondReminderHours: grace.secondReminderHours ?? 24,
                thirdReminderHours: grace.thirdReminderHours ?? 0,
                VIPGraceHours: grace.VIPGraceHours ?? 96,
                ProGraceHours: grace.ProGraceHours ?? 72,
                StandardGraceHours: grace.StandardGraceHours ?? 48,
                autoRenew24hBeforeExpiry: !!grace.autoRenew24hBeforeExpiry,
                keepProxyDuringGrace: !!grace.keepProxyDuringGrace,
                autoSuspendAfter3Fails: !!grace.autoSuspendAfter3Fails,
              }} />
            )}

            {tab === 'admins' && (
              <>
                <div className="panel-section">
                  <div className="panel-title-row">
                    <div className="vstack">
                      <span className="subsection-title">Admin users · {admins.length} active</span>
                      <span className="muted">Manage team access &amp; roles</span>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="dt">
                      <colgroup>
                        <col style={{ width: 220 }} />
                        <col style={{ width: 'calc(100% * 4 / 9)' }} />
                        <col style={{ width: 'calc(100% * 3 / 9)' }} />
                        <col style={{ width: 'calc(100% * 2 / 9)' }} />
                      </colgroup>
                      <thead><tr>
                        <th className="col-id">Admin</th>
                        <th className="col-text">Email</th>
                        <th className="col-text">Role</th>
                        <th className="col-date">Joined</th>
                      </tr></thead>
                      <tbody>
                        {admins.map(a => {
                          const rc = ROLE_CHIP[a.role] ?? { cls: '', label: a.role };
                          return (
                            <tr key={a.id}>
                              <td className="col-id">
                                <span className="hstack">
                                  <span className={`avatar sm role-${rc.cls}`}>{a.initials ?? a.name.charAt(0)}</span>
                                  <span className="td-primary">{a.name}</span>
                                </span>
                              </td>
                              <td className="col-text td-mono">{a.email}</td>
                              <td className="col-text"><span className={`role-chip ${rc.cls}`}>{rc.label}</span></td>
                              <td className="col-date">{fmtAdminStamp(a.createdAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel-section">
                  <span className="panel-title">Role permissions</span>
                  <div className="table-wrap">
                    <table className="dt">
                      <colgroup>
                        <col style={{ width: 'calc(100% * 5 / 11)' }} />
                        <col style={{ width: 'calc(100% * 2 / 11)' }} />
                        <col style={{ width: 'calc(100% * 2 / 11)' }} />
                        <col style={{ width: 'calc(100% * 2 / 11)' }} />
                      </colgroup>
                      <thead><tr>
                        <th className="col-text">Permission</th>
                        <th className="col-num">Super Admin</th>
                        <th className="col-num">Operations</th>
                        <th className="col-num">Support</th>
                      </tr></thead>
                      <tbody>
                        {PERMISSIONS.map(p => (
                          <tr key={p.label}>
                            <td className="col-text">{p.label}</td>
                            <td className={`col-num ${p.super === '—' ? 'muted' : 'tone-success'}`}>{p.super}</td>
                            <td className={`col-num ${p.ops === '—' ? 'muted' : 'tone-success'}`}>{p.ops}</td>
                            <td className={`col-num ${p.support === '—' ? 'muted' : 'tone-success'}`}>{p.support}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {tab === 'api' && (
              <div className="form-grid">
                <div className="form-field full"><div className="subsection-title">API keys &amp; webhooks</div></div>
                <div className="form-field full">
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    API key issuance and outbound webhook management ship in Phase 2 (<code>IMPLEMENTATION_BACKLOG.md</code> D9). The schema is in place (<code>api_keys</code>, <code>webhooks</code> tables); the operator UI follows. No keys are provisioned on this deployment yet.
                  </span>
                </div>
              </div>
            )}

            {tab === 'display' && <DisplayForm initial={{ timeFormat: display.timeFormat ?? 'UTC' }} />}

            {tab === 'catalog' && (
              <CatalogManager
                kinds={[
                  { kind: 'CARRIER',    label: 'Carriers' },
                  { kind: 'REGION',     label: 'Region / Location' },
                  { kind: 'PROTOCOL',   label: 'Protocols' },
                  { kind: 'ROTATION',   label: 'Rotation policies' },
                  { kind: 'TRAFFIC',    label: 'Traffic policies' },
                  { kind: 'POOL',       label: 'Proxy pools' },
                  { kind: 'DURATION',   label: 'Durations' },
                  { kind: 'VISIBILITY', label: 'Visibility' },
                  { kind: 'CURRENCY',   label: 'Currencies' },
                ]}
                items={catalogByKind}
              />
            )}

            {tab === 'provisioning' && (
              <ProvisioningRulesForm
                rules={provisioningRules}
                carriers={catalogItems.filter(c => c.kind === 'CARRIER').map(c => c.value)}
                regions={catalogItems.filter(c => c.kind === 'REGION').map(c => c.value)}
                pools={catalogItems.filter(c => c.kind === 'POOL').map(c => c.value)}
              />
            )}

            {tab === 'flags' && (
              <SystemFlagsForm initial={{
                systemAutoProvisionOnPayment: !!map.systemAutoProvisionOnPayment,
                autoReplaceOnFaulty: !!map.autoReplaceOnFaulty,
                autoReleaseAfterGrace: !!map.autoReleaseAfterGrace,
                require2FAForRefund: !!map.require2FAForRefund,
                requireNoteOnSuspend: !!map.requireNoteOnSuspend,
                freezeNewOrders: !!map.freezeNewOrders,
                flags: {
                  maxConcurrentOrdersPerClient: flags.maxConcurrentOrdersPerClient ?? 10,
                  maxProxyReplacementsPerOrder: flags.maxProxyReplacementsPerOrder ?? 3,
                  supportRefundCapUSD: flags.supportRefundCapUSD ?? 100,
                  discountCapWithoutSuperApprovalPercent: flags.discountCapWithoutSuperApprovalPercent ?? 15,
                },
              }} />
            )}

            {tab === 'announcements' && <AnnouncementForm initial={announcement} />}

            {tab === 'help' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20 }}>
                <div className="workflow-card placeholder">
                  <div className="workflow-card-num">01</div>
                  <div className="workflow-card-body">
                    <div className="workflow-card-title">New Order Workflow</div>
                    <div className="workflow-card-desc">Five-step pipeline from client checkout to credentials delivered.</div>
                    <div className="workflow-card-meta">
                      <span>5 steps</span><span className="wm-dot" />
                      <span>3 exception branches</span><span className="wm-dot" />
                      <span>new → provisioning → active</span>
                    </div>
                  </div>
                </div>
                <div className="workflow-card placeholder">
                  <div className="workflow-card-num">+</div>
                  <div className="workflow-card-body">
                    <div className="workflow-card-title">More workflows coming</div>
                    <div className="workflow-card-desc">Replacement · renewal · faulty-proxy · support · exception flows are queued for the production handoff.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
