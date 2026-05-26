'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ToastTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
export type Toast = { id: string; title: string; detail?: string; tone: ToastTone };

const Ctx = createContext<{ toast: (title: string, detail?: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((title: string, detail?: string, tone: ToastTone = 'default') => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems(t => [...t, { id, title, detail, tone }]);
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container">
        {items.map(t => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
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
