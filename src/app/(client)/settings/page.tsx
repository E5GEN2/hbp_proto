import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ProfileForm, ChangePasswordForm, NotifPrefsForm } from '@/components/client/SettingsForm';
import Link from 'next/link';

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) return null;
  const tab = searchParams.tab ?? 'profile';

  return (
    <>
      <ClientTopbar title="My Settings" balance={Number(me.balance)} />
      <main style={{ padding: 24, overflowY: 'auto' }}>
        <div className="tabs" style={{ marginBottom: 24 }}>
          <Link href="/settings?tab=profile"       className={`tab ${tab === 'profile' ? 'active' : ''}`}>Profile</Link>
          <Link href="/settings?tab=security"      className={`tab ${tab === 'security' ? 'active' : ''}`}>Security</Link>
          <Link href="/settings?tab=notifications" className={`tab ${tab === 'notifications' ? 'active' : ''}`}>Notifications</Link>
        </div>

        {tab === 'profile' && (
          <div className="panel" style={{ padding: 24, maxWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <span className="avatar" style={{ width: 56, height: 56, fontSize: 18 }}>{me.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 17, fontWeight: 650, color: 'var(--text)' }}>{me.name}</div>
                  {me.tier !== 'STANDARD' && <span className={`chip ${me.tier === 'VIP' ? 'accent' : 'info'}`}>{me.tier.toLowerCase()}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{me.email}</div>
              </div>
            </div>
            <ProfileForm initial={{ name: me.name, telegram: me.telegram, country: me.country }} />
          </div>
        )}

        {tab === 'security' && (
          <div className="panel" style={{ padding: 24, maxWidth: 720 }}>
            <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Change password</h3>
            <ChangePasswordForm />
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '24px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>Two-factor authentication</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Add an extra step to sign-in.</div>
              </div>
              <span className={`toggle ${me.twoFactorEnabled ? 'on' : ''}`} style={{ opacity: 0.5, cursor: 'not-allowed' }} title="2FA wizard ships in a follow-up batch" />
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="panel" style={{ padding: 24, maxWidth: 720 }}>
            <NotifPrefsForm initial={{
              emailRenewal: me.emailRenewal,
              emailIncidents: me.emailIncidents,
              emailMarketing: me.emailMarketing,
              telegramAll: me.telegramAll,
            }} />
          </div>
        )}
      </main>
    </>
  );
}
