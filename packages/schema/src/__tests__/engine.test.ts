/**
 * The wire format between the UI and the engine (§5.2, §5.7) and the shape history
 * entries are stored in (§7.1).
 *
 * Two rules make this worth testing: only *changed leaves* cross the boundary
 * (never whole documents, never pixels), and a diff must survive a JSON
 * round-trip because history rows are persisted as `params_diff_json`.
 */

import { describe, expect, it } from 'vitest';
import {
  FULL_VIEW,
  applyDiff,
  defaultParams,
  diffParams,
  emptyOverlays,
  labelForDiff,
  parseParams,
} from '@swell/schema';

const doc = () => defaultParams() as unknown as Record<string, unknown>;

describe('diffParams', () => {
  it('is empty for identical documents', () => {
    const a = defaultParams();
    expect(diffParams(a, a)).toEqual({});
    expect(diffParams(a, { ...a })).toEqual({});
    expect(diffParams(parseParams({ tone: { exposure: 1 } }), parseParams({ tone: { exposure: 1 } }))).toEqual({});
  });

  it('reports only the changed leaf, with its full path', () => {
    const a = defaultParams();
    const b = parseParams({ tone: { exposure: 0.5 } });
    expect(diffParams(a, b)).toEqual({ 'tone.exposure': 0.5 });
  });

  it('walks arbitrarily deep', () => {
    const a = defaultParams();
    const b = parseParams({ detail: { sharpen: { amount: 77, masking: 12 } } });
    expect(diffParams(a, b)).toEqual({ 'detail.sharpen.amount': 77, 'detail.sharpen.masking': 12 });
  });

  it('collects changes across several groups in one diff', () => {
    const a = defaultParams();
    const b = parseParams({
      treatment: 'bw',
      wb: { temp: 3200 },
      tone: { contrast: 18 },
      curves: { amount: 0.8 },
      effects: { grain: { amount: 22 } },
    });
    const d = diffParams(a, b);
    expect(Object.keys(d).sort()).toEqual(
      ['curves.amount', 'effects.grain.amount', 'treatment', 'tone.contrast', 'wb.temp'].sort(),
    );
    expect(d['treatment']).toBe('bw');
  });

  it('replaces arrays wholesale instead of diffing element by element', () => {
    const a = defaultParams();
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.62 },
      { x: 1, y: 1 },
    ];
    const b = parseParams({ curves: { luma: points } });
    expect(diffParams(a, b)).toEqual({ 'curves.luma': points });
    // …and equal arrays produce nothing.
    expect(diffParams(b, parseParams({ curves: { luma: points } }))).toEqual({});
  });

  it('notices a layer being added, edited or removed', () => {
    const base = parseParams({ layers: [{ id: 'l1', kind: 'adjustment', opacity: 100 }] });
    const edited = parseParams({ layers: [{ id: 'l1', kind: 'adjustment', opacity: 62 }] });
    expect(diffParams(base, edited)).toEqual({ layers: edited.layers });
    expect(diffParams(edited, base)).toEqual({ layers: base.layers });
    expect(diffParams(base, parseParams({ layers: [] }))).toEqual({ layers: [] });
  });

  it('is JSON-safe between two complete documents (history rows are text)', () => {
    const a = defaultParams();
    const b = parseParams({ tone: { exposure: -1.2 }, presence: { clarity: 9 }, layers: [{ id: 'l', kind: 'fill' }] });
    const d = diffParams(a, b);
    for (const [path, value] of Object.entries(d)) {
      expect(value, `${path} must survive JSON`).not.toBeUndefined();
    }
    const roundTripped = JSON.parse(JSON.stringify(d));
    expect(applyDiff(doc(), roundTripped)).toEqual(applyDiff(doc(), d));
  });

  it('does not mutate either document', () => {
    const a = defaultParams();
    const b = parseParams({ tone: { exposure: 2 } });
    const snapshotA = JSON.stringify(a);
    const snapshotB = JSON.stringify(b);
    diffParams(a, b);
    expect(JSON.stringify(a)).toBe(snapshotA);
    expect(JSON.stringify(b)).toBe(snapshotB);
  });
});

