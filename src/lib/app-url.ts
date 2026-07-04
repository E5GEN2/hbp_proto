// Absolute base URL for links that leave the app (emails, payment-processor
// redirects, IPN callbacks). APP_URL wins so emails can point at the custom
// domain while NEXTAUTH_URL stays on the Railway hostname.
export function appUrl(path = '') {
  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}
