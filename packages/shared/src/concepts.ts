/**
 * Concept vocabulary + embeddings for semantic search (§8.3).
 *
 * Production Swell embeds photos and queries with SigLIP/OpenCLIP through ONNX
 * Runtime. Those weights are downloaded on demand and are **not** available in
 * the web runtime, so this module implements the same *interface* with a
 * deterministic, explainable lexical-visual embedding:
 *
 *   photo → feature vector over a fixed concept vocabulary (+ seeded tags)
 *   query → vector over the same vocabulary (synonyms, fuzzy match, filters)
 *   rank  → cosine similarity, with per-concept explanation chips
 *
 * Swapping in the real model means replacing `embedQuery`/`photoVector` with
 * ONNX session calls; the ranking, filters and UI do not change.
 */

import type { ImageFeatures } from './analysis.ts';
import { clamp01, oklchDistance } from './color.ts';

export type Concept = {
  id: string;
  label: string;
  group: 'subject' | 'scene' | 'attribute' | 'light' | 'color';
  synonyms?: string[];
};

export const CONCEPTS: Concept[] = [
  // subjects
  { id: 'person', label: 'person', group: 'subject', synonyms: ['people', 'human', 'man', 'woman', 'portrait', 'face', 'model'] },
  { id: 'group', label: 'group of people', group: 'subject', synonyms: ['friends', 'crowd', 'couple', 'team'] },
  { id: 'dog', label: 'dog', group: 'subject', synonyms: ['puppy', 'canine', 'pet', 'animal'] },
  { id: 'cat', label: 'cat', group: 'subject', synonyms: ['kitten', 'feline'] },
  { id: 'bird', label: 'bird', group: 'subject', synonyms: ['kingfisher', 'avian', 'wildlife', 'eagle', 'duck'] },
  { id: 'animal', label: 'animal', group: 'subject', synonyms: ['wildlife', 'creature', 'horse', 'camel'] },
  { id: 'food', label: 'food', group: 'subject', synonyms: ['meal', 'breakfast', 'dish', 'coffee', 'cake', 'restaurant'] },
  { id: 'flower', label: 'flower', group: 'subject', synonyms: ['blossom', 'petal', 'plant', 'flora'] },
  { id: 'product', label: 'product', group: 'subject', synonyms: ['mug', 'object', 'still life', 'bottle', 'gear'] },
  { id: 'vehicle', label: 'vehicle', group: 'subject', synonyms: ['car', 'bike', 'motorcycle', 'train', 'bus'] },
  { id: 'building', label: 'building', group: 'subject', synonyms: ['architecture', 'house', 'cabin', 'museum', 'tower'] },
  // scenes
  { id: 'beach', label: 'beach', group: 'scene', synonyms: ['sea', 'ocean', 'coast', 'shore', 'sand'] },
  { id: 'mountain', label: 'mountain', group: 'scene', synonyms: ['alps', 'peak', 'valley', 'hill'] },
  { id: 'lake', label: 'lake', group: 'scene', synonyms: ['water', 'river', 'pond', 'reflection'] },
  { id: 'forest', label: 'forest', group: 'scene', synonyms: ['trees', 'woods', 'jungle', 'pine'] },
  { id: 'desert', label: 'desert', group: 'scene', synonyms: ['dunes', 'sand', 'sahara'] },
  { id: 'snow', label: 'snow', group: 'scene', synonyms: ['winter', 'ice', 'frost', 'cold'] },
  { id: 'city', label: 'city', group: 'scene', synonyms: ['street', 'urban', 'town', 'neon', 'tokyo'] },
  { id: 'indoor', label: 'indoor', group: 'scene', synonyms: ['interior', 'room', 'inside', 'gallery'] },
  { id: 'studio', label: 'studio', group: 'scene', synonyms: ['seamless', 'backdrop', 'product shot'] },
  { id: 'sky', label: 'sky', group: 'scene', synonyms: ['clouds', 'cloud', 'heaven'] },
  // light / time
  { id: 'sunset', label: 'sunset', group: 'light', synonyms: ['golden hour', 'dusk', 'sunrise', 'twilight'] },
  { id: 'night', label: 'night', group: 'light', synonyms: ['dark', 'low light', 'evening', 'blue hour'] },
  { id: 'backlit', label: 'backlit', group: 'light', synonyms: ['rim light', 'silhouette', 'contre-jour'] },
  { id: 'softlight', label: 'soft light', group: 'light', synonyms: ['overcast', 'diffuse', 'flat light'] },
  { id: 'hardlight', label: 'hard light', group: 'light', synonyms: ['direct sun', 'contrasty', 'shadow'] },
  // attributes
  { id: 'macro', label: 'macro', group: 'attribute', synonyms: ['close-up', 'closeup', 'detail', 'tiny'] },
  { id: 'wide', label: 'wide', group: 'attribute', synonyms: ['landscape orientation', 'panorama', 'vast'] },
  { id: 'blur', label: 'blurry', group: 'attribute', synonyms: ['soft focus', 'out of focus', 'motion blur'] },
  { id: 'sharp', label: 'sharp', group: 'attribute', synonyms: ['crisp', 'in focus', 'detailed'] },
  { id: 'dark', label: 'dark', group: 'attribute', synonyms: ['moody', 'low key', 'underexposed'] },
  { id: 'bright', label: 'bright', group: 'attribute', synonyms: ['airy', 'high key', 'overexposed', 'light'] },
  { id: 'colorful', label: 'colorful', group: 'attribute', synonyms: ['vivid', 'saturated', 'colourful'] },
  { id: 'monochrome', label: 'black and white', group: 'attribute', synonyms: ['bw', 'mono', 'grayscale'] },
  { id: 'warm', label: 'warm tones', group: 'color', synonyms: ['golden', 'orange', 'amber', 'red'] },
  { id: 'cool', label: 'cool tones', group: 'color', synonyms: ['blue', 'cyan', 'cold', 'teal'] },
  { id: 'green', label: 'green', group: 'color', synonyms: ['foliage', 'emerald', 'vegetation'] },
];

