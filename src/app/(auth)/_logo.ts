// Comet Proxy logo pill (defs + .topbar__logo anchor), lifted verbatim from the
// marketing design so the auth page shows the exact same mark. Rendered via
// dangerouslySetInnerHTML to avoid SVG->JSX attribute churn. Links to /marketing.

export const SITE_LOGO_HTML = `<svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true">
  <defs>
    <radialGradient id="bubbleCream" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#B58A4A" stop-opacity="0.30"></stop>
      <stop offset="0.72" stop-color="#B58A4A" stop-opacity="0.16"></stop>
      <stop offset="0.96" stop-color="#B58A4A" stop-opacity="0.55"></stop>
      <stop offset="1" stop-color="#B58A4A" stop-opacity="0"></stop>
    </radialGradient>
    <!-- Comet Proxy mark — Forward geometry · symmetric dot barrier · soft-gold center -->
    <g id="cometMark">
      <g fill="#0A0F1D" opacity="0.85"><circle cx="70" cy="142" r="1.7"></circle><circle cx="65.12" cy="141.72" r="1.7"></circle><circle cx="60.31" cy="140.87" r="1.7"></circle><circle cx="55.64" cy="139.47" r="1.7"></circle><circle cx="51.15" cy="137.53" r="1.7"></circle><circle cx="46.92" cy="135.09" r="1.7"></circle><circle cx="43" cy="132.17" r="1.7"></circle><circle cx="39.45" cy="128.82" r="1.7"></circle><circle cx="36.31" cy="125.08" r="1.7"></circle><circle cx="33.63" cy="121" r="1.7"></circle><circle cx="31.43" cy="116.64" r="1.7"></circle><circle cx="29.76" cy="112.05" r="1.7"></circle><circle cx="28.64" cy="107.29" r="1.7"></circle><circle cx="28.07" cy="102.44" r="1.7"></circle><circle cx="28.07" cy="97.56" r="1.7"></circle><circle cx="28.64" cy="92.71" r="1.7"></circle><circle cx="29.76" cy="87.95" r="1.7"></circle><circle cx="31.43" cy="83.36" r="1.7"></circle><circle cx="33.63" cy="79" r="1.7"></circle><circle cx="36.31" cy="74.92" r="1.7"></circle><circle cx="39.45" cy="71.18" r="1.7"></circle><circle cx="43" cy="67.83" r="1.7"></circle><circle cx="46.92" cy="64.91" r="1.7"></circle><circle cx="51.15" cy="62.47" r="1.7"></circle><circle cx="55.64" cy="60.53" r="1.7"></circle><circle cx="60.31" cy="59.13" r="1.7"></circle><circle cx="65.12" cy="58.28" r="1.7"></circle><circle cx="70" cy="58" r="1.7"></circle></g>
      <circle cx="70" cy="100" r="18" fill="none" stroke="#B58A4A" stroke-width="1.0" opacity="0.32"></circle>
      <circle cx="88" cy="100" r="24" fill="none" stroke="#B58A4A" stroke-width="1.2" opacity="0.50"></circle>
      <circle cx="112" cy="100" r="30" fill="none" stroke="#B58A4A" stroke-width="1.4" opacity="0.70"></circle>
      <circle cx="142" cy="100" r="40" fill="url(#bubbleCream)"></circle>
      <circle cx="142" cy="100" r="36" fill="none" stroke="#B58A4A" stroke-width="2" opacity="0.95"></circle>
      <circle cx="142" cy="100" r="12" fill="#F1E6CC" stroke="#0A0F1D" stroke-width="2.4"></circle>
      <circle cx="142" cy="100" r="3.4" fill="#B58A4A"></circle>
    </g>
  </defs>
</svg>
<a class="topbar__logo" href="/marketing" aria-label="Comet Proxy" style="border-radius: 999px; padding: 2px 12px 2px 8px; height: 56px; width: 230px">
      <svg viewBox="6 40 558 120" style="height: 46px; width: auto">
        <use href="#cometMark"></use>
        <line x1="208" y1="64" x2="208" y2="136" stroke="#0A0F1D" stroke-width="1" opacity="0.2"></line>
        <text x="232" y="118" font-family="Source Sans 3, sans-serif" font-size="50"><tspan font-weight="600" letter-spacing="1" fill="#111827">COMET</tspan><tspan font-weight="400" letter-spacing="0" fill="#111827" style="line-height: 1.6"> proxies</tspan></text>
      </svg>
    </a>`;
