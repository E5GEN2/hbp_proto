'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = { tone: string; title: string; meta: string; href: string };

// Canon notification popover (prototype §NOTIFICATION POPOVER), wired to the
// live ops feed (/api/admin/notifications): exception queues, grace, awaiting
// payments, refund requests. The old bell was a dead button with a permanent
// red dot; now the dot shows only when there is something to review, and the
// popover anchors to the bell (top = bell.bottom + 10, right-aligned), closing
// on outside click / scroll / resize — exactly the canon behaviour.
export function AdminNotifBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/notifications', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setRows(j.rows ?? []);
    } catch { /* transient — keep the last known rows */ }
  }, []);

  // Dot state: on mount + every 60s (ops queues move slowly; the popover
  // itself refetches on every open).
  useEffect(() => {
    fetchRows();
    const i = setInterval(fetchRows, 60_000);
    return () => clearInterval(i);
  }, [fetchRows]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const rect = btnRef.current!.getBoundingClientRect();
    setPos({ top: rect.bottom + 10, right: Math.max(8, window.innerWidth - rect.right) });
    fetchRows();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button ref={btnRef} className="notif-btn" type="button" aria-label="Notifications" onClick={toggle}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a4.5 4.5 0 0 1 4.5 4.5v2l1 2H1.5l1-2V6A4.5 4.5 0 0 1 7 1.5z" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" /></svg>
        {rows.length > 0 && <span className="notif-dot" />}
      </button>
      {open && pos && (
        <div ref={popRef} className="notif-popover" style={{ top: pos.top, right: pos.right, display: 'block' }}>
          <div className="notif-popover-header">
            <span className="notif-popover-title">Notifications</span>
            <span className="notif-popover-count">{rows.length === 0 ? 'All clear' : `${rows.length} to review`}</span>
          </div>
          <div className="notif-popover-body">
            {rows.length === 0 ? (
              <div className="notif-item static">
                <div className="notif-dot-strip" />
                <div className="notif-body">
                  <div className="notif-title">No pending exceptions</div>
                  <div className="notif-meta">Operational queue is empty.</div>
                </div>
              </div>
            ) : rows.map((r, i) => (
              <div key={i} className={`notif-item ${r.tone}`} onClick={() => go(r.href)}>
                <div className="notif-dot-strip" />
                <div className="notif-body">
                  <div className="notif-title">{r.title}</div>
                  <div className="notif-meta">{r.meta}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="notif-popover-footer" onClick={() => go('/admin/logs')}>View all in Admin Logs →</div>
        </div>
      )}
    </>
  );
}