export const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
export const CONCEPT_GROUPS = ['subject', 'scene', 'attribute', 'light', 'color'] as const;

export type PhotoVector = { values: Float32Array; top: { id: string; score: number }[] };

/**
 * Build a photo's concept vector from computed features plus any known tags
 * (from the import manifest, keywords, or an ONNX detector in the desktop app).
 */
export function photoVector(features: ImageFeatures, tags: string[] = []): PhotoVector {
  const values = new Float32Array(CONCEPTS.length);
  const idx = new Map(CONCEPTS.map((c, i) => [c.id, i]));
  const f = features;

  const set = (id: string, v: number) => {
    const i = idx.get(id);
    if (i !== undefined) values[i] = Math.max(values[i]!, clamp01(v));
  };

  // --- visual heuristics -------------------------------------------------
  set('sky', f.skyRatio > 0.18 ? clamp01(f.skyRatio * 1.6) : 0);
  set('snow', f.meanLuma > 0.62 && f.saturationMean < 0.16 ? 0.8 : 0);
  set('night', f.meanLuma < 0.24 ? clamp01((0.24 - f.meanLuma) * 5) : 0);
  set('dark', clamp01((0.35 - f.meanLuma) * 2.2));
  set('bright', clamp01((f.meanLuma - 0.6) * 2.2));
  set('warm', clamp01((f.warmCool + 0.1) * 1.1));
  set('cool', clamp01((-f.warmCool + 0.1) * 1.1));
  set('green', clamp01(f.greenRatio * 2.4));
  set('colorful', clamp01((f.saturationMean - 0.25) * 2.2));
  set('monochrome', f.isMonochrome ? 0.95 : 0);
  set('blur', clamp01((f.blurScore - 0.35) * 2));
  set('sharp', clamp01((0.75 - f.blurScore) * 1.6));
  set('person', clamp01((f.skinRatio - 0.02) * 6));
  set('group', clamp01((f.skinRatio - 0.12) * 5));
  set('hardlight', clamp01((f.contrast - 0.28) * 2.4));
  set('softlight', clamp01((0.26 - f.contrast) * 2.6));
  set('backlit', f.clippedHighlights > 0.02 && f.meanLuma < 0.45 ? 0.7 : 0);
  set('macro', clamp01((f.edgeDensity - 0.25) * 2) * clamp01(1 - f.skyRatio * 2));
  set('forest', clamp01(f.greenRatio * 2) * clamp01(1 - f.skyRatio));
  set('studio', f.contrast < 0.24 && f.edgeDensity < 0.16 && f.skyRatio < 0.1 ? 0.75 : 0);
  set('indoor', f.skyRatio < 0.06 && f.edgeDensity > 0.12 && f.contrast < 0.3 ? 0.5 : 0);
  set('sunset', clamp01((f.warmCool - 0.12) * 2) * clamp01(f.skyRatio * 2.2));

  // palette-derived hints
  const warmPalette = f.palette.filter((p) => p.oklch.h > 20 && p.oklch.h < 90 && p.oklch.c > 0.08);
  const coolPalette = f.palette.filter((p) => (p.oklch.h > 180 || p.oklch.h < 20) && p.oklch.c > 0.05);
  if (warmPalette.length >= 2) set('warm', 0.85);
  if (coolPalette.length >= 2) set('cool', 0.8);

  // --- seeded / detected tags always win ---------------------------------
  for (const t of tags) {
    const id = t.toLowerCase().trim();
    const c = CONCEPT_BY_ID.get(id);
    if (c) set(c.id, 0.98);
    else {
      const bySynonym = CONCEPTS.find((x) => x.synonyms?.includes(id));
      if (bySynonym) set(bySynonym.id, 0.9);
    }
  }

  const top = CONCEPTS.map((c, i) => ({ id: c.id, score: values[i]! }))
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score);

  // L2 normalise for cosine similarity
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i++) values[i] = values[i]! / norm;

  return { values, top };
}

