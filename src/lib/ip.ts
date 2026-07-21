// P2-4: strict IP / CIDR validation + canonicalization for proxy whitelists.
// The old check was /^(\d{1,3}\.){3}\d{1,3}$/ — it accepted 999.999.999.999
// and leading-zero octets, and rejected IPv6/CIDR entirely (S15-3).
//
// Canonicalization matters because dedup is a plain string unique on
// (proxyId, ip): "2001:DB8::1", "2001:0db8::1" and
// "2001:db8:0:0:0:0:0:1" must collapse to ONE stored form. IPv6 output
// follows RFC 5952 (lowercase, no leading zeros, :: for the longest zero
// run, leftmost on ties, never for a single group); embedded-IPv4 input
// ("::ffff:192.0.2.1") is accepted but canonicalized to pure hex so the
// dedup key is unambiguous. /32 (v4) and /128 (v6) collapse to the bare IP.
//
// Pure TS on purpose — no node:net (parts of the app bundle for the edge
// runtime, same reason id.ts uses Web Crypto).

function parseIPv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null; // leading zeros read as octal in many stacks — ambiguous, reject
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Returns 8 groups of 0..0xffff, or null. */
function parseIPv6(s: string): number[] | null {
  if (s.includes('%')) return null; // zone ids are host-local — meaningless in a whitelist
  const dbl = s.split('::');
  if (dbl.length > 2) return null;

  const parseGroups = (part: string, v4TailAllowed: boolean): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (v4TailAllowed && i === groups.length - 1 && g.includes('.')) {
        const v4 = parseIPv4(g);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };

  if (dbl.length === 1) {
    const g = parseGroups(s, true);
    return g && g.length === 8 ? g : null;
  }
  const head = parseGroups(dbl[0], false);
  const tail = parseGroups(dbl[1], true);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for at least one zero group
  return [...head, ...Array(missing).fill(0), ...tail];
}

/** RFC 5952 text form: lowercase, longest zero run → "::" (leftmost tie-break, runs of 1 stay). */
function formatIPv6(groups: number[]): string {
  let best = -1, bestLen = 0, cur = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (cur === -1) cur = i;
      curLen++;
      if (curLen > bestLen) { best = cur; bestLen = curLen; }
    } else { cur = -1; curLen = 0; }
  }
  const hex = groups.map(g => g.toString(16));
  if (bestLen >= 2) return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
  return hex.join(':');
}

function hostBitsClear(groupsOrOctets: number[], bitsPerUnit: 8 | 16, prefix: number): { clear: boolean; network: number[] } {
  const network = [...groupsOrOctets];
  let clear = true;
  for (let i = 0; i < network.length; i++) {
    const unitStart = i * bitsPerUnit;
    const keep = Math.min(Math.max(prefix - unitStart, 0), bitsPerUnit);
    const mask = keep === 0 ? 0 : ((0xffff << (bitsPerUnit - keep)) & (bitsPerUnit === 8 ? 0xff : 0xffff));
    const masked = network[i] & mask;
    if (masked !== network[i]) clear = false;
    network[i] = masked;
  }
  return { clear, network };
}

export type NormalizedIp = { ok: true; value: string } | { ok: false; error: string };

/** Validate + canonicalize a bare IP or a CIDR range. */
export function normalizeIpOrCidr(raw: string): NormalizedIp {
  const s = raw.trim();
  if (!s) return { ok: false, error: 'Enter an IP address' };
  if (s.length > 64) return { ok: false, error: 'Not a valid IP address' };

  const slash = s.indexOf('/');
  const ipPart = slash === -1 ? s : s.slice(0, slash);
  const prefixPart = slash === -1 ? null : s.slice(slash + 1);

  const v4 = parseIPv4(ipPart);
  const v6 = v4 ? null : parseIPv6(ipPart);
  if (!v4 && !v6) return { ok: false, error: 'Not a valid IPv4 or IPv6 address' };
  const maxPrefix = v4 ? 32 : 128;

  if (prefixPart === null) {
    return { ok: true, value: v4 ? v4.join('.') : formatIPv6(v6!) };
  }

  // no leading zeros — same octal ambiguity we reject in octets ('/016')
  if (!/^(0|[1-9]\d{0,2})$/.test(prefixPart)) return { ok: false, error: 'CIDR prefix must be a number (e.g. /24)' };
  const prefix = Number(prefixPart);
  if (prefix > maxPrefix) return { ok: false, error: `CIDR prefix must be 1–${maxPrefix} for IPv${v4 ? 4 : 6}` };
  if (prefix === 0) return { ok: false, error: 'A /0 range would allow every IP — remove entries instead of whitelisting the whole internet' };

  const { clear, network } = v4
    ? hostBitsClear(v4, 8, prefix)
    : hostBitsClear(v6!, 16, prefix);
  const canonical = v4 ? network.join('.') : formatIPv6(network);
  if (!clear) {
    return { ok: false, error: `Host bits set for /${prefix} — did you mean ${canonical}/${prefix}?` };
  }
  if (prefix === maxPrefix) return { ok: true, value: canonical }; // /32 and /128 are single hosts — store the bare IP
  return { ok: true, value: `${canonical}/${prefix}` };
}
