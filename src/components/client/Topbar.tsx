import { NotificationsBell } from './NotificationsBell';

export function ClientTopbar({ title, balance }: { title: string; balance: number }) {
  return (
    <header className="topbar">
      <div className="page-title">{title}</div>
      <div className="topbar-actions">
        <NotificationsBell initialBalance={balance} />
      </div>
    </header>
  );
}
