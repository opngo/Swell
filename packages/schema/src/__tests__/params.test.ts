/**
 * `DevelopParams` (§7.2) — the document every edit, preset, history entry and
 * sidecar is built from.
 *
 * Three properties matter enough to pin:
 *   1. parsing a *partial* document fills every default (presets store
 *      fragments, sidecars get truncated, older catalogs miss whole groups);
 *   2. out-of-range numbers degrade to their default instead of throwing, so a
 *      corrupt XMP file can never brick a photo;
 *   3. the hard limits from the spec hold — ≤16 curve points, ≤64 layers,
 *      ≤8 point-colour pickers.
 */

import { describe, expect, it } from 'vitest';
import {
  BLEND_MODES,
  MIXER_CHANNELS,
  PARAMS_VERSION,
  PARAM_GROUPS,
  defaultParams,
  developParamsSchema,
  historyEntrySchema,
  isValidParams,
  parseParams,
  presetSchema,
  profileSchema,
  snapshotSchema,
} from '@swell/schema';

describe('defaults', () => {
  it('parses an empty document into a full, neutral edit', () => {
    const p = defaultParams();
    expect(p.v).toBe(PARAMS_VERSION);
    expect(p.treatment).toBe('color');
    expect(p.profile.id).toBe('swell-neutral');
    expect(p.profile.amount).toBe(100);
    expect(p.wb).toMatchObject({ temp: 5500, tint: 0, mode: 'asShot' });
    expect(p.tone).toEqual({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 });
    expect(p.presence).toEqual({ texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0 });
    expect(p.layers).toEqual([]);
    expect(p.removals).toEqual([]);
    expect(p.bgRemoval).toBeUndefined();
    expect(p.detail.sharpen.amount).toBe(40);
    expect(p.detail.aiDenoise.enabled).toBe(false);
  });

  it('starts with neutral curves and hue curves in all five channels', () => {
    const c = defaultParams().curves;
    expect(c.mode).toBe('point');
    expect(c.interpolation).toBe('monotone');
    expect(c.amount).toBe(1);
    expect(c.luma).toEqual([]);
    expect(c.r).toEqual([]);
    expect(c.lockLuminosity).toBe(false);
    expect(Object.keys(c.hueCurves).sort()).toEqual(['hh', 'hl', 'hs', 'ls', 'ss']);
    expect(c.parametric.splits).toEqual([25, 50, 75]);
  });

  it('gives the HSL mixer all eight bands', () => {
    const m = defaultParams().mixer;
    expect(Object.keys(m).sort()).toEqual([...MIXER_CHANNELS].sort());
    expect(MIXER_CHANNELS).toHaveLength(8);
    for (const band of Object.values(m)) expect(band).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('is stable: parsing the parsed document changes nothing', () => {
    const once = defaultParams();
    expect(parseParams(once)).toEqual(once);
    expect(parseParams(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('produces independent documents (no shared mutable defaults)', () => {
    const a = defaultParams();
    const b = defaultParams();
    a.tone.exposure = 1.5;
    a.curves.luma.push({ x: 0.5, y: 0.6 });
    expect(b.tone.exposure).toBe(0);
    expect(b.curves.luma).toEqual([]);
  });
});

describe('partial documents', () => {
  it('fills every missing group from a single-field fragment', () => {
    const p = parseParams({ tone: { exposure: 1.25 } });
    expect(p.tone.exposure).toBe(1.25);
    expect(p.tone.contrast).toBe(0);
    expect(p.wb.temp).toBe(5500);
    expect(p.curves.interpolation).toBe('monotone');
    expect(p.v).toBe(PARAMS_VERSION);
  });

  it('accepts a deeply nested fragment', () => {
    const p = parseParams({ detail: { nr: { luminance: 32 } }, geometry: { crop: { angle: -3 } } });
    expect(p.detail.nr.luminance).toBe(32);
    expect(p.detail.nr.color).toBe(25); // untouched sibling keeps its default
    expect(p.detail.sharpen.amount).toBe(40);
    expect(p.geometry.crop.angle).toBe(-3);
  });

  it('merges a preset-shaped fragment without dropping groups', () => {
    const preset = presetSchema.parse({ id: 'p1', name: 'Punchy', params: { tone: { contrast: 22 } } });
    const merged = parseParams({ ...defaultParams(), ...preset.params });
    expect(merged.tone.contrast).toBe(22);
    expect(merged.tone.exposure).toBe(0);
    expect(merged.mixer.blue).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('a fragment never invents groups — applying a preset cannot wipe edits', () => {
    // If `params` materialised every default, merging a tone-only preset would
    // reset white balance, sharpening and (worst) the whole layer stack.
    const preset = presetSchema.parse({ id: 'p', name: 'Tone only', params: { tone: { contrast: 22 } } });
    expect(Object.keys(preset.params)).toEqual(['tone']);
    expect(preset.params.layers).toBeUndefined();
    expect(preset.params.wb).toBeUndefined();
    const photo = parseParams({
      wb: { temp: 3200 },
      layers: [{ id: 'l1', kind: 'adjustment', name: 'Dodge' }],
    });
    const after = parseParams({ ...photo, ...preset.params });
    expect(after.wb.temp).toBe(3200);
    expect(after.layers).toHaveLength(1);
    expect(after.tone.contrast).toBe(22);
  });

  it('strips unknown keys instead of smuggling them through', () => {
    const p = parseParams({ tone: { exposure: 1 }, bogus: 'x', nested: { also: 'bogus' } } as never);
    expect('bogus' in p).toBe(false);
    expect('nested' in p).toBe(false);
  });
});

describe('robustness against corrupt data', () => {
  it('out-of-range numbers fall back to their default', () => {
    const p = parseParams({ tone: { exposure: 99, contrast: -5000 }, wb: { temp: 3 } });
    expect(p.tone.exposure).toBe(0);
    expect(p.tone.contrast).toBe(0);
    expect(p.wb.temp).toBe(5500);
    expect(isValidParams(p)).toBe(true);
  });

  it('wrong types fall back too — a bad sidecar never throws', () => {
    const p = parseParams({ tone: { exposure: 'lots' }, curves: { amount: null } } as never);
    expect(p.tone.exposure).toBe(0);
    expect(p.curves.amount).toBe(1);
  });

  it('isValidParams rejects structurally broken documents', () => {
    expect(isValidParams(null)).toBe(false);
    expect(isValidParams('nope')).toBe(false);
    expect(isValidParams({ layers: [{ kind: 'adjustment' }] })).toBe(false); // no id
    expect(isValidParams({ layers: [{ id: 'l', kind: 'video' }] })).toBe(false); // unknown kind
    expect(isValidParams({ treatment: 'sepia' })).toBe(false);
    expect(isValidParams(defaultParams())).toBe(true);
  });
});

describe('spec limits', () => {
  const pt = (x: number, y: number) => ({ x, y });

  it('allows 16 curve points and rejects 17 (§5.1)', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => pt(i / 15, i / 15));
    expect(isValidParams({ curves: { luma: sixteen } })).toBe(true);
    expect(isValidParams({ curves: { luma: [...sixteen, pt(0.99, 0.99)] } })).toBe(false);
    // …in every channel, including the hue curves.
    expect(isValidParams({ curves: { hueCurves: { hh: [...sixteen, pt(0.5, 0.1)] } } })).toBe(false);
  });

  it('allows 64 layers and rejects 65 (§4.6)', () => {
    const layer = (i: number) => ({ id: `l${i}`, kind: 'adjustment' as const });
    const sixtyFour = Array.from({ length: 64 }, (_, i) => layer(i));
    expect(isValidParams({ layers: sixtyFour })).toBe(true);
    expect(isValidParams({ layers: [...sixtyFour, layer(64)] })).toBe(false);
  });

  it('allows 8 point-colour pickers and rejects 9', () => {
    const pick = (i: number) => ({ id: `pc${i}`, l: 0.5, c: 0.1, h: i * 40, hueShift: 8, sat: 12 });
    expect(isValidParams({ pointColor: Array.from({ length: 8 }, (_, i) => pick(i)) })).toBe(true);
    expect(isValidParams({ pointColor: Array.from({ length: 9 }, (_, i) => pick(i)) })).toBe(false);
  });

  it('exposes every blend mode the layer stack advertises (§4.6)', () => {
    expect(BLEND_MODES).toContain('normal');
    for (const m of ['multiply', 'screen', 'overlay', 'softLight', 'colorDodge', 'luminosity', 'add']) {
      expect(BLEND_MODES).toContain(m);
    }
    expect(BLEND_MODES).toHaveLength(17);
  });
});

describe('masks', () => {
  it('defaults a brush mask to a usable, non-erasing round brush', () => {
    const p = parseParams({
      layers: [{ id: 'l1', kind: 'adjustment', masks: [{ id: 'm1', kind: 'brush' }] }],
    });
    const m = p.layers[0]!.masks[0]!;
    expect(m.op).toBe('replace');
    expect(m.amount).toBe(100);
    expect(m.feather).toBe(20);
    expect(m.brush).toMatchObject({ size: 22, feather: 50, flow: 100, density: 100, autoMask: false, erase: false });
    expect(m.refine).toMatchObject({ shift: 0, smooth: 0, decontaminate: false });
    expect(m.overlay).toMatchObject({ visible: false, mode: 'color', opacity: 55 });
  });

  it('keeps gradient handles and range masks as given', () => {
    const p = parseParams({
      layers: [
        {
          id: 'l1',
          kind: 'adjustment',
          masks: [
            { id: 'm1', kind: 'linear', linear: { x0: 0.1, y0: 0, x1: 0.9, y1: 1 }, op: 'subtract' },
            { id: 'm2', kind: 'radial', radial: { cx: 0.5, cy: 0.4, rx: 0.3, ry: 0.25 } },
            { id: 'm3', kind: 'luminance', luminance: { lo: 0.2, hi: 0.8 } },
            { id: 'm4', kind: 'color', color: { samples: [{ l: 0.6, c: 0.12, h: 210 }] } },
            { id: 'm5', kind: 'people', people: { parts: ['skin', 'hair'] } },
          ],
        },
      ],
    });
    const masks = p.layers[0]!.masks;
    expect(masks[0]!.op).toBe('subtract');
    expect(masks[0]!.linear).toEqual({ x0: 0.1, y0: 0, x1: 0.9, y1: 1 });
    expect(masks[1]!.radial!.rotation).toBe(0);
    expect(masks[2]!.luminance!.smooth).toBeCloseTo(0.2);
    expect(masks[3]!.color!.fuzziness).toBeCloseTo(0.2);
    expect(masks[4]!.people!.parts).toEqual(['skin', 'hair']);
    expect(isValidParams({ layers: [{ id: 'l', kind: 'adjustment', masks: [{ id: 'm', kind: 'objects' }] }] })).toBe(false);
  });

  it('stores brush strokes as vectors so a mask stays editable (§6.4)', () => {
    const p = parseParams({
      layers: [
        {
          id: 'l1',
          kind: 'adjustment',
          masks: [{ id: 'm1', kind: 'brush', strokes: [{ x: 0.4, y: 0.5, r: 0.06, path: [[0.4, 0.5], [0.5, 0.5]] }] }],
        },
      ],
    });
    const s = p.layers[0]!.masks[0]!.strokes[0]!;
    expect(s.feather).toBe(0.5);
    expect(s.flow).toBe(1);
    expect(s.path).toEqual([[0.4, 0.5], [0.5, 0.5]]);
  });
});

describe('background removal document (§7.3)', () => {
  it('is optional until the user asks for it, then fully defaulted', () => {
    expect(defaultParams().bgRemoval).toBeUndefined();
    const p = parseParams({ bgRemoval: { enabled: true } });
    const bg = p.bgRemoval!;
    expect(bg.enabled).toBe(true);
    expect(bg.output.kind).toBe('transparent');
    expect(bg.edge.feather).toBeGreaterThanOrEqual(0);
    expect(bg.shadows.kind).toBeDefined();
    expect(['transparent', 'solid', 'gradient', 'blur', 'image', 'studioGray', 'whiteSweep']).toContain(bg.output.kind);
  });
});

describe('inspector coverage', () => {
  it('every top-level param group has a card in PARAM_GROUPS', () => {
    const ids = new Set<string>(PARAM_GROUPS.map((g) => g.id));
    for (const key of Object.keys(defaultParams())) {
      if (key === 'v') continue; // the version stamp is not a UI group
      expect(ids.has(key), `${key} has no inspector group`).toBe(true);
    }
  });

  it('every group card points at a real param group', () => {
    // `bgRemoval` is optional, so compare against the schema shape rather than
    // against a default document (where the key is absent until it is enabled).
    const keys = new Set(Object.keys(developParamsSchema.shape));
    for (const g of PARAM_GROUPS) {
      expect(keys.has(g.id), `${g.id} is not a param group`).toBe(true);
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.icon.length).toBeGreaterThan(0);
    }
  });

  it('group ids are unique', () => {
    const ids = PARAM_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('presets, profiles, snapshots and history', () => {
  it('a preset stores a fragment plus provenance', () => {
    const preset = presetSchema.parse({
      id: 'swell-film',
      name: 'Swell Film',
      group: 'film',
      params: { curves: { amount: 0.85 }, tone: { contrast: 12 } },
    });
    expect(preset.params.tone).toEqual({ contrast: 12 });
    expect(preset.params.curves).toEqual({ amount: 0.85 });
    expect(preset.params.wb).toBeUndefined(); // fragments stay partial
    expect(preset.group).toBe('film');
    expect(preset.favorite).toBe(false);
    expect(preset.amount).toBe(100);
    expect(preset.createdAt).toBeGreaterThan(0);
  });

  it('a preset fragment is still validated', () => {
    expect(presetSchema.safeParse({ id: 'x', name: 'y', params: { layers: [{ id: 'l', kind: 'video' }] } }).success).toBe(false);
    expect(presetSchema.safeParse({ id: 'x', name: 'y', params: { treatment: 'sepia' } }).success).toBe(false);
    expect(presetSchema.safeParse({ id: 'x', name: 'y', params: 'nope' }).success).toBe(false);
  });

  it('a profile is a fragment with camera metadata', () => {
    const profile = profileSchema.parse({ id: 'p', name: 'Camera Standard', params: { calibration: { profile: 'camera-standard' } } });
    expect(profile.params.calibration).toEqual({ profile: 'camera-standard' });
    expect(profile.params.tone).toBeUndefined();
    expect(profileSchema.parse({ id: 'p2', name: 'Empty' }).params).toEqual({});
  });

  it('a snapshot keeps the whole document', () => {
    const snap = snapshotSchema.parse({ id: 's1', photoId: 'ph1', ts: 1, name: 'Before grade', params: defaultParams() });
    expect(snap.params.tone.exposure).toBe(0);
    expect(Object.keys(snap.params).length).toBeGreaterThan(10);
    const empty = snapshotSchema.parse({ id: 's2', photoId: 'ph1', ts: 2, name: 'Untitled' });
    expect(empty.params.v).toBe(PARAMS_VERSION);
  });

  it('a history entry pairs a label with a diff', () => {
    const entry = historyEntrySchema.parse({
      id: 'h1',
      photoId: 'ph1',
      ts: 1,
      label: 'Exposure +0.35',
      diff: { 'tone.exposure': 0.35 },
    });
    expect(entry.diff['tone.exposure']).toBe(0.35);
    expect(historyEntrySchema.parse({ id: 'h2', photoId: 'ph1', ts: 2, label: 'Reset' }).diff).toEqual({});
    expect(entry.branch).toBe(0);
  });

  it('the schema round-trips through JSON (sidecar / IPC boundary)', () => {
    const p = parseParams({ tone: { exposure: -0.7 }, layers: [{ id: 'l1', kind: 'group', opacity: 62 }] });
    const json = JSON.stringify(p);
    expect(developParamsSchema.parse(JSON.parse(json))).toEqual(p);
    expect(json.length).toBeLessThan(8192); // a full document stays small enough for a sidecar
  });
});
