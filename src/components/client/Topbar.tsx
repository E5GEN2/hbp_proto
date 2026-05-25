import { NotificationsBell } from './NotificationsBell';

export function ClientTopbar({ title, balance }: { title: string; balance: number }) {
  return (
    <header style={{
      height: 'var(--topbar-h)', flexShrink: 0,
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12,
    }}>
      <h1 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{title}</h1>
      <div style={{ flex: 1 }} />
      <NotificationsBell initialBalance={balance} />
    </header>
  );
}