export type QueryParse = {
  concepts: { id: string; weight: number; term: string }[];
  filters: { field: string; op: '>' | '<' | '=' | '>=' | '<='; value: string }[];
  date?: { op: 'before' | 'after'; value: string };
  color?: { h: number; c: number; l: number };
  text: string;
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'with', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'some',
  'any', 'photo', 'photos', 'image', 'images', 'picture', 'pictures', 'shot', 'shots', 'all', 'me',
  'my', 'from', 'that', 'this', 'has', 'have', 'show', 'find',
]);

/** Parse a natural-language + filter query ("dog on a beach at sunset iso>1600 after:2024"). */
export function parseQuery(raw: string): QueryParse {
  const out: QueryParse = { concepts: [], filters: [], text: raw.trim() };
  const tokens = raw
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const tok of tokens) {
    const cmp = tok.match(/^(iso|focal|aperture|rating|shutter|exposure|blur|sharpness)([<>=]+)([\d.]+)$/);
    if (cmp) {
      out.filters.push({
        field: cmp[1]!,
        op: (cmp[2] === '=' ? '=' : cmp[2]) as QueryParse['filters'][number]['op'],
        value: cmp[3]!,
      });
      continue;
    }
    const kv = tok.match(/^(camera|lens|keyword|person|label|file|ext):(.+)$/);
    if (kv) {
      out.filters.push({ field: kv[1]!, op: '=', value: kv[2]! });
      continue;
    }
    const dt = tok.match(/^(before|after):(\d{4}(?:-\d{2})?(?:-\d{2})?)$/);
    if (dt) {
      out.date = { op: dt[1] as 'before' | 'after', value: dt[2]! };
      continue;
    }
    if (STOPWORDS.has(tok)) continue;

    let matched = false;
    for (const c of CONCEPTS) {
      const score = termScore(tok, c);
      if (score > 0) {
        const existing = out.concepts.find((x) => x.id === c.id);
        if (existing) existing.weight = Math.max(existing.weight, score);
        else out.concepts.push({ id: c.id, weight: score, term: tok });
        matched = true;
      }
    }
    if (!matched && tok.length > 2) {
      // unknown term → keep for metadata/FTS matching
      out.concepts.push({ id: `text:${tok}`, weight: 0.6, term: tok });
    }
  }
  return out;
}

function termScore(tok: string, c: Concept): number {
  if (c.id === tok || c.label.toLowerCase() === tok) return 1;
  if (c.synonyms?.some((s) => s === tok)) return 0.92;
  if (c.label.toLowerCase().includes(tok) && tok.length > 3) return 0.72;
  if (c.synonyms?.some((s) => s.includes(tok) && tok.length > 3)) return 0.6;
  if (tok.length > 4 && fuzzyContains(c.id, tok)) return 0.5;
  return 0;
}

