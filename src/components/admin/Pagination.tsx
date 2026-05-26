import Link from 'next/link';

export function Pagination({
  total, page, perPage, basePath, search,
}: {
  total: number;
  page: number;
  perPage: number;
  basePath: string;
  search: URLSearchParams;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  function href(p: number) {
    const sp = new URLSearchParams(search);
    sp.set('page', String(p));
    return `${basePath}?${sp.toString()}`;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', fontSize: 12.5, color: 'var(--muted)' }}>
      <span>Showing {from}–{to} of {total}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <Link href={href(Math.max(1, page - 1))} className="btn sm" style={{ pointerEvents: page <= 1 ? 'none' : undefined, opacity: page <= 1 ? 0.4 : 1 }}>‹</Link>
        {Array.from({ length: pages }).slice(0, 7).map((_, i) => (
          <Link key={i} href={href(i + 1)} className={`btn sm`} style={page === i + 1 ? { background: 'var(--surface-3)', borderColor: 'var(--border-strong)' } : undefined}>
            {i + 1}
          </Link>
        ))}
        <Link href={href(Math.min(pages, page + 1))} className="btn sm" style={{ pointerEvents: page >= pages ? 'none' : undefined, opacity: page >= pages ? 0.4 : 1 }}>›</Link>
      </div>
    </div>
  );
}
