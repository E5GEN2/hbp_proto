export function AdminTopbar({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header style={{
      height: 'var(--topbar-h)', flexShrink: 0,
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16,
    }}>
      <h1 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{title}</h1>
      <div style={{ flex: 1 }} />
      {action}
    </header>
  );
}
