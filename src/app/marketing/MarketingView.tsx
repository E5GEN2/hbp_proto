'use client';
import { useEffect, useRef } from 'react';

// Renders the ported marketing markup and re-attaches the design's only piece of
// JS: the Privacy/Terms <dialog> open/close behaviour (the source <script> can't run
// from dangerouslySetInnerHTML). FAQ uses native <details>, so it needs no JS.
export function MarketingView({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];

    root.querySelectorAll<HTMLElement>('[data-legal]').forEach((link) => {
      const onClick = (e: Event) => {
        e.preventDefault();
        const d = document.getElementById(link.getAttribute('data-legal') || '') as HTMLDialogElement | null;
        if (d && typeof d.showModal === 'function') d.showModal();
      };
      link.addEventListener('click', onClick);
      cleanups.push(() => link.removeEventListener('click', onClick));
    });

    root.querySelectorAll<HTMLDialogElement>('.legal-modal').forEach((d) => {
      const body = d.querySelector<HTMLElement>('.legal-modal__body');
      const closeBtn = d.querySelector('.legal-modal__close');
      const onClose = () => d.close();
      const onBackdrop = (e: MouseEvent) => { if (e.target === d) d.close(); };
      const onDialogClose = () => { if (body) body.scrollTop = 0; };
      closeBtn?.addEventListener('click', onClose);
      d.addEventListener('click', onBackdrop);
      d.addEventListener('close', onDialogClose);
      cleanups.push(() => {
        closeBtn?.removeEventListener('click', onClose);
        d.removeEventListener('click', onBackdrop);
        d.removeEventListener('close', onDialogClose);
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [html]);

  return <div className="mkt" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
