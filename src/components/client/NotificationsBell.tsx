'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Notif = { id: string; title: string; kind: string; link: string | null; createdAt: string };

export function NotificationsBell({ initialBalance }: { initialBalance: number }) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [balance, setBalance] = useState(initialBalance);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  async function fetchAll() {
    const r = await fetch('/api/notifications', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    setNotifs(j.notifs);
    setUnread(j.unread);
    setBalance(j.balance);
  }

  useEffect(() => {
    fetchAll();
    // poll every 5s so admin actions show up live without manual reload
    const i = setInterval(fetchAll, 5_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markRead() {
    await fetch('/api/notifications', { method: 'POST' });
    setUnread(0);
  }

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
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          className="icon-btn"
          onClick={() => { setOpen(v => !v); if (!open) markRead(); }}
          title="Notifications"
        >
          <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 004 0" /></svg>
          {unread > 0 && <span className="notif-dot" />}
        </button>
        {open && (
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
            width: 360, maxHeight: 400, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 50,
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)' }}>Notifications</div>
              <button onClick={() => { setOpen(false); router.refresh(); }} style={{ fontSize: 11, color: 'var(--muted)' }}>Refresh page</button>
            </div>
            {notifs.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>No notifications yet.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {notifs.map(n => {
                  const body = (
                    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span style={{
                        width: 6, height: 6, marginTop: 6, borderRadius: '50%', flexShrink: 0,
                        background:
                          n.kind === 'SUCCESS' ? 'var(--success)' :
                          n.kind === 'WARNING' ? 'var(--warning)' :
                          n.kind === 'DANGER' ? 'var(--danger)' : 'var(--info)',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.4 }}>{n.title}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? <Link href={n.link} onClick={() => setOpen(false)}>{body}</Link> : body}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
