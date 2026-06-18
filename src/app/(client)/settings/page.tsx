import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
import { ProfileForm, ChangePasswordForm, NotifPrefsForm } from '@/components/client/SettingsForm';
import Link from 'next/link';

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'security', label: 'Security' },
  { key: 'notifications', label: 'Notifications' },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) return null;
  const tab = (TABS.some(t => t.key === searchParams.tab) ? searchParams.tab : 'profile') as typeof TABS[number]['key'];
  const initials = me.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <ClientTopbar title="My Settings" balance={Number(me.balance)} />
      <main style={{ padding: '24px 32px 32px', overflowY: 'auto' }}>
        <div style={{ maxWidth: 'var(--page-w)', margin: '0 auto', width: '100%' }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">My Settings</span></div>
            <div className="tabs">
              {TABS.map(t => (
                <Link key={t.key} href={`/settings?tab=${t.key}`} className={`tab ${tab === t.key ? 'active' : ''}`}>{t.label}</Link>
              ))}
            </div>

            {tab === 'profile' && (
              <div className="settings-section">
                <div className="profile-header">
                  <div className="profile-avatar">{initials}</div>
                  <div className="profile-header-body">
                    <div className="profile-header-name-row">
                      <div className="profile-header-name">{me.name}</div>
                      {me.tier !== 'STANDARD' && <span className="client-tier">{me.tier}</span>}
                    </div>
                    <div className="profile-header-email">{me.email}</div>
                  </div>
                </div>
                <ProfileForm initial={{ name: me.name, telegram: me.telegram, country: me.country }} />
              </div>
            )}

            {tab === 'security' && (
              <>
                <div className="settings-section">
                  <div className="settings-section-title">Change password</div>
                  <ChangePasswordForm />
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Two-factor authentication</div>
                  <div className="toggle-row" style={{ paddingLeft: 0, paddingRight: 0, backgroundImage: 'none' }}>
                    <div className="toggle-row-body">
                      <div className="toggle-row-title">2FA via authenticator app</div>
                      <div className="toggle-row-caption">
                        {me.twoFactorEnabled ? 'Enabled — codes required at sign-in.' : 'Disabled — sign-in only requires your password.'}
                      </div>
                    </div>
                    <span
                      className={`toggle ${me.twoFactorEnabled ? 'on' : ''}`}
                      role="switch"
                      aria-checked={me.twoFactorEnabled}
                      title="2FA wizard ships in a follow-up batch"
                      style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    />
                  </div>
                </div>
              </>
            )}

            {tab === 'notifications' && (
              <NotifPrefsForm
                initial={{
                  emailRenewal: me.emailRenewal,
                  emailIncidents: me.emailIncidents,
                  emailMarketing: me.emailMarketing,
                  telegramAll: me.telegramAll,
                }}
                email={me.email}
              />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
