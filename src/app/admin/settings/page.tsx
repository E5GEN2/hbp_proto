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
import { fmtAdminStamp } from '@/lib/date';

const TABS = [
  { v: 'providers',    l: 'Payment Providers' },
  { v: 'notifications',l: 'Notifications' },
  { v: 'grace',        l: 'Grace Rules' },
  { v: 'admins',       l: 'Admin Users' },
  { v: 'api',          l: 'API / Webhooks' },
  { v: 'display',      l: 'Display' },
  { v: 'catalog',      l: 'Catalog' },
  { v: 'provisioning', l: 'Provisioning' },
  { v: 'flags',        l: 'System Flags' },
  { v: 'help',         l: 'Help & Process' },
];

export default async function AdminSettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab ?? 'flags';
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

  const catalogByKind: Record<string, { id: number; value: string }[]> = {};
  for (const c of catalogItems) {
    (catalogByKind[c.kind] = catalogByKind[c.kind] ?? []).push({ id: c.id, value: c.value });
  }

  return (
    <>
      <AdminTopbar crumbs={[{ label: 'Settings' }]} />
      <main style={{ padding: 24, overflowY: 'auto', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map(t => (
            <Link key={t.v} href={`/admin/settings?tab=${t.v}`}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-md)',
                background: tab === t.v ? 'var(--surface-3)' : 'transparent',
                color: tab === t.v ? 'var(--text)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 500,
              }}>
              {t.l}
            </Link>
          ))}
        </nav>

        <div className="panel" style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: 15, marginBottom: 20 }}>{TABS.find(t => t.v === tab)?.l}</h3>

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

          {tab === 'display' && <DisplayForm initial={{ timeFormat: display.timeFormat ?? 'UTC' }} />}

          {tab === 'catalog' && (
            <CatalogManager
              kinds={[
                { kind: 'CARRIER',    label: 'Carriers' },
                { kind: 'REGION',     label: 'Regions' },
                { kind: 'POOL',       label: 'Pools' },
                { kind: 'PROTOCOL',   label: 'Protocols' },
                { kind: 'ROTATION',   label: 'Rotation policies' },
                { kind: 'TRAFFIC',    label: 'Traffic policies' },
                { kind: 'DURATION',   label: 'Durations' },
                { kind: 'VISIBILITY', label: 'Visibility' },
                { kind: 'CURRENCY',   label: 'Currencies' },
              ]}
              items={catalogByKind}
            />
          )}

          {tab === 'providers' && (<ProvidersForm initial={providers} />)}

          {tab === 'notifications' && (
            <NotificationsForm initial={notifs} templates={templates.map(t => ({ id: t.id, name: t.name, channel: t.channel, trigger: t.trigger, updatedAt: t.updatedAt }))} />
          )}

          {tab === 'provisioning' && (
            <ProvisioningRulesForm
              rules={provisioningRules}
              carriers={catalogItems.filter(c => c.kind === 'CARRIER').map(c => c.value)}
              regions={catalogItems.filter(c => c.kind === 'REGION').map(c => c.value)}
              pools={catalogItems.filter(c => c.kind === 'POOL').map(c => c.value)}
            />
          )}

          {tab === 'admins' && (
            <div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Admin</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
                  <tbody>
                    {admins.map(a => (
                      <tr key={a.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="avatar" style={{ width: 24, height: 24, fontSize: 10, background: a.avatarColor ?? 'var(--surface-3)', color: 'white' }}>{a.initials ?? a.name.charAt(0)}</span>
                            {a.name}
                          </div>
                        </td>
                        <td>{a.email}</td>
                        <td><span className={`chip ${a.role === 'ADMIN_SUPER' ? 'accent' : a.role === 'ADMIN_OPS' ? 'info' : 'muted'}`}>{a.role.replace('ADMIN_', '').toLowerCase()}</span></td>
                        <td>{fmtAdminStamp(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 16, padding: 14, background: 'var(--info-dim)', color: 'var(--info)', borderRadius: 8, fontSize: 12 }}>
                Phase 1 = super-admin only per <code>ADMIN_HANDOFF.md</code>. Granular RBAC matrix (Ops / Support) + Invite admin + 2FA enrollment ship in Phase 2.
              </div>
            </div>
          )}

          {tab === 'api' && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <p>API key + outbound webhooks management ships in Phase 2 per the spec (<code>IMPLEMENTATION_BACKLOG.md</code> D9).</p>
              <p style={{ marginTop: 6, fontSize: 11.5 }}>Schema is in place (<code>api_keys</code>, <code>webhooks</code> tables). UI follow-up.</p>
            </div>
          )}

          {tab === 'help' && (
            <div>
              <h4 style={{ margin: '0 0 12px', color: 'var(--text)' }}>Workflow diagrams</h4>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                The proxy-handoff repo includes a single workflow doc (<code>flow.html</code>) covering the new-order flow. Additional diagrams (replacement, renewal, faulty, support, exceptions) are queued for production handoff.
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
