import { NotificationsBell } from './NotificationsBell';

export function ClientTopbar({ title, balance }: { title: string; balance: number }) {
  return (
    <header className="topbar">
      <h1 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{title}</h1>
      <div style={{ flex: 1 }} />
      <NotificationsBell initialBalance={balance} />
    </header>
  );
}
