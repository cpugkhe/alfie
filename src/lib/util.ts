/** Fuzzy score: higher is better, null when `query` does not match. */
export function fuzzy(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const at = t.indexOf(q);
  if (at >= 0) {
    const boundary = at === 0 || /[\s/\-_.]/.test(t[at - 1]);
    return 1000 - at - (t.length - q.length) * 0.1 + (boundary ? 50 : 0);
  }

  // Subsequence match, penalising gaps.
  let score = 500;
  let ti = 0;
  let last = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    if (last >= 0) score -= (found - last - 1) * 2;
    last = found;
    ti = found + 1;
  }
  return score - t.length * 0.1;
}

export function relTime(unix: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000 - unix));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30.4);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function fullTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

export function tildify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Newest version first; short versions and a leading v are accepted for tags. */
export function compareTags(a: string, b: string): number {
  const version = /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
  const av = version.exec(a);
  const bv = version.exec(b);
  if (!av || !bv) return av ? -1 : bv ? 1 : b.localeCompare(a, undefined, { numeric: true });
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(av[i] ?? '0');
    const y = BigInt(bv[i] ?? '0');
    if (x !== y) return x > y ? -1 : 1;
  }
  if (!av[4] || !bv[4]) return av[4] ? 1 : bv[4] ? -1 : a.localeCompare(b);
  const ap = av[4].split('.');
  const bp = bv[4].split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) > BigInt(y) ? -1 : 1;
    } else if (xn !== yn) return xn ? 1 : -1;
    else return x > y ? -1 : 1;
  }
  return a.localeCompare(b);
}
