'use client';
import { useEffect } from 'react';

// Canon tooltip floater (prototype.html "TOOLTIP FLOATER") — one body-attached
// element shared by every `.help-tip` icon and `.cell-tip` truncated cell.
// Ported 1:1: smart positioning (above the trigger, flipping/clamping at the
// viewport edges) and the line-box width shrink that keeps left/right padding
// symmetric after max-width wrapping. Mount once per portal layout.
export function TipFloater() {
  useEffect(() => {
    const floater = document.createElement('div');
    floater.className = 'help-floater';
    document.body.appendChild(floater);

    function show(trigger: Element) {
      const text = (trigger as HTMLElement).dataset.tip;
      if (!text) return;
      floater.textContent = text;
      floater.style.width = '';
      floater.classList.add('visible');

      try {
        const range = document.createRange();
        range.selectNodeContents(floater);
        let maxLine = 0;
        for (const r of Array.from(range.getClientRects())) if (r.width > maxLine) maxLine = r.width;
        if (maxLine > 0) {
          const cs = getComputedStyle(floater);
          const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          const bor = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
          floater.style.width = Math.ceil(maxLine + pad + bor) + 'px';
        }
      } catch { /* noop */ }

      const rect = trigger.getBoundingClientRect();
      const tw = floater.offsetWidth;
      const th = floater.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      const margin = 8;
      let top = rect.top - th - margin;
      let left = rect.left + rect.width / 2 - tw / 2;
      if (top < margin) top = rect.bottom + margin;
      if (top + th > vh - margin) top = Math.max(margin, vh - th - margin);
      if (left < margin) left = margin;
      if (left + tw > vw - margin) left = vw - tw - margin;
      floater.style.top = top + 'px';
      floater.style.left = left + 'px';
    }
    const hide = () => floater.classList.remove('visible');

    function onOver(e: MouseEvent) {
      const t = e.target as Element;
      const ht = t.closest('.help-tip');
      if (ht) { show(ht); return; }
      // .cell-tip opens ONLY when the text is actually clipped.
      const ct = t.closest('.cell-tip');
      if (ct && ct.scrollWidth > ct.clientWidth) show(ct);
    }
    function onOut(e: MouseEvent) {
      if ((e.target as Element).closest('.help-tip, .cell-tip')) hide();
    }

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      floater.remove();
    };
  }, []);

  return null;
}
