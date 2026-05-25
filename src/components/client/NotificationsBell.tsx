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
      {/* Topbar balance chip */}
      <Link href="/billing"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          fontSize: 12.5, color: 'var(--text)',
        }}>
        <span style={{ color: 'var(--muted)' }}>Balance</span>
        <span style={{ fontWeight: 650 }}>${balance.toLocaleString()}</span>
        <span style={{ color: 'var(--accent-text)', borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>Add funds</span>
      </Link>

      {/* Bell */}
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => { setOpen(v => !v); if (!open) markRead(); }}
          style={{
            position: 'relative', padding: 8,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-2)', color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34,
          }}
          title="Notifications"
        >
          🔔
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px',
              background: 'var(--danger)', color: 'white',
              borderRadius: 999, fontSize: 9.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{unread}</span>
          )}
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
