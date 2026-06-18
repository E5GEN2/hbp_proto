import Link from 'next/link';

// Windowed page list with ellipsis, e.g. 1 … 4 5 6 … 85
function pageWindow(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const lo = Math.max(2, cur - 1);
  const hi = Math.min(total - 1, cur + 1);
  if (lo > 2) out.push('…');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < total - 1) out.push('…');
  out.push(total);
  return out;
}

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
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  function href(p: number) {
    const sp = new URLSearchParams(search);
    sp.set('page', String(p));
    return `${basePath}?${sp.toString()}`;
  }

  return (
    <div className="pagination">
      <div className="pagination-info">Showing {from}–{to} of {total}</div>
      <div className="pagination-nav">
        <Link href={href(Math.max(1, page - 1))} className={`page-btn ${page <= 1 ? 'disabled' : ''}`} aria-label="Previous">‹</Link>
        {pageWindow(page, pages).map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="page-btn disabled">…</span>
          ) : (
            <Link key={n} href={href(n)} className={`page-btn ${page === n ? 'active' : ''}`}>{n}</Link>
          ),
        )}
        <Link href={href(Math.min(pages, page + 1))} className={`page-btn ${page >= pages ? 'disabled' : ''}`} aria-label="Next">›</Link>
      </div>
    </div>
  );
}
