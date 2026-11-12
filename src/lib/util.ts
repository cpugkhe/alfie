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