/** Cheap subsequence/typo-tolerant match. */
export function fuzzyContains(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length > 4 && i >= needle.length - 1;
}

export function embedQuery(q: QueryParse): Float32Array {
  const v = new Float32Array(CONCEPTS.length);
  const idx = new Map(CONCEPTS.map((c, i) => [c.id, i]));
  for (const c of q.concepts) {
    const i = idx.get(c.id);
    if (i !== undefined) v[i] = c.weight;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export type MatchExplanation = { conceptId: string; label: string; score: number };

/** Why did this photo match? (drives the explanation chips in the results grid) */
export function explain(
  photo: Float32Array,
  query: Float32Array,
  limit = 3,
): MatchExplanation[] {
  const out: MatchExplanation[] = [];
  for (let i = 0; i < photo.length; i++) {
    const q = query[i]!;
    if (q <= 0) continue;
    const s = photo[i]! * q;
    if (s <= 0.001) continue;
    const c = CONCEPTS[i];
    if (!c) continue;
    out.push({ conceptId: c.id, label: c.label, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** "Search by color": rank palettes by minimum OKLCH distance. */
export function colorScore(features: ImageFeatures, target: { h: number; c: number; l: number }): number {
  let best = 1;
  for (const p of features.palette) {
    const d = oklchDistance(p.oklch, target);
    if (d < best) best = d;
  }
  return clamp01(1 - best * 2.2);
}

/* ------------------------------------------------------- metadata filters */

/**
 * The fields a parsed filter can address. Numeric keys come from EXIF or from
 * the analysis features; string keys are matched case-insensitively (the parser
 * lowercases the query), list keys match if *any* entry contains the term.
 */
export type FilterTarget = {
  iso?: number;
  focal?: number;
  aperture?: number;
  rating?: number;
  shutter?: number;
  exposure?: number;
  blur?: number;
  sharpness?: number;
  camera?: string;
  lens?: string;
  file?: string;
  ext?: string;
  label?: string;
  keyword?: string[];
  person?: string[];
  /** Capture time — anything `Date` can parse, or epoch ms. */
  takenAt?: string | number | Date;
};

const NUMERIC_FIELDS: (keyof FilterTarget)[] = [
  'iso',
  'focal',
  'aperture',
  'rating',
  'shutter',
  'exposure',
  'blur',
  'sharpness',
];

function parseDateBound(v: string | number | Date): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Apply the `iso>1600` / `keyword:dog` / `after:2024` half of a query.
 *
 * Unknown fields never match: a filter the photo cannot answer (`blur>0.4`
 * before indexing finished) must not silently widen the result set.
 */
export function matchesFilters(
  target: FilterTarget,
  q: Pick<QueryParse, 'filters' | 'date'>,
): boolean {
  for (const f of q.filters) {
    const field = f.field as keyof FilterTarget;
    const raw = target[field];
    const needle = f.value.toLowerCase();

    if (NUMERIC_FIELDS.includes(field)) {
      const bound = Number(f.value);
      const value = typeof raw === 'number' ? raw : NaN;
      if (!Number.isFinite(value) || !Number.isFinite(bound)) return false;
      const ok =
        f.op === '>'
          ? value > bound
          : f.op === '>='
            ? value >= bound
            : f.op === '<'
              ? value < bound
              : f.op === '<='
                ? value <= bound
                : value === bound;
      if (!ok) return false;
      continue;
    }

    if (Array.isArray(raw)) {
      if (!raw.some((entry) => String(entry).toLowerCase().includes(needle))) return false;
      continue;
    }

    if (typeof raw === 'string') {
      const hay = raw.toLowerCase();
      if (field === 'ext') {
        if (hay !== needle.replace(/^\./, '')) return false;
      } else if (!hay.includes(needle)) {
        return false;
      }
      continue;
    }

    return false;
  }

  if (q.date) {
    const bound = parseDateBound(q.date.value);
    const taken = target.takenAt === undefined ? NaN : parseDateBound(target.takenAt);
    if (!Number.isFinite(bound) || !Number.isFinite(taken)) return false;
    if (q.date.op === 'after' && !(taken >= bound)) return false;
    if (q.date.op === 'before' && !(taken < bound)) return false;
  }

  return true;
}
