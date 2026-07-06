'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Mobile nav drawer (C-6). The canon prototypes are desktop-only — at ≤768px
// the client shell used to hide the sidebar with no way to navigate. This
// layer is free design on top of canon: a burger in the topbar slides the
// canon sidebar in as an overlay drawer. Desktop is untouched — the toggle
// and backdrop only display inside the 768px breakpoint (globals.css).

type MobileNavState = { open: boolean; setOpen: (v: boolean) => void };
const MobileNavContext = createContext<MobileNavState>({ open: false, setOpen: () => {} });

export function useMobileNav() {
  return useContext(MobileNavContext);
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Route change = navigation happened — always land with the drawer closed.
  useEffect(() => { setOpen(false); }, [pathname]);

  // While open: Escape closes, body scroll stays locked behind the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>;
}

// Burger button — lives in the topbar, display:none above 768px.
export function MobileNavToggle() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      className="icon-btn nav-burger"
      type="button"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
    </button>
  );
}

// Click-away backdrop behind the drawer; only in the DOM while open.
export function MobileNavBackdrop() {
  const { open, setOpen } = useMobileNav();
  if (!open) return null;
  return <div className="sidebar-backdrop" onClick={() => setOpen(false)} />;
}
