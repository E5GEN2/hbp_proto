import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AdminTopbar } from '@/components/admin/Topbar';

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
  const tab = searchParams.tab ?? 'providers';
  const settings = await prisma.systemSetting.findMany();
  const map = Object.fromEntries(settings.map(s => [s.key, s.value]));

  const providers = (map.providers ?? {}) as any;
  const grace = (map.grace ?? {}) as any;
  const flags = (map.flags ?? {}) as any;

  return (
    <>
      <AdminTopbar title="Settings" />
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
          {tab === 'providers' && (
            <>
              <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: 15 }}>Payment Providers</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 16 }}>
                <ProviderCard name="Stripe"        enabled={!!providers.stripe?.enabled} detail={providers.stripe?.accountId ?? '—'} />
                <ProviderCard name="CoinPayments"  enabled={!!providers.crypto?.enabled} detail={`Confirmations: ${providers.crypto?.confirmations ?? 1} · ${(providers.crypto?.currencies ?? []).join(', ')}`} />
                <ProviderCard name="Bank transfer" enabled={!!providers.bank?.enabled}   detail="Manual reconciliation" />
                <ProviderCard name="PayPal"        enabled={!!providers.paypal?.enabled} detail="Not configured" />
              </div>
            </>
          )}
          {tab === 'flags' && (
            <>
              <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: 15 }}>System Flags</h3>
              <div style={{ marginTop: 16 }}>
                <FlagRow label="Freeze new orders" value={!!map.freezeNewOrders} />
                <FlagRow label="Auto-replace on faulty proxy" value={!!map.autoReplaceOnFaulty} />
                <FlagRow label="Auto-release after grace" value={!!map.autoReleaseAfterGrace} />
                <FlagRow label="Auto-provision on payment confirm" value={!!map.systemAutoProvisionOnPayment} />
                <FlagRow label="Require 2FA for refund" value={!!map.require2FAForRefund} />
                <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '16px 0' }} />
                <NumRow label="Max concurrent orders per client" value={flags.maxConcurrentOrdersPerClient} />
                <NumRow label="Max proxy replacements per order" value={flags.maxProxyReplacementsPerOrder} />
                <NumRow label="Support refund cap (USD)" value={`$${flags.supportRefundCapUSD}`} />
                <NumRow label="Discount cap without Super approval (%)" value={`${flags.discountCapWithoutSuperApprovalPercent}%`} />
              </div>
            </>
          )}
          {tab === 'grace' && (
            <>
              <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: 15 }}>Grace Rules</h3>
              <NumRow label="Default grace period (h)" value={grace.defaultGraceHours} />
              <NumRow label="Pre-renewal reminder (h)" value={grace.preRenewalReminderHours} />
              <NumRow label="VIP grace (h)" value={grace.VIPGraceHours} />
              <NumRow label="Pro grace (h)" value={grace.ProGraceHours} />
              <NumRow label="Standard grace (h)" value={grace.StandardGraceHours} />
              <FlagRow label="Auto-renew 24h before expiry" value={!!grace.autoRenew24hBeforeExpiry} />
              <FlagRow label="Keep proxy during grace" value={!!grace.keepProxyDuringGrace} />
              <FlagRow label="Auto-suspend after 3 failed renewals" value={!!grace.autoSuspendAfter3Fails} />
            </>
          )}
          {tab !== 'providers' && tab !== 'flags' && tab !== 'grace' && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <h3 style={{ color: 'var(--text)', marginTop: 0 }}>{TABS.find(t => t.v === tab)?.l}</h3>
              <p>Tab content for this section is rendered live from the database. UI controls coming in next iteration.</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function ProviderCard({ name, enabled, detail }: { name: string; enabled: boolean; detail: string }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
        <span className={`chip ${enabled ? 'success' : 'muted'}`}>{enabled ? 'Connected' : 'Disabled'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{detail}</div>
    </div>
  );
}
function FlagRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} />
    </div>
  );
}
function NumRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="kv-row"><span className="kv-label">{label}</span><span className="kv-val mono">{value ?? '—'}</span></div>
  );
}
