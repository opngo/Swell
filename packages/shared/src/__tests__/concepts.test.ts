/**
 * On-device search (§8.2–§8.5).
 *
 * No network, no embeddings service: a natural-language query is parsed into
 * concept weights + metadata filters, embedded into the same vector space the
 * analysis worker fills, and ranked by cosine. These tests pin the grammar
 * (`iso>1600`, `keyword:dog`, `after:2024`, colour terms), the ranking, and the
 * "why did this match" explanations the results grid shows.
 */

import { describe, expect, it } from 'vitest';
import {
  CONCEPTS,
  CONCEPT_BY_ID,
  CONCEPT_GROUPS,
  analyzeImage,
  colorScore,
  cosine,
  embedQuery,
  explain,
  fuzzyContains,
  fuzzyFilter,
  fuzzyScore,
  highlightRuns,
  matchesFilters,
  parseQuery,
  photoVector,
} from '@swell/shared';

/**
 * A flat frame: exactly one palette colour, and cool enough that the skin-tone
 * chromaticity test cannot fire (so "person" can only come from a seeded tag).
 */
function solidFrame(w = 64, h = 48, v = 128): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = Math.round(v * 0.45);
    data[i * 4 + 1] = Math.round(v * 0.7);
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/** Synthetic frame: sky-blue top, warm sand bottom, optional dark subject. */
function makeImage(w = 96, h = 64, opts: { subject?: boolean; mono?: boolean; dark?: boolean } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sky = y < h * 0.55;
      let r = sky ? 120 : 226;
      let g = sky ? 170 : 196;
      let b = sky ? 235 : 140;
      if (opts.subject && x > w * 0.4 && x < w * 0.6 && y > h * 0.35) {
        r = 60;
        g = 45;
        b = 40;
      }
      if (opts.dark) {
        r = Math.round(r * 0.12);
        g = Math.round(g * 0.12);
        b = Math.round(b * 0.12);
      }
      if (opts.mono) {
        const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        r = g = b = l;
      }
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe('concept vocabulary', () => {
  it('has unique ids and labels, grouped for the search UI', () => {
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(CONCEPTS.length);
    for (const c of CONCEPTS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(CONCEPT_BY_ID.get(c.id)).toBe(c);
      expect(['subject', 'scene', 'attribute', 'light', 'color']).toContain(c.group);
    }
    expect(CONCEPT_GROUPS.length).toBeGreaterThan(3);
  });

  it('covers the spec examples (people, sky, sunset, snow, macro, monochrome)', () => {
    for (const id of ['person', 'sky', 'sunset', 'snow', 'macro', 'monochrome', 'dog', 'beach']) {
      expect(CONCEPT_BY_ID.has(id), id).toBe(true);
    }
  });
});

describe('parseQuery', () => {
  it('extracts comparison filters', () => {
    const q = parseQuery('iso>1600 sharp');
    expect(q.filters).toEqual([{ field: 'iso', op: '>', value: '1600' }]);
    expect(q.concepts.some((c) => c.id === 'sharp')).toBe(true);
  });

  it('extracts key:value metadata filters (query is lowercased first)', () => {
    const q = parseQuery('keyword:dog camera:A7R');
    expect(q.filters).toContainEqual({ field: 'keyword', op: '=', value: 'dog' });
    expect(q.filters).toContainEqual({ field: 'camera', op: '=', value: 'a7r' });
    // matchesFilters is case-insensitive, so the lowercase value still finds "A7R".
    expect(matchesFilters({ camera: 'Sony A7R IV' }, parseQuery('camera:A7R'))).toBe(true);
    expect(matchesFilters({ camera: 'Sony A7R IV' }, parseQuery('camera:a7r iv'))).toBe(true);
  });

  it('extracts a date bound', () => {
    expect(parseQuery('after:2026-04').date).toEqual({ op: 'after', value: '2026-04' });
    expect(parseQuery('before:2025').date).toEqual({ op: 'before', value: '2025' });
    expect(parseQuery('sunset').date).toBeUndefined();
  });

  it('weights an exact concept above a partial match', () => {
    const q = parseQuery('beach beaches');
    const exact = q.concepts.find((c) => c.term === 'beach')!;
    expect(exact.id).toBe('beach');
    expect(exact.weight).toBe(1);
  });

  it('drops stopwords but keeps unknown terms for text search', () => {
    const q = parseQuery('show me the photos of amara');
    expect(q.concepts.some((c) => c.id === 'text:amara')).toBe(true);
    expect(q.concepts.some((c) => c.term === 'the')).toBe(false);
    expect(q.text).toBe('show me the photos of amara');
  });

  it('is case and punctuation insensitive', () => {
    const a = parseQuery('Sunset, Beach!');
    const b = parseQuery('sunset beach');
    expect(a.concepts.map((c) => c.id).sort()).toEqual(b.concepts.map((c) => c.id).sort());
  });

  it('an empty query matches nothing but stays usable', () => {
    const q = parseQuery('');
    expect(q.concepts).toEqual([]);
    expect(q.filters).toEqual([]);
    expect(q.text).toBe('');
  });
});

describe('embedding and ranking', () => {
  it('embedQuery is L2-normalised', () => {
    const v = embedQuery(parseQuery('sunset beach snow'));
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(v.length).toBe(CONCEPTS.length);
  });

  it('cosine of a vector with itself is 1', () => {
    const v = embedQuery(parseQuery('dog macro'));
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });

  it('a photo of a bright sky ranks above a dark studio frame for "sky"', () => {
    const bright = photoVector(analyzeImage(makeImage()), []);
    const dark = photoVector(analyzeImage(makeImage(96, 64, { dark: true })), []);
    const q = embedQuery(parseQuery('sky bright'));
    expect(cosine(bright.values, q)).toBeGreaterThan(cosine(dark.values, q));
  });

  it('tags contribute to the vector (opt-in people data)', () => {
    // A flat frame has no skin tones, so the heuristic cannot invent "person":
    // only the seeded tag can put it there.
    const i = CONCEPTS.findIndex((c) => c.id === 'person');
    const untagged = photoVector(analyzeImage(solidFrame()), []);
    const tagged = photoVector(analyzeImage(solidFrame()), ['person']);
    expect(untagged.values[i]!).toBe(0);
    expect(tagged.values[i]!).toBeGreaterThan(0.2);
    expect(tagged.top.some((t) => t.id === 'person')).toBe(true);
  });

  it('vectors are non-negative and bounded', () => {
    const v = photoVector(analyzeImage(makeImage()), ['beach']).values;
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });
});

describe('explain() — the "why this matched" chips', () => {
  it('returns the strongest reasons, sorted and limited', () => {
    const photo = photoVector(analyzeImage(makeImage()), ['beach', 'person']).values;
    const q = embedQuery(parseQuery('beach person sky'));
    const chips = explain(photo, q, 3);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.length).toBeGreaterThan(0);
    for (let i = 1; i < chips.length; i++) {
      expect(chips[i - 1]!.score).toBeGreaterThanOrEqual(chips[i]!.score);
    }
    expect(chips[0]!.label.length).toBeGreaterThan(0);
    expect(CONCEPT_BY_ID.has(chips[0]!.conceptId)).toBe(true);
  });

  it('says nothing when the query has no concept overlap', () => {
    const photo = photoVector(analyzeImage(makeImage()), []).values;
    const q = embedQuery(parseQuery('keyword:invoice'));
    expect(explain(photo, q)).toEqual([]);
  });
});

