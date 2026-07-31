// Deployment brand — SINGLE source of truth so one codebase serves multiple
// market sites (owner: two sites under different brands). Each deployment sets
// NEXT_PUBLIC_BRAND_NAME at build time (odatai.com → "Odatai"; the future
// Comet-market site → "Comet"); unset defaults to Odatai. NEXT_PUBLIC_ so the
// client-side sidebar logo can read it too.
const RAW = (process.env.NEXT_PUBLIC_BRAND_NAME || '').trim();
export const BRAND_NAME = RAW || 'Odatai';
// Logo wordmark treatment: primary mark in caps (matches the original "COMET"),
// paired with the lowercase "proxies" tail in the SVG.
export const BRAND_WORDMARK = BRAND_NAME.toUpperCase();
// Prose brand for emails / legal / titles / invoice footer: "Odatai Proxy".
export const BRAND_FULL = `${BRAND_NAME} Proxy`;
