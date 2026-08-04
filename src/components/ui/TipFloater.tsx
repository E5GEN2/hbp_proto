'use client';
import { useEffect } from 'react';

// Canon tooltip floater (prototype.html "TOOLTIP FLOATER") — one body-attached
// element shared by every `.help-tip` icon, `.cell-tip` truncated cell and
// bare `[data-tip]` element. Smart positioning (above the trigger, flipping/
// clamping at the viewport edges) and a line-box width shrink that keeps
// left/right padding symmetric after max-width wrapping. Mount once per
// portal layout.
//
// Rewritten 2026-08-03 (owner: "окно криво работает") — the fixes, each tied
// to a measured defect:
//  - reset inline left/top/width BEFORE measuring: the shrink-to-fit used to
//    measure while the floater still sat at the PREVIOUS tip's left, so
//    near-right-edge positions capped the line boxes and produced a skinny
//    110px×446px column instead of a 313px×121px box;
//  - `current` trigger memo + relatedTarget guard: crossing child elements
//    (the <a> inside a cell) fired hide→show→re-measure per boundary — a
//    visible flicker and a progressive shrink;
//  - stuck-tip release: rows removed by re-render fire no mouseout; the
//    onOver no-trigger branch now hides the orphaned tip on the next move;
//  - bare [data-tip] fallback: chips carry data-tip without .cell-tip (e.g.
//    the client Maintenance chip) — they never matched either selector;
//  - side-choice clamp: when neither side fits, pick the LARGER side and cap
//    height there instead of sliding the tip back over the trigger row;
//  - scrollbar-aware clamps: window.innerWidth includes the scrollbar
//    gutter, so right-edge tips could start under the bar; use
//    documentElement.clientWidth/Height;
//  - clip gate kept as `>= 1`: scrollWidth/clientWidth are integer-rounded
//    per spec, so this equals the old `>` gate — the form just states the
//    intent (a full pixel of real overflow) explicitly.
export function TipFloater() {
  useEffect(() => {
    const floater = document.createElement('div');
    floater.className = 'help-floater';
    // Mount INSIDE the portal shell, not on <body>: body sits outside the
    // .theme-admin/.theme-client scope, so the floater resolved :root
    // (client-light) variables — cream tooltips on the dark admin. As a shell
    // CHILD it inherits the theme variables; copying the theme CLASS onto the
    // floater instead is a trap — shell classes carry element-level layout
    // rules (.theme-admin { min-width: 1280px } stretched the tooltip to a
    // full-row line with dead space). position:fixed keeps it
    // viewport-anchored (the shell creates no containing block).
    const host = document.querySelector('.theme-admin, .theme-client') ?? document.body;
    host.appendChild(floater);

    let current: Element | null = null;

    function show(trigger: Element) {
      const text = (trigger as HTMLElement).dataset.tip;
      if (!text) return;
      current = trigger;
      floater.textContent = text;
      // Reset geometry BEFORE measuring — a stale left/top from the previous
      // show caps the line boxes against the viewport edge (skinny-column bug).
      floater.style.width = '';
      floater.style.maxHeight = '';
      floater.style.left = '0px';
      floater.style.top = '0px';
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
      // clientWidth/Height exclude scrollbar gutters (innerWidth does not) —
      // right-edge tips otherwise start under the admin scrollbar.
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const margin = 8;
      const above = rect.top - margin;
      const below = vh - rect.bottom - margin;
      let top: number;
      if (th <= above) {
        top = rect.top - th - margin;
      } else if (th <= below) {
        top = rect.bottom + margin;
      } else {
        // Neither side fits whole: take the larger side and cap the height
        // there — never slide back over the trigger row.
        if (above >= below) {
          floater.style.maxHeight = Math.max(0, above) + 'px';
          top = margin;
        } else {
          floater.style.maxHeight = Math.max(0, below) + 'px';
          top = rect.bottom + margin;
        }
      }
      let left = rect.left + rect.width / 2 - tw / 2;
      if (left < margin) left = margin;
      if (left + tw > vw - margin) left = vw - tw - margin;
      floater.style.top = top + 'px';
      floater.style.left = left + 'px';
    }
    const hide = () => { floater.classList.remove('visible'); current = null; };

    function resolveTrigger(t: Element): Element | null {
      const ht = t.closest('.help-tip');
      if (ht) return ht;
      const ct = t.closest('.cell-tip');
      // .cell-tip opens ONLY when the text is actually clipped (a full
      // integer pixel of overflow — scrollWidth/clientWidth are rounded).
      if (ct && ct.scrollWidth - ct.clientWidth >= 1) return ct;
      if (ct) return null;
      // Bare data-tip carriers (status chips etc.) tip unconditionally,
      // like .help-tip.
      const dt = t.closest('[data-tip]');
      if (dt) return dt;
      return null;
    }

    function onOver(e: MouseEvent) {
      const trig = resolveTrigger(e.target as Element);
      if (!trig) {
        // Rows re-rendered under the cursor fire no mouseout — release the
        // orphaned tip on the next movement instead of leaving it stuck.
        if (current) hide();
        return;
      }
      // Same trigger, still visible: crossing child boundaries must not
      // hide→show→re-measure (flicker + progressive shrink).
      if (trig === current && floater.classList.contains('visible')) return;
      show(trig);
    }
    function onOut(e: MouseEvent) {
      const trig = (e.target as Element).closest('.help-tip, .cell-tip, [data-tip]');
      if (!trig) return;
      // Moving onto a child of the same trigger is not a leave.
      if (e.relatedTarget instanceof Node && trig.contains(e.relatedTarget)) return;
      hide();
    }
    function onScroll() {
      // Keep the tip if the pointer is still over its trigger (the row moved
      // with the scroll); re-anchor instead of vanishing.
      if (current instanceof HTMLElement && current.matches(':hover')) show(current);
      else hide();
    }

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      floater.remove();
    };
  }, []);

  return null;
}
