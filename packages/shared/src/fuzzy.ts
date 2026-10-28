/**
 * Fuzzy matching for the command palette, preset browser and settings search.
 * Subsequence match with scoring for: prefix hits, camel/word boundaries,
 * consecutive runs and short candidates.
 */

export type FuzzyResult<T> = { item: T; score: number; indices: number[] };

export function fuzzyScore(text: string, query: string): { score: number; indices: number[] } | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return { score: 1, indices: [] };

  const indices: number[] = [];
  let ti = 0;
  let score = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    if (ch === ' ') continue;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    indices.push(found);
    run = qi > 0 && found === indices[indices.length - 2]! + 1 ? run + 1 : 0;
    score += 1 + run * 0.8;
    const prev = found > 0 ? t[found - 1] : ' ';
    if (found === 0) score += 2.2; // prefix
    else if (prev === ' ' || prev === '-' || prev === '_') score += 1.6; // word boundary
    else if (/[A-Z]/.test(text[found] ?? '')) score += 1.1; // camel hump
    ti = found + 1;
  }
  score /= Math.pow(text.length, 0.28);
  score *= indices.length === q.replace(/ /g, '').length ? 1 : 0.92;
  // Exact hits are scored on the same scale as everything else (so "library"
  // still beats "library grid"), then nudged to the top.
  if (t === q) score *= 1.25;
  return { score, indices };
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  limit = 50,
): FuzzyResult<T>[] {
  const out: FuzzyResult<T>[] = [];
  for (const item of items) {
    const r = fuzzyScore(key(item), query);
    if (r) out.push({ item, score: r.score, indices: r.indices });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Highlight helper: splits a label into matched/unmatched runs. */
export function highlightRuns(text: string, indices: number[]): { text: string; hit: boolean }[] {
  if (indices.length === 0) return [{ text, hit: false }];
  const set = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  let cur = '',
    curHit = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== curHit) {
      if (cur) runs.push({ text: cur, hit: curHit });
      cur = '';
      curHit = hit;
    }
    cur += text[i];
  }
  if (cur) runs.push({ text: cur, hit: curHit });
  return runs;
}
