'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { recordNav, type NavEntry } from '@/lib/nav-history';

// Universal "← Back to {previous}" affordance (canon #backlinkSlot). Renders the
// previous screen from the runtime nav stack and returns there on click — the
// actual previous page, regardless of drill-down depth. Shared by both portals.
//
// Reads window.location.search (not useSearchParams) so it adds no Suspense
// requirement to every page; the query is captured so the backlink restores the
// list's filters/tab/page on return.
export function NavBacklink({ label }: { label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [prev, setPrev] = useState<NavEntry | null>(null);

  useEffect(() => {
    const full = pathname + (typeof window !== 'undefined' ? window.location.search : '');
    setPrev(recordNav(full, label));
  }, [pathname, label]);

  if (!prev) return null;
  return (
    <div className="backlink-slot">
      <button className="backlink" type="button" onClick={() => router.push(prev.path)}>
        <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Back to {prev.label}
      </button>
    </div>
  );
}
