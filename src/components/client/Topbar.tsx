import { Fragment } from 'react';
import Link from 'next/link';
import { NotificationsBell } from './NotificationsBell';

type Crumb = { label: string; href?: string };

export function ClientTopbar({ title, breadcrumb, balance }: { title?: string; breadcrumb?: Crumb[]; balance: number }) {
  return (
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
  );
}