describe('search by colour', () => {
  it('scores an exact palette hit above a distant hue', () => {
    // One solid colour -> one palette entry, so the distance is unambiguous.
    const features = analyzeImage(solidFrame(200, 120, 60));
    expect(features.palette).toHaveLength(1);
    const target = features.palette[0]!.oklch;
    const near = colorScore(features, target);
    const far = colorScore(features, { l: target.l, c: target.c, h: (target.h + 180) % 360 });
    expect(near).toBeGreaterThan(0.95);
    expect(far).toBe(0);
  });

  it('falls off monotonically as the target hue rotates away', () => {
    const features = analyzeImage(solidFrame(200, 120, 60));
    const h = features.palette[0]!.oklch.h;
    const at = (deg: number) => colorScore(features, { h: (h + deg) % 360, c: 0.18, l: 0.6 });
    expect(at(0)).toBeGreaterThan(at(45));
    expect(at(45)).toBeGreaterThan(at(90));
    expect(at(90)).toBeGreaterThanOrEqual(at(180));
  });

  it('stays inside 0..1', () => {
    const features = analyzeImage(makeImage(64, 48, { mono: true }));
    for (let h = 0; h < 360; h += 37) {
      const s = colorScore(features, { h, c: 0.2, l: 0.6 });
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('fuzzy matching (command palette, keyword suggest)', () => {
  it('fuzzyContains tolerates subsequences', () => {
    expect(fuzzyContains('background', 'ground')).toBe(true);
    expect(fuzzyContains('develop', 'dvlp')).toBe(true);
    expect(fuzzyContains('remove background', 'zebra')).toBe(false);
    expect(fuzzyContains('library', 'librarian')).toBe(false);
  });

  it('fuzzyScore ranks an exact hit above a prefix of a longer label', () => {
    // The command palette sorts on this: typing "library" must not put
    // "Library grid" above "Library".
    const exact = fuzzyScore('Library', 'library')!;
    const prefix = fuzzyScore('Library grid', 'lib')!;
    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(exact.indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('fuzzyScore prefers contiguous runs and short labels', () => {
    expect(fuzzyScore('Library', 'lib')!.score).toBeGreaterThan(fuzzyScore('Library', 'lby')!.score);
    expect(fuzzyScore('Export', 'expo')!.score).toBeGreaterThan(fuzzyScore('Export dialog', 'expo')!.score);
    expect(fuzzyScore('anything', '')!.score).toBe(1);
    expect(fuzzyScore('anything', '')!.indices).toEqual([]);
    expect(fuzzyScore('Develop', 'xyz')).toBeNull();
  });

  it('fuzzyFilter ranks and limits', () => {
    const items = [
      { n: 'Export dialog' },
      { n: 'Export with previous' },
      { n: 'Develop' },
      { n: 'Library' },
    ];
    const out = fuzzyFilter(items, 'expo', (i) => i.n, 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.item.n.startsWith('Export')).toBe(true);
    expect(fuzzyFilter(items, 'zzz', (i) => i.n)).toHaveLength(0);
  });

  it('highlightRuns splits text into hit/miss runs for the palette', () => {
    const runs = highlightRuns('Library', [0, 1, 2]);
    expect(runs).toEqual([
      { text: 'Lib', hit: true },
      { text: 'rary', hit: false },
    ]);
    expect(highlightRuns('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('matchesFilters - the metadata half of a query', () => {
  const photo = {
    iso: 3200,
    focal: 85,
    aperture: 1.8,
    rating: 4,
    shutter: 1 / 250,
    blur: 0.2,
    sharpness: 0.7,
    camera: 'Sony ILCE-7RM5',
    lens: 'FE 85mm F1.4 GM',
    file: 'DSC04217.ARW',
    ext: 'arw',
    label: 'green',
    keyword: ['dog', 'beach walk'],
    person: ['Amara'],
    takenAt: '2026-04-12T18:22:00',
  };

  const match = (q: string) => matchesFilters(photo, parseQuery(q));

  it('applies every comparison operator', () => {
    expect(match('iso>1600')).toBe(true);
    expect(match('iso>6400')).toBe(false);
    expect(match('iso>=3200')).toBe(true);
    expect(match('iso<3200')).toBe(false);
    expect(match('rating=4')).toBe(true);
    expect(match('rating>=4')).toBe(true);
    expect(match('aperture<=2')).toBe(true);
  });

  it('ANDs filters together and mixes them with concepts', () => {
    expect(match('sunset iso>1600 focal>50')).toBe(true);
    expect(match('sunset iso>1600 focal>200')).toBe(false);
  });

  it('matches strings case-insensitively and by substring', () => {
    expect(match('camera:sony')).toBe(true);
    expect(match('camera:canon')).toBe(false);
    expect(match('lens:85mm')).toBe(true);
    expect(match('file:dsc042')).toBe(true);
    expect(match('ext:ARW')).toBe(true);
    expect(match('ext:.arw')).toBe(true);
    expect(match('ext:dng')).toBe(false);
    expect(match('label:green')).toBe(true);
  });

  it('matches list fields on any entry', () => {
    expect(match('keyword:dog')).toBe(true);
    expect(match('keyword:beach')).toBe(true); // substring of "beach walk"
    expect(match('keyword:cat')).toBe(false);
    expect(match('person:amara')).toBe(true);
    expect(match('person:jonas')).toBe(false);
  });

  it('applies before/after date bounds', () => {
    expect(match('after:2026')).toBe(true);
    expect(match('after:2027')).toBe(false);
    expect(match('before:2027')).toBe(true);
    expect(match('before:2026')).toBe(false);
    expect(match('after:2026-04-01 before:2026-05')).toBe(true);
  });

  it('accepts epoch-ms capture times', () => {
    const ms = { ...photo, takenAt: Date.parse('2026-04-12T18:22:00Z') };
    expect(matchesFilters(ms, parseQuery('after:2026'))).toBe(true);
  });

  it('never matches a field the photo cannot answer', () => {
    expect(matchesFilters({ iso: 100 }, parseQuery('blur>0.1'))).toBe(false);
    expect(matchesFilters({ iso: 100 }, parseQuery('after:2020'))).toBe(false);
    expect(matchesFilters({}, parseQuery('iso>50'))).toBe(false);
  });

  it('an unfiltered query matches everything', () => {
    expect(match('sunset on the beach')).toBe(true);
    expect(matchesFilters({}, parseQuery(''))).toBe(true);
  });
});
