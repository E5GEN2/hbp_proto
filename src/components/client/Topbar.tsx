import { Fragment } from 'react';
import Link from 'next/link';
import { NotificationsBell } from './NotificationsBell';

type Crumb = { label: string; href?: string };

export function ClientTopbar({ title, breadcrumb, balance }: { title?: string; breadcrumb?: Crumb[]; balance: number }) {
  // Contextual back affordance (canon #backlinkSlot): "← Back to {parent}".
  // Canon drives this off a runtime history stack; here we derive the nearest
  // linkable ancestor from the breadcrumb (the immediate structural parent),
  // which matches the "where did I come from" target in the common case.
  const parent = breadcrumb ? [...breadcrumb].reverse().find(c => c.href) : undefined;

  return (
    <>
      <header className="topbar">
        <div className="page-title">
          {breadcrumb
            ? breadcrumb.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="seg-sep">/</span>}
                  {c.href ? (
                    <Link className="seg-muted" href={c.href}>
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </Fragment>
              ))
            : title}
        </div>
        <div className="topbar-actions">
          <NotificationsBell initialBalance={balance} />
        </div>
      </header>
      {parent && (
        <div className="backlink-slot">
          <Link className="backlink" href={parent.href!}>
            <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            Back to {parent.label}
          </Link>
        </div>
      )}
    </>
  );
}
