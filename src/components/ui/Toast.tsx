'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export type ToastTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
export type Toast = { id: string; title: string; detail?: string; tone: ToastTone };

const Ctx = createContext<{ toast: (title: string, detail?: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  // The container lives at the app root, outside the .theme-* shells, so its
  // vars resolve to :root (= client theme). On admin, remap the colour tokens
  // to dark via `on-admin` so toasts match the dark notification centre.
  const pathname = usePathname();
  const onAdmin = pathname?.startsWith('/admin') ?? false;
  const toast = useCallback((title: string, detail?: string, tone: ToastTone = 'default') => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems(t => [...t, { id, title, detail, tone }]);
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {/* Toasts read as notification-center messages (owner): same anchor as
          the bell popover (below the topbar, right-aligned) and the same
          .notif-* card visual — coloured tone strip + title + meta. */}
      <div className={`toast-container${onAdmin ? ' on-admin' : ''}`}>
        {items.map(t => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            <div className="notif-dot-strip" />
            <div className="notif-body">
              <div className="notif-title">{t.title}</div>
              {t.detail && <div className="notif-meta">{t.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used within ToastProvider');
  return c.toast;
}
