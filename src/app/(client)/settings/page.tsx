import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClientTopbar } from '@/components/client/Topbar';
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
            <form style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div><label className="form-label">Display name</label><input className="form-input" defaultValue={me.name} /></div>
              <div><label className="form-label">Telegram</label><input className="form-input" defaultValue={me.telegram ?? ''} placeholder="@handle" /></div>
              <div><label className="form-label">Country</label><select className="form-select" defaultValue={me.country ?? 'US'}><option>US</option><option>UK</option><option>DE</option><option>FR</option><option>IT</option><option>JP</option></select></div>
            </form>
            <div style={{ marginTop: 20 }}><button className="btn primary">Save</button></div>
          </div>
        )}
        {tab === 'security' && (
          <div className="panel" style={{ padding: 24, maxWidth: 720 }}>
            <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Change password</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div><label className="form-label">New password</label><input className="form-input" type="password" /></div>
              <div><label className="form-label">Confirm</label><input className="form-input" type="password" /></div>
            </div>
            <button className="btn primary" style={{ marginTop: 16 }}>Update password</button>
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '24px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>Two-factor authentication</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Add an extra step to sign-in.</div>
              </div>
              <span className={`toggle ${me.twoFactorEnabled ? 'on' : ''}`} />
            </div>
          </div>
        )}
        {tab === 'notifications' && (
          <div className="panel" style={{ padding: 24, maxWidth: 720 }}>
            <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Email notifications</h3>
            <PrefRow label="Renewal reminders"  value={me.emailRenewal} />
            <PrefRow label="Service incidents"  value={me.emailIncidents} />
            <PrefRow label="Product updates"    value={me.emailMarketing} />
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '24px 0' }} />
            <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Telegram notifications</h3>
            <PrefRow label="All notifications" value={me.telegramAll} />
          </div>
        )}
      </main>
    </>
  );
}

function PrefRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span className={`toggle ${value ? 'on' : ''}`} />
    </div>
  );
}
