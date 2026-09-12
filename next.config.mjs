/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No next/image in this app; the /_next/image optimizer is closed at the
  // edge (src/middleware.ts) as unused attack surface (it carried an RCE
  // advisory in the sharp/libheif decode path, GHSA-2xp9-vwfh-vxw4, patched
  // since 15.5.24). unoptimized keeps a future <Image> from routing through
  // it. Drop both only if the app starts optimizing images on purpose.
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // The boot hook for the lifecycle sweep loop (src/instrumentation.ts) is
  // stable since Next 15 — no experimental.instrumentationHook flag needed.
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
