/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    // Boot hook for the lifecycle sweep loop (src/instrumentation.ts)
    instrumentationHook: true,
  },
};

export default nextConfig;
