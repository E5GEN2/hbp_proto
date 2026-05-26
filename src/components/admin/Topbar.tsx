import Link from 'next/link';

export type Crumb = { label: string; href?: string };

export function AdminTopbar({
  title,
  crumbs,
  action,
}: {
  title?: string;
  crumbs?: Crumb[];
  action?: React.ReactNode;
}) {
  return (
    <header style={{
      height: 'var(--topbar-h)', flexShrink: 0,
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16,
    }}>
      {crumbs && crumbs.length > 0 ? (
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {c.href ? (
                <Link href={c.href} style={{ color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--muted)', fontWeight: i === crumbs.length - 1 ? 650 : 500 }}>
                  {c.label}
                </Link>
              ) : (
                <span style={{ color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--muted)', fontWeight: i === crumbs.length - 1 ? 650 : 500 }}>
                  {c.label}
                </span>
              )}
              {i < crumbs.length - 1 && <span style={{ color: 'var(--text-disabled)' }}>/</span>}
            </span>
          ))}
        </h1>
      ) : (
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{title}</h1>
      )}
      <div style={{ flex: 1 }} />
      {action}
    </header>
  );
}
