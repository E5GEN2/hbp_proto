import { Fragment } from 'react';
import Link from 'next/link';
import { GlobalNewOrder } from './shell/NewOrderContext';

export type Crumb = { label: string; href?: string };

// Canon topbar (prototype.html): single-line route title on the left
// (parent segments muted + clickable, current segment white, slash separators),
// and global [bell][New Order] chrome on the right — present on every page.
// `action` is a transitional slot for page-specific primaries that have not yet
// been relocated to their page filter-bar; it renders left of the bell.
//
// Canon roots EVERY non-dashboard route at a clickable "Dashboard" segment
// (withDashboardRoot): "Dashboard / Orders", "Dashboard / Orders / Order ORD-…".
// So when `crumbs` is given we prepend the Dashboard root automatically; a bare
// `title` (the dashboard page itself) renders a single current segment.
const DASHBOARD_ROOT: Crumb = { label: 'Dashboard', href: '/admin' };

export function AdminTopbar({
  title,
  crumbs,
  action,
}: {
  title?: string;
  crumbs?: Crumb[];
  action?: React.ReactNode;
}) {
  const segs: Crumb[] =
    crumbs && crumbs.length > 0
      ? (crumbs[0].label === 'Dashboard' ? crumbs : [DASHBOARD_ROOT, ...crumbs])
      : [{ label: title ?? '' }];

  // Universal backlink (canon #backlinkSlot): "← Back to {previous}". Canon
  // drives it off a runtime history stack — entity links (rows/KPI tiles) push,
  // sidebar/breadcrumb nav clears. We approximate that statically with the
  // nearest LINKABLE ancestor below the current screen (the page's structural
  // parent list), matching the client portal. Top-level list pages have only
  // the Dashboard root as a linkable ancestor (not in `crumbs`), so they show
  // no backlink — exactly as the sidebar-reached canon pages clear the stack.
  const backlinkParent =
    crumbs && crumbs.length > 1 ? [...crumbs.slice(0, -1)].reverse().find(c => c.href) : undefined;

  return (
    <>
    <header className="topbar">
      <div className="topbar-left">
        <div className="page-title">
          {segs.map((c, i) => {
            const isLast = i === segs.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <span className="route-sep">/</span>}
                {!isLast && c.href ? (
                  <Link className="route-seg parent" href={c.href}>{c.label}</Link>
                ) : (
                  <span className={`route-seg ${isLast ? 'current' : 'parent'}`}>{c.label}</span>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="topbar-right">
        {action}
        <button className="notif-btn" type="button" aria-label="Notifications">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1.5a4.5 4.5 0 0 1 4.5 4.5v2l1 2H1.5l1-2V6A4.5 4.5 0 0 1 7 1.5z" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <span className="notif-dot" />
        </button>
        <GlobalNewOrder />
      </div>
    </header>
    {backlinkParent && (
      <div className="backlink-slot">
        <Link className="backlink" href={backlinkParent.href!}>
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back to {backlinkParent.label}
        </Link>
      </div>
    )}
    </>
  );
}
