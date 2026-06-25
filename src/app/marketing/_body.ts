// Static body of the Comet Proxy marketing landing, ported 1:1 (byte-identical) from
// 'Marketing Site.html' (claude.ai/design 22eeaf81). Dynamic parts are @@tokens@@ filled
// at render time: @@PROMO@@ (admin announcement), @@SIGNIN@@ (login href), @@PLAN_CARDS@@
// (live Plan-driven cards). The trailing modal <script> is replaced by a useEffect in
// MarketingView. Legal modal <dialog>s + footer [data-legal] links are kept verbatim.

const TEMPLATE = `<!-- ============ SHARED LOGO MARK ============ -->
<svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true">
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

<!-- ============ NAV ============ -->
<div class="nav-wrap">
  <div class="topbar rise" data-d="1">
    <a class="topbar__logo" href="#" aria-label="Comet Proxy" style="border-radius: 999px; padding: 2px 12px 2px 8px; height: 56px; width: 230px">
      <svg viewBox="6 40 558 120" style="height: 46px; width: auto">
        <use href="#cometMark"></use>
        <line x1="208" y1="64" x2="208" y2="136" stroke="#0A0F1D" stroke-width="1" opacity="0.2"></line>
        <text x="232" y="118" font-family="Source Sans 3, sans-serif" font-size="50"><tspan font-weight="600" letter-spacing="1" fill="#111827">COMET</tspan><tspan font-weight="400" letter-spacing="0" fill="#111827" style="line-height: 1.6"> proxies</tspan></text>
      </svg>
    </a>
    <header class="nav" style="height: 56px; padding: 8px 20px;">
    @@PROMO@@
    <nav class="nav__links nav__right">
      <a href="#plans" class="t-h-s" style="color: var(--gold-text); font-weight: 500">US 5G</a>
      <a class="nav__icon" href="https://t.me/US5Gwetrust" target="_blank" rel="noopener" aria-label="Telegram">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width: 22px; height: 22px; color: var(--ink);"><path d="M21.5 4.3 18.2 20c-.2 1-.9 1.3-1.8.8L11.5 17l-2.4 2.3c-.3.3-.5.5-1 .5l.4-5L17.7 7c.4-.4-.1-.6-.6-.2L7 13.1 2.6 11.7c-.9-.3-1-.9.2-1.4l17-6.6c.8-.3 1.5.2 1.7 1.6Z"></path></svg>
      </a>
      <a class="nav__cta" href="@@SIGNIN@@">Sign in</a>
    </nav>
    </header>
  </div>
</div>

<!-- ============ HERO ============ -->
<section class="hero" style="padding: 96px var(--gutter) 0px">
  <div class="gridfrag gridfrag--hero" aria-hidden="true"></div>
  <div class="rise" data-d="1"><span class="eyebrow" style="color: rgb(133, 99, 48); font-size: 12px">Premium mobile proxies</span></div>
  <h1 class="hero__title rise" data-d="2" style="margin: 14px 334px 0px">Real 5G IPs
<span class="gold">from</span> <span class="gold">US carriers.</span></h1>
  <p class="hero__sub rise" data-d="3">Enjoy privacy and high speeds with mobile proxies. Our service provides dedicated proxies running on physical devices, with unlimited bandwidth, flexible IP rotation, and consistent reliability.</p>

  <div class="hero__tagline rise" data-d="4">
    <span class="word" style="font-weight: 500; font-size: 12px; color: rgb(129, 144, 161); gap: 18px">Connect <span class="dot" style="width: 3px; height: 3px;"></span></span>
    <span class="word" style="color: rgb(129, 144, 161); font-size: 12px; font-weight: 500">Route <span class="dot" style="height: 3px; width: 3px;"></span></span>
    <span class="word word--gold" style="color: rgb(133, 99, 48); font-size: 12px; font-weight: 500">Unlock</span>
  </div>

  <div class="carriers rise" data-d="6" style="padding-top: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--hair-soft); margin: 36px auto 0">
    <span class="carriers__label" style="color: rgb(17, 24, 39); font-weight: 500; font-size: 12px">SUPPORTED PROTOCOLS</span>
    <span class="carriers__list">
      <span style=""><span style="color: rgb(17, 24, 39); font-weight: 500; font-size: 13px">Socks5</span></span>
      <span class="sep" style="font-weight: 400; width: 3px; height: 3px; color: rgb(17, 24, 39); letter-spacing: 2px; background-color: rgb(17, 24, 39)"></span>
      <span style="color: rgb(17, 24, 39); font-weight: 500; font-size: 13px">Http|s</span>
      <span class="sep" style="background-color: rgb(17, 24, 39); letter-spacing: 2px; height: 3px; width: 3px; color: rgb(17, 24, 39); font-weight: 400"></span>
      <span style="color: rgb(17, 24, 39); font-weight: 500; font-size: 13px">OpenVPN</span>
    </span>
  </div>
</section>

<!-- ============ WHAT SETS US APART ============ -->
<section class="section" id="apart" style="padding: 80px 0px; font-weight: 400">
  <div class="gridfrag gridfrag--apart" aria-hidden="true"></div>
  <div class="wrap" style="padding: 40px 56px">
    <div class="section__head">
      <div>
        <span class="eyebrow" style="line-height: 1.6; font-size: 12px">What sets us apart</span>
        <h2>The difference is hardware.</h2>
      </div>
      <p class="lead" style="">Proxy from data centers are inexpensive because they are software-based. Our proxies run on real smartphones with actual SIM cards — which is exactly why they work where others fail.</p>
    </div>

    <div class="diff">
      <div class="diff__item">
        <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="15" y="6" width="20" height="36" rx="3"></rect>
          <line x1="21" y1="38" x2="29" y2="38"></line>
          <g stroke="#B58A4A" stroke-width="1.6">
            <line x1="6" y1="22" x2="6" y2="26"></line>
            <line x1="9" y1="20" x2="9" y2="26"></line>
            <line x1="12" y1="17" x2="12" y2="26"></line>
          </g>
        </svg>
        <h3 class="diff__title" style="color: rgb(94, 120, 166); font-size: 14px; line-height: 1.3; font-weight: 600">Physical devices</h3>
        <p class="diff__body">Real smartphones on real US carrier SIMs. No emulation, no dongles, no datacenter IPs in mobile costumes.</p>
      </div>

      <div class="diff__item">
        <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="16" width="38" height="16" rx="8"></rect>
          <path d="M 14 20 L 18 24 L 14 28"></path>
          <path d="M 22 20 L 26 24 L 22 28"></path>
          <path d="M 30 20 L 34 24 L 30 28" stroke="#B58A4A"></path>
        </svg>
        <h3 class="diff__title" style="color: rgb(94, 120, 166); font-size: 14px">Unmetered bandwidth</h3>
        <p class="diff__body">Every plan ships with unlimited traffic. Scrape, test, or validate without watching a counter tick down.</p>
      </div>

      <div class="diff__item">
        <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="12" y="22" width="24" height="18" rx="2.5"></rect>
          <path d="M17 22 V 16 a 7 7 0 0 1 14 0 V 22"></path>
          <circle cx="24" cy="30" r="2" fill="#B58A4A" stroke="none"></circle>
          <line x1="24" y1="32" x2="24" y2="35"></line>
        </svg>
        <h3 class="diff__title" style="color: rgb(94, 120, 166); font-size: 14px">No complex signups or KYC</h3>
        <p class="diff__body">We value your privacy – all we need is an Email or Telegram handle to send your proxy credentials.&nbsp;</p>
      </div>

      <div class="diff__item">
        <svg class="diff__icon" viewBox="0 0 48 48" fill="none" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="24" cy="27" r="14"></circle>
          <line x1="20" y1="7" x2="28" y2="7"></line>
          <line x1="24" y1="7" x2="24" y2="13"></line>
          <line x1="36" y1="15" x2="39" y2="12"></line>
          <line x1="24" y1="27" x2="32" y2="22" stroke="#B58A4A" stroke-width="1.8"></line>
          <circle cx="24" cy="27" r="1.6" fill="#111827" stroke="none"></circle>
        </svg>
        <h3 class="diff__title" style="color: rgb(94, 120, 166); font-size: 14px">Sixty‑minutes setup</h3>
        <p class="diff__body">Pay, receive your login credentials, and get connected. The average setup time for the entire fleet is less than one hour.</p>
      </div>
    </div>
  </div>
</section>

<hr class="section-divider" aria-hidden="true">

<!-- ============ PLANS ============ -->
<section class="section" id="plans" style="padding: 120px 0px">
  <div class="gridfrag gridfrag--plans" aria-hidden="true"></div>
  <div class="wrap">
    <div class="section__head">
      <div>
        <span class="eyebrow" style="line-height: 1.6; font-size: 12px">Plans</span>
        <h2>One product. Three durations.</h2>
      </div>
      <p class="lead">You get strong performance at a fair price – so you don’t have to compromise between functionality and cost.</p>
    </div>

    <div class="plans">
      <div class="gridfrag gridfrag--starter" aria-hidden="true"></div>
      @@PLAN_CARDS@@
    </div>

    <div aria-hidden="true" style="height: 56px;"></div>

    <!-- Pull quote + trust metrics -->
    <div class="pullbox">
      <div class="pullbox__quote">
        Proxy isn't just a pass‑through.
        <br><span style="color: var(--gold-text)">It's the path forward.</span>
        <span class="lite">— Brand thesis, v 1.0</span>
      </div>
      <div class="pullbox__meta">
        <div class="row">
          <div class="row__icon">
            <svg viewBox="0 0 72 56" aria-hidden="true">
              <circle cx="4" cy="12" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="10" cy="6" r="1.5" fill="#B58A4A"></circle>
              <circle cx="17" cy="14" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="6" cy="24" r="1.5" fill="#8190A1"></circle>
              <circle cx="15" cy="22" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="4" cy="36" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="13" cy="38" r="1.5" fill="#B58A4A"></circle>
              <circle cx="20" cy="32" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="9" cy="48" r="1.5" fill="#8190A1"></circle>
              <circle cx="26" cy="22" r="1.5" fill="#B58A4A"></circle>
              <circle cx="30" cy="30" r="1.5" fill="#1F3D6B"></circle>
              <circle cx="34" cy="25" r="1.5" fill="#8190A1"></circle>
              <path d="M22 10 L 44 26" stroke="#1F3D6B" stroke-width="1.3" fill="none" stroke-linecap="round"></path>
              <path d="M22 46 L 44 30" stroke="#1F3D6B" stroke-width="1.3" fill="none" stroke-linecap="round"></path>
              <line x1="44" y1="26" x2="56" y2="26" stroke="#1F3D6B" stroke-width="1.3" stroke-linecap="round"></line>
              <line x1="44" y1="30" x2="56" y2="30" stroke="#1F3D6B" stroke-width="1.3" stroke-linecap="round"></line>
              <circle cx="60" cy="28" r="2.5" fill="#B58A4A"></circle>
            </svg>
          </div>
          <div class="lbl">
            <span class="row__title">Multiple inputs</span>
            Your scrapers, agents, and tools all hit a single endpoint.
          </div>
        </div>
        <div class="row">
          <div class="row__icon">
            <svg viewBox="0 0 72 56" aria-hidden="true">
              <g stroke="#1F3D6B" stroke-width="1.3" fill="none" stroke-linejoin="round">
                <rect x="22" y="10" width="28" height="36" rx="1"></rect>
                <line x1="22" y1="22" x2="50" y2="22"></line>
                <line x1="22" y1="34" x2="50" y2="34"></line>
                <line x1="34" y1="10" x2="34" y2="22"></line>
                <line x1="40" y1="22" x2="40" y2="34"></line>
                <line x1="34" y1="34" x2="34" y2="46"></line>
              </g>
              <path d="M6 28 L 62 28" stroke="#B58A4A" stroke-width="1.6" stroke-linecap="round"></path>
              <polygon points="62,25.7 66,28 62,30.3" fill="#B58A4A"></polygon>
            </svg>
          </div>
          <div class="lbl">
            <span class="row__title">Barrier removal</span>
            Real mobile IPs bypass blocks and rate limits that hit datacenter IPs.
          </div>
        </div>
        <div class="row">
          <div class="row__icon">
            <svg viewBox="0 0 72 56" aria-hidden="true">
              <circle cx="36" cy="28" r="18" fill="none" stroke="#1F3D6B" stroke-width="1.2"></circle>
              <ellipse cx="36" cy="28" rx="18" ry="7" fill="none" stroke="#B58A4A" stroke-width="1"></ellipse>
              <ellipse cx="36" cy="28" rx="8" ry="18" fill="none" stroke="#B58A4A" stroke-width="1"></ellipse>
              <!-- orbit arrow circling the globe -->
              <path d="M27.79 5.44 A24 24 0 1 0 44.21 5.44" fill="none" stroke="#B58A4A" stroke-width="1.6" stroke-linecap="round"></path>
              <polygon points="40.45,4.07 43.42,7.6 45.0,3.28" fill="#B58A4A"></polygon>
              <circle cx="31.01" cy="4.53" r="1.5" fill="#B58A4A"></circle>
              <circle cx="34.32" cy="4.05" r="1.1" fill="#B58A4A" opacity="0.7"></circle>
              <circle cx="37.68" cy="4.05" r="0.8" fill="#B58A4A" opacity="0.45"></circle>
            </svg>
          </div>
          <div class="lbl">
            <span class="row__title">Freedom of access</span>
            Your traffic flows in — securely, efficiently, and without restrictions.
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============ FAQ ============ -->
<section class="section" id="faq" style="padding: 80px 0px">
  <div class="wrap">
    <div class="section__head">
      <div>
        <span class="eyebrow" style="font-size: 12px; line-height: 1.6">Questions</span>
        <h2>The short answers.</h2>
      </div>
      <p class="lead">
        If yours isn't here, message us — we reply in minutes, not days. Most operational questions are covered below.
      </p>
    </div>

    <div class="faq">
      <details class="faq__item">
        <summary>
          <span>How do I pay?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">Card or crypto. We take Visa, Mastercard, plus Bitcoin, Litecoin, USDT, and a handful of others. Payment confirms in seconds — credentials land in your inbox right after.</div>
      </details>

      <details class="faq__item">
        <summary>
          <span>What if the proxy doesn't fit my workflow?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">Full refund within 24 hours of provisioning, no questions asked. Past 24 hours we refund on a case‑by‑case basis — usually still yes.</div>
      </details>

      <details class="faq__item">
        <summary>
          <span>Do you log my traffic?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">We do not inspect the bodies of requests or responses, nor do we store destination URLs. Connection metadata —timestamps and byte counts is retained for 60 days for the purpose of combating abuse, after which it is deleted.</div>
      </details>

      <details class="faq__item">
        <summary>
          <span>Which protocols do you support?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">HTTP, HTTPS, and SOCKS5. Authenticate by user/password or by allowlisting your client IP — switch any time from the dashboard.</div>
      </details>

      <details class="faq__item">
        <summary>
          <span>Can I target a specific city or state?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">Yes. Pick the Plan first, then a specific metro: NYC, LA, Chicago, Dallas, Miami. Custom geo on request.</div>
      </details>

      <details class="faq__item">
        <summary>
          <span>How does rotation work?</span>
          <svg class="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"></line><line x1="12" y1="6" x2="12" y2="18"></line></svg>
        </summary>
        <div class="faq__body">Rotate manually from the dashboard, automatically on a timer, or programmatically by hitting a per‑proxy rotation URL. You decide the strategy per proxy.</div>
      </details>
    </div>
  </div>
</section>

<!-- ============ FINAL CTA ============ -->
<section class="section" id="cta" style="padding: 0px 0px 40px">
  <div class="wrap" style="padding: 40px 56px 0px">
    <div class="cta-strip" style="margin-top: 0">
      <div>
        <h3>Connect anything. Route everything.<br><span class="gold">Unlock potential.</span></h3>
      </div>
      <div class="cta-strip__actions">
        <a class="btn btn--gold" href="#plans">Buy Proxy <span class="arr">→</span></a>
        <a class="btn btn--quiet" href="https://t.me/US5Gwetrust" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:16px;height:16px;"><path d="M21.5 4.3 18.2 20c-.2 1-.9 1.3-1.8.8L11.5 17l-2.4 2.3c-.3.3-.5.5-1 .5l.4-5L17.7 7c.4-.4-.1-.6-.6-.2L7 13.1 2.6 11.7c-.9-.3-1-.9.2-1.4l17-6.6c.8-.3 1.5.2 1.7 1.6Z"></path></svg>Contact us</a>
      </div>
    </div>
  </div>
</section>

<!-- ============ FOOTER ============ -->
<footer class="foot">
  <div class="foot__mark">
    <svg viewBox="6 40 558 120">
      <use href="#cometMark"></use>
      <line x1="208" y1="64" x2="208" y2="136" stroke="#0A0F1D" stroke-width="1" opacity="0.2"></line>
      <text x="232" y="118" font-family="Source Sans 3, sans-serif" font-size="50"><tspan font-weight="600" letter-spacing="1" fill="#111827">COMET</tspan><tspan font-weight="400" letter-spacing="0" fill="#111827"> proxies</tspan></text>
    </svg>
  </div>
  <div class="foot__end">
    <span>© 2026</span>
    <div class="foot__links">
      <a href="#" data-legal="privacy-modal">Privacy</a>
      <a href="#" data-legal="terms-modal">Terms</a>
    </div>
  </div>
</footer>

<!-- ============ LEGAL MODALS ============ -->
<dialog class="legal-modal" id="privacy-modal" aria-labelledby="privacy-title">
  <div class="legal-modal__head">
    <h3 id="privacy-title">Privacy Policy</h3>
    <button type="button" class="legal-modal__close" aria-label="Close">×</button>
  </div>
  <div class="legal-modal__body">
    <p class="legal-modal__meta">Last updated — January 2026</p>
    <p>Comet Proxy ("we", "us") operates a mobile proxy network. This policy explains what we collect when you use our site and service, and how we handle it. We keep data collection to the minimum required to run the service.</p>
    <h4>What we collect</h4>
    <p>Account details you provide (email, billing identifiers) and operational metadata needed to provision and authenticate proxies — such as session timestamps, assigned endpoints, and aggregate bandwidth counters.</p>
    <h4>What we don't collect</h4>
    <p>We do not inspect, log, or store the contents of traffic routed through our proxies. Destination payloads are never written to disk on our infrastructure.</p>
    <h4>How we use it</h4>
    <p>To create and secure your account, provision proxies, prevent abuse, process payments, and respond to support requests. We do not sell personal data.</p>
    <h4>Sharing</h4>
    <p>We share data only with the payment and infrastructure providers required to deliver the service, each bound by their own data agreements, or where compelled by valid legal process.</p>
    <h4>Retention</h4>
    <p>Operational metadata is retained only as long as needed for billing reconciliation and abuse prevention, then purged. You may request deletion of your account data at any time.</p>
    <h4>Your choices</h4>
    <p>You can access, correct, or delete your account information, and opt out of non-essential email. Reach us at <a href="https://t.me/US5Gwetrust" target="_blank" rel="noopener">@US5Gwetrust</a> on Telegram.</p>
    <h4>Contact</h4>
    <p>Questions about this policy can be sent to our support channel. We reply in minutes, not days.</p>
  </div>
</dialog>

<dialog class="legal-modal" id="terms-modal" aria-labelledby="terms-title">
  <div class="legal-modal__head">
    <h3 id="terms-title">Terms of Service</h3>
    <button type="button" class="legal-modal__close" aria-label="Close">×</button>
  </div>
  <div class="legal-modal__body">
    <p class="legal-modal__meta">Last updated — January 2026</p>
    <p>By purchasing or using Comet Proxy, you agree to these terms. If you are using the service on behalf of an organization, you confirm you have authority to bind it.</p>
    <h4>The service</h4>
    <p>We provide access to mobile IPs running on physical devices with real carrier SIMs. Plans differ by duration; every plan includes unlimited bandwidth and sticky 24-hour sessions unless stated otherwise.</p>
    <h4>Acceptable use</h4>
    <p>You may not use the service for unlawful activity, fraud, distribution of malware, unsolicited bulk messaging, or any action that harms the network or third parties. We may suspend access for violations.</p>
    <h4>Billing</h4>
    <p>Plans are prepaid for the duration selected. There are no autorenewal traps, setup fees, or surprise overage charges. Pricing shown at checkout is what you pay.</p>
    <h4>Refunds</h4>
    <p>If a proxy doesn't fit your workflow, request a full refund within 24 hours of purchase and we'll process it, no questions asked.</p>
    <h4>Availability</h4>
    <p>We work to keep the fleet healthy and provisioned within 60 seconds, but we do not guarantee uninterrupted availability and are not liable for downtime outside our reasonable control.</p>
    <h4>Liability</h4>
    <p>The service is provided "as is." To the extent permitted by law, our total liability is limited to the amount you paid for the plan in question.</p>
    <h4>Changes</h4>
    <p>We may update these terms; material changes will be reflected by the date above. Continued use after an update constitutes acceptance.</p>
  </div>
</dialog>`;

export function renderMarketingBody(opts: { promo: string; signInHref: string; planCards: string }): string {
  return TEMPLATE
    .replace('@@PROMO@@', () => opts.promo)
    .replace('@@SIGNIN@@', () => opts.signInHref)
    .replace('@@PLAN_CARDS@@', () => opts.planCards);
}
