'use client';
import { Fragment } from 'react';
import Link from 'next/link';
import { NotificationsBell } from './NotificationsBell';
import { NavBacklink } from '@/components/ui/NavBacklink';
import { MobileNavToggle } from '@/components/ui/MobileNav';
import { signalStructural } from '@/lib/nav-history';

type Crumb = { label: string; href?: string };

export function ClientTopbar({ title, breadcrumb, balance }: { title?: string; breadcrumb?: Crumb[]; balance: number }) {
  // Current-page label for the nav-history stack (canon getPageDisplayLabel).
  const currentLabel = breadcrumb && breadcrumb.length ? breadcrumb[breadcrumb.length - 1].label : (title ?? '');

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <MobileNavToggle />
          <div className="page-title">
            {breadcrumb
              ? breadcrumb.map((c, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="seg-sep">/</span>}
                    {c.href ? (
                      // Breadcrumb nav is a structural jump (canon clears the back stack).
                      <Link className="seg-muted" href={c.href} onClick={signalStructural}>
                        {c.label}
                      </Link>
                    ) : (
                      <span>{c.label}</span>
                    )}
                  </Fragment>
                ))
              : title}
          </div>
        </div>
        <div className="topbar-actions">
          <NotificationsBell initialBalance={balance} />
        </div>
      </header>
      <NavBacklink label={currentLabel} />
    </>
  );
}
