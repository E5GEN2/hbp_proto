import { SITE_LOGO_HTML } from './_logo';

// The Comet Proxy logo pill from the marketing site, rendered verbatim so the auth
// page mark is pixel-identical. Links to /marketing.
export function SiteLogo() {
  return <div className="site-logo-host" dangerouslySetInnerHTML={{ __html: SITE_LOGO_HTML }} />;
}