describe('applyDiff', () => {
  it('round-trips a diff back to the target document', () => {
    const a = doc();
    const b = parseParams({
      tone: { exposure: 0.75, blacks: -12 },
      wb: { temp: 6200, tint: 8 },
      detail: { nr: { luminance: 40 } },
    }) as unknown as Record<string, unknown>;
    const d = diffParams(a, b);
    expect(applyDiff(a, d)).toEqual(b);
  });

  it('is the inverse of itself — undo replays the reverse diff', () => {
    const a = doc();
    const b = parseParams({ curves: { amount: 1.4 }, effects: { vignette: { amount: -35 } } }) as unknown as Record<
      string,
      unknown
    >;
    expect(applyDiff(applyDiff(a, diffParams(a, b)), diffParams(b, a))).toEqual(a);
  });

  it('leaves the source document untouched (copy-on-write along the path)', () => {
    const a = doc();
    const before = JSON.stringify(a);
    const out = applyDiff(a, { 'tone.exposure': 1.5 });
    expect(JSON.stringify(a)).toBe(before);
    expect(out).not.toBe(a);
    expect(out['tone']).not.toBe(a['tone']);
    expect((out['tone'] as Record<string, unknown>)['exposure']).toBe(1.5);
    // Untouched groups may share structure — that is the point of a diff.
    expect((out['wb'] as Record<string, unknown>)['temp']).toBe(5500);
  });

  it('creates missing intermediate objects', () => {
    const out = applyDiff({}, { 'geometry.crop.angle': -4, 'a.b.c.d': 1 });
    expect(out).toEqual({ geometry: { crop: { angle: -4 } }, a: { b: { c: { d: 1 } } } });
  });

  it('replaces a scalar with an object and vice versa', () => {
    expect(applyDiff({ tone: 5 }, { 'tone.exposure': 1 })).toEqual({ tone: { exposure: 1 } });
    expect(applyDiff({ tone: { exposure: 1 } }, { tone: null })).toEqual({ tone: null });
  });

  it('applies several paths in one pass', () => {
    const out = applyDiff(doc(), {
      'tone.exposure': 0.25,
      'tone.contrast': 8,
      'wb.temp': 4200,
      treatment: 'bw',
      'curves.luma': [{ x: 0.5, y: 0.55 }],
    });
    expect((out['tone'] as Record<string, unknown>)['exposure']).toBe(0.25);
    expect((out['tone'] as Record<string, unknown>)['contrast']).toBe(8);
    expect(out['treatment']).toBe('bw');
    expect((out['curves'] as Record<string, unknown>)['luma']).toEqual([{ x: 0.5, y: 0.55 }]);
  });

  it('ignores the whole-document sentinel an empty diff cannot address', () => {
    const a = doc();
    expect(applyDiff(a, { $: { tone: 'nonsense' } })).toEqual(a);
    expect(applyDiff(a, {})).toEqual(a);
  });

  it('produces a document the schema still accepts', () => {
    const out = applyDiff(doc(), diffParams(defaultParams(), parseParams({ tone: { exposure: 1.1 } })));
    expect(() => parseParams(out)).not.toThrow();
    expect(parseParams(out).tone.exposure).toBeCloseTo(1.1);
  });
});

describe('labelForDiff — the text in the History panel and the Edit menu', () => {
  it('names a single numeric change with its sign', () => {
    // Positives always carry a "+" (the Edit menu reads "Exposure +0.35");
    // integers stay integers, fractions get two decimals.
    expect(labelForDiff({ 'tone.exposure': 0.35 })).toBe('Exposure +0.35');
    expect(labelForDiff({ 'tone.exposure': -0.5 })).toBe('Exposure -0.50');
    expect(labelForDiff({ 'tone.contrast': 0 })).toBe('Contrast 0');
    expect(labelForDiff({ 'wb.temp': 6200 })).toBe('Temp +6200');
    expect(labelForDiff({ rating: 4 })).toBe('Rating +4');
  });

  it('splits camelCase leaves into words', () => {
    expect(labelForDiff({ 'detail.aiDenoise.enabled': true })).toBe('Enabled on');
    expect(labelForDiff({ 'effects.vignette.amount': -20 })).toBe('Amount -20');
    expect(labelForDiff({ 'geometry.crop.angle': 3 })).toBe('Angle +3');
    expect(labelForDiff({ 'geometry.crop.angle': -3 })).toBe('Angle -3');
  });

  it('reads booleans, arrays, strings and objects', () => {
    expect(labelForDiff({ 'lens.enabled': true })).toBe('Enabled on');
    expect(labelForDiff({ 'lens.enabled': false })).toBe('Enabled off');
    expect(labelForDiff({ 'curves.luma': [{ x: 0 }, { x: 1 }, { x: 0.5 }] })).toBe('Luma (3)');
    expect(labelForDiff({ 'curves.luma': [] })).toBe('Luma (0)');
    expect(labelForDiff({ treatment: 'bw' })).toBe('Treatment changed');
    expect(labelForDiff({ wb: { temp: 5000 } })).toBe('Wb changed');
  });

  it('summarises a multi-field gesture after the first change', () => {
    expect(labelForDiff({ 'tone.exposure': 0.2, 'tone.contrast': 5 })).toBe('Exposure +1 more');
    expect(labelForDiff({ a: 1, b: 2, c: 3 })).toBe('A +2 more');
  });

  it('says so when nothing changed', () => {
    expect(labelForDiff({})).toBe('No change');
  });

  it('labels a real editing gesture end to end', () => {
    const before = defaultParams();
    const after = parseParams({ presence: { clarity: 14 } });
    expect(labelForDiff(diffParams(before, after) as Record<string, unknown>)).toBe('Clarity +14');
  });
});

describe('engine state defaults', () => {
  it('overlays start completely off', () => {
    const o = emptyOverlays();
    expect(o.clipping).toBe('off');
    expect(o.cropGuides).toBe('off');
    expect(o.mask).toBeNull();
    expect(o.spotVisualize).toBe(0);
    for (const flag of [o.gamutWarning, o.sharpnessHeatmap, o.detectionBoxes, o.straighten, o.depthPreview]) {
      expect(flag).toBe(false);
    }
  });

  it('hands out a fresh overlay object each time', () => {
    const a = emptyOverlays();
    const b = emptyOverlays();
    expect(a).not.toBe(b);
    a.clipping = 'both';
    expect(b.clipping).toBe('off');
  });

  it('the full view covers the frame', () => {
    expect(FULL_VIEW).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
