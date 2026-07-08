'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtAdminStamp } from '@/lib/date';

type Notif = { id: string; title: string; kind: string; link: string | null; createdAt: string };

// kind → canon .notif-item tone strip
const TONE: Record<string, string> = { SUCCESS: 'success', WARNING: 'warn', DANGER: 'danger', INFO: 'info' };

// Client notification feed in the canon popover shell (prototype
// §NOTIFICATION POPOVER): fixed-position, anchored to the bell
// (top = bell.bottom + 10, right-aligned, never covers the icon), closes on
// outside click / scroll / resize. UX: rows newer than the read watermark
// render full-strength with their kind-coloured strip; opening does NOT
// wipe that — the watermark advances when the popover CLOSES, so you can
// actually see what's new while it's open.
export function NotificationsBell({ initialBalance }: { initialBalance: number }) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [lastReadAt, setLastReadAt] = useState<string>(new Date(0).toISOString());
  const [balance, setBalance] = useState(initialBalance);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);

  const fetchAll = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setNotifs(j.notifs);
      setBalance(j.balance);
      // While the popover is open, freeze the unread state the user is
      // looking at — the poll must not re-shuffle highlights under them.
      if (!openRef.current) {
        setUnread(j.unread);
        setLastReadAt(j.lastReadAt ?? new Date(0).toISOString());
      }
    } catch { /* transient network error — keep last known state */ }
  }, []);

  useEffect(() => {
    fetchAll();
    // poll every 15s so admin actions show up live without manual reload
    const i = setInterval(fetchAll, 15_000);
    return () => clearInterval(i);
  }, [fetchAll]);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    // Advance the read watermark on CLOSE — everything the user just saw is
    // now read; the dot clears and rows dim on the next open.
    fetch('/api/notifications', { method: 'POST' }).then(() => {
      setUnread(0);
      setLastReadAt(new Date().toISOString());
    }).catch(() => { /* retried by the next open */ });
  }, []);

  function toggle() {
    if (openRef.current) { close(); return; }
    const rect = btnRef.current!.getBoundingClientRect();
    setPos({ top: rect.bottom + 10, right: Math.max(8, window.innerWidth - rect.right) });
    fetchAll();
    openRef.current = true;
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onScroll = (e: Event) => {
      // Scrolling INSIDE the popover body must not close it
      if (popRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <>
      {/* Topbar balance chip — canon: wallet icon + value + Add funds CTA */}
      <div className="topbar-balance">
        <span className="topbar-balance-icon">
          <svg viewBox="0 0 24 24"><path d="M21 7H5a2 2 0 00-2 2v8a2 2 0 002 2h16a1 1 0 001-1V8a1 1 0 00-1-1zM3 7V6a2 2 0 012-2h13" /><circle cx="17" cy="13" r="1.5" fill="currentColor" /></svg>
        </span>
        <span className="topbar-balance-value">${balance.toLocaleString()}</span>
        <Link className="btn ghost topbar-balance-cta" href="/checkout?kind=deposit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg> Add funds
        </Link>
      </div>

      {/* Bell */}
      <button ref={btnRef} className="icon-btn" onClick={toggle} title="Notifications">
        <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 004 0" /></svg>
        {unread > 0 && <span className="notif-dot" />}
      </button>
      {open && pos && (
        <div ref={popRef} className="notif-popover" style={{ top: pos.top, right: pos.right, display: 'block' }}>
          <div className="notif-popover-header">
            <span className="notif-popover-title">Notifications</span>
            <span className="notif-popover-count">{unread > 0 ? `${unread} new` : 'All caught up'}</span>
          </div>
          <div className="notif-popover-body">
            {notifs.length === 0 ? (
              <div className="notif-item static">
                <div className="notif-dot-strip" />
                <div className="notif-body">
                  <div className="notif-title">No notifications yet</div>
                  <div className="notif-meta">Order and payment updates will appear here.</div>
                </div>
              </div>
            ) : notifs.map(n => {
              const isUnread = n.createdAt > lastReadAt;
              const cls = `notif-item ${TONE[n.kind] ?? 'info'} ${isUnread ? '' : 'read'}`;
              const body = (
                <>
                  <div className="notif-dot-strip" />
                  <div className="notif-body">
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-meta">{fmtAdminStamp(new Date(n.createdAt))}</div>
                  </div>
                </>
              );
              return n.link ? (
                <Link key={n.id} href={n.link} className={cls} onClick={() => { close(); }}>{body}</Link>
              ) : (
                <div key={n.id} className={`${cls} static`}>{body}</div>
              );
            })}
          </div>
          {notifs.length > 0 && (
            <div className="notif-popover-footer" onClick={() => { close(); router.refresh(); }}>Mark all read</div>
          )}
        </div>
      )}
    </>
  );
}
