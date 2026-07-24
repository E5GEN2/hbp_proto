// Same-site redirect guard for ?return params (auth review find). A raw
// params.get('return') fed to router.push()/redirect() is an open-redirect:
// "https://evil.com" and "//evil.com" navigate off-site, and "/\evil.com"
// bypasses a naive startsWith('/') && !startsWith('//') check because WHATWG
// URL parsing treats backslash as slash. Accept ONLY a path that starts with
// a single forward slash not followed by slash-or-backslash.
export function safeReturn(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null;
  if (!/^\/(?![/\\])/.test(v)) return null;
  return v;
}
