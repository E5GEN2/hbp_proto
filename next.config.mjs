/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No next/image in this app; the /_next/image optimizer is closed at the
  // edge (src/middleware.ts) because of GHSA-2xp9-vwfh-vxw4 (AVIF RCE in
  // sharp/libheif, unpatched on the Next 14 line). unoptimized keeps a future
  // <Image> from routing through it. Remove with the Next 15 migration.
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    // Boot hook for the lifecycle sweep loop (src/instrumentation.ts)
    instrumentationHook: true,
  },
  // The marketing landing now lives at the root "/". A config redirect gives a
  // clean SERVER-side 307 for the legacy /marketing path (a page-level
  // redirect() rendered a 200 + client redirect — URL flash + duplicate
  // content). permanent:false (307) keeps browsers from hard-caching it while
  // routing is still in flux.
  async redirects() {
    return [{ source: '/marketing', destination: '/', permanent: false }];
  },
};

export default nextConfig;
