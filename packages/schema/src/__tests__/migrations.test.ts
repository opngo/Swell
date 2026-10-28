/**
 * Param migrations (§7.2).
 *
 * A catalog can hold documents written by any older build, so the registry has
 * to upgrade them on load without losing edits and without touching the caller's
 * copy. These tests replay every shipped migration (1→2 curves, 2→3 layers) and
 * pin the guard rails: purity, idempotence, unknown keys and future versions.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  PARAMS_VERSION,
  defaultParams,
  migrate,
  parseParams,
  registerMigration,
} from '@swell/schema';

/** A v1 document, as written by the first shipping build. */
const v1Doc = () => ({
  v: 1,
  treatment: 'color',
  wb: { temp: 4800, tint: -6, mode: 'custom' },
  tone: { exposure: 0.4, contrast: 12 },
  curves: {
    mode: 'point',
    amount: 0.9,
    tone: [
      { x: 0, y: 0.04 },
      { x: 0.5, y: 0.55 },
      { x: 1, y: 0.97 },
    ],
    hue: [{ x: 0.1, y: 6 }],
    r: [],
    g: [],
    b: [],
  },
  locals: [
    {
      id: 'dodge',
      name: 'Dodge face',
      exposure: 0.3,
      contrast: 4,
      mask: { id: 'm1', kind: 'radial', radial: { cx: 0.5, cy: 0.4, rx: 0.2, ry: 0.2 }, feather: 30 },
    },
    { id: 'sky', name: 'Sky', highlights: -20 },
  ],
  removeBackground: { enabled: true, output: { kind: 'blur' } },
});

/** The same edit after 1→2 only. */
const v2Doc = () => ({
  v: 2,
  tone: { exposure: -0.2 },
  curves: { luma: [{ x: 0.25, y: 0.2 }], hueCurves: { hh: [], hs: [{ x: 0.5, y: -4 }], hl: [], ls: [], ss: [] } },
  locals: [{ id: 'grain', name: 'Grain pop', texture: 18 }],
});

/** Deep freeze: any mutation attempt throws in ESM strict mode. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

afterEach(() => {
  // registerMigration mutates the shared registry; keep tests independent.
  while (MIGRATIONS.length > 2) MIGRATIONS.pop();
});

describe('registry shape', () => {
  it('ships an unbroken chain from v1 to the current version', () => {
    const sorted = [...MIGRATIONS].sort((a, b) => a.from - b.from);
    expect(sorted[0]!.from).toBe(1);
    expect(sorted[sorted.length - 1]!.to).toBe(PARAMS_VERSION);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.from, `gap before ${sorted[i]!.label}`).toBe(sorted[i - 1]!.to);
    }
    for (const m of MIGRATIONS) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.run).toBe('function');
    }
  });

  it('tolerates documents that lack the fields it rewrites', () => {
    for (const m of MIGRATIONS) {
      expect(() => m.run({})).not.toThrow();
      expect(() => m.run({ curves: {}, locals: [], v: m.from })).not.toThrow();
      expect(m.run({ v: m.from })['v']).toBe(m.from);
    }
  });
});

describe('migrate()', () => {
  it('replays the whole chain from v1 and stamps the current version', () => {
    const { params, applied, fromVersion } = migrate(v1Doc());
    expect(fromVersion).toBe(1);
    expect(applied).toHaveLength(MIGRATIONS.length);
    expect(applied[0]).toContain('1→2');
    expect(applied[1]).toContain('2→3');
    expect(params.v).toBe(PARAMS_VERSION);
  });

  it('1→2 renames curves.tone to curves.luma and splits the hue curve', () => {
    const { params } = migrate(v1Doc());
    expect(params.curves.luma).toEqual([
      { x: 0, y: 0.04 },
      { x: 0.5, y: 0.55 },
      { x: 1, y: 0.97 },
    ]);
    expect(params.curves.amount).toBeCloseTo(0.9);
    expect(params.curves.hueCurves.hh).toEqual([{ x: 0.1, y: 6 }]);
    expect(params.curves.hueCurves.hs).toEqual([]);
    expect('tone' in params.curves).toBe(false);
    expect('hue' in params.curves).toBe(false);
  });

  it('2→3 turns local adjustments into a layer stack, masks included', () => {
    const { params } = migrate(v1Doc());
    expect(params.layers).toHaveLength(2);
    const first = params.layers[0]!;
    const second = params.layers[1]!;
    expect(first.kind).toBe('adjustment');
    expect(first.name).toBe('Dodge face');
    expect(first.visible).toBe(true);
    expect(first.opacity).toBe(100);
    expect(first.blend).toBe('normal');
    expect(first.adjust.exposure).toBeCloseTo(0.3);
    expect(first.adjust.contrast).toBe(4);
    expect(first.masks).toHaveLength(1);
    expect(first.masks[0]!.kind).toBe('radial');
    expect(first.masks[0]!.radial).toMatchObject({ cx: 0.5, cy: 0.4, rx: 0.2, ry: 0.2 });
    expect(second.name).toBe('Sky');
    expect(second.adjust.highlights).toBe(-20);
    expect(second.adjust.exposure).toBe(0);
    expect(second.masks).toEqual([]);
    expect('locals' in params).toBe(false);
  });

  it('2→3 moves removeBackground to bgRemoval', () => {
    const { params } = migrate(v1Doc());
    expect(params.bgRemoval?.enabled).toBe(true);
    expect(params.bgRemoval?.output.kind).toBe('blur');
    expect('removeBackground' in params).toBe(false);
  });

  it('keeps edits that were already in the modern shape', () => {
    const { params } = migrate(v1Doc());
    expect(params.wb.temp).toBe(4800);
    expect(params.wb.tint).toBe(-6);
    expect(params.wb.mode).toBe('custom');
    expect(params.tone.exposure).toBeCloseTo(0.4);
    expect(params.tone.contrast).toBe(12);
    expect(params.treatment).toBe('color');
  });

  it('runs only the migrations a v2 document still needs', () => {
    const { params, applied, fromVersion } = migrate(v2Doc());
    expect(fromVersion).toBe(2);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('2→3');
    expect(params.curves.luma).toEqual([{ x: 0.25, y: 0.2 }]);
    expect(params.curves.hueCurves.hs).toEqual([{ x: 0.5, y: -4 }]);
    expect(params.layers).toHaveLength(1);
    expect(params.layers[0]!.name).toBe('Grain pop');
    expect(params.layers[0]!.adjust.texture).toBe(18);
  });

  it('leaves a current document alone', () => {
    const current = parseParams({ tone: { exposure: 1.1 }, layers: [{ id: 'l1', kind: 'fill' }] });
    const { params, applied, fromVersion } = migrate(current);
    expect(applied).toEqual([]);
    expect(fromVersion).toBe(PARAMS_VERSION);
    expect(params).toEqual(current);
  });

  it('treats a document with no version stamp as v1', () => {
    const { applied, fromVersion, params } = migrate({ curves: { tone: [{ x: 0.5, y: 0.6 }] } });
    expect(fromVersion).toBe(1);
    expect(applied).toHaveLength(MIGRATIONS.length);
    expect(params.curves.luma).toEqual([{ x: 0.5, y: 0.6 }]);
  });

  it('fills defaults for a document that carries nothing', () => {
    const { params } = migrate({});
    expect(params).toEqual(defaultParams());
    expect(migrate(null).params).toEqual(defaultParams());
    expect(migrate('garbage').params).toEqual(defaultParams());
  });

  it('is idempotent — migrating twice changes nothing', () => {
    const once = migrate(v1Doc());
    const twice = migrate(once.params);
    expect(twice.applied).toEqual([]);
    expect(twice.params).toEqual(once.params);
  });

  it('never mutates the document it was handed', () => {
    const raw = deepFreeze(v1Doc());
    expect(() => migrate(raw)).not.toThrow();
    const after = migrate(structuredClone(raw));
    expect(after.params.layers).toHaveLength(2);
    // The frozen source still has its v1 shape.
    expect((raw as { curves: { tone?: unknown } }).curves.tone).toBeDefined();
    expect((raw as { locals?: unknown[] }).locals).toHaveLength(2);
  });

  it('drops keys this version does not know', () => {
    const { params } = migrate({ v: 3, tone: { exposure: 0.5 }, futureFeature: { a: 1 } });
    expect('futureFeature' in params).toBe(false);
    expect(params.tone.exposure).toBe(0.5);
  });

  it('refuses to downgrade a document from a newer build', () => {
    const future = { v: PARAMS_VERSION + 4, tone: { exposure: 0.75 } };
    const { params, applied, fromVersion } = migrate(future);
    expect(applied).toEqual([]);
    expect(fromVersion).toBe(PARAMS_VERSION + 4);
    expect(params.v).toBe(PARAMS_VERSION + 4);
    expect(params.tone.exposure).toBe(0.75);
  });

  it('stops instead of looping when the chain has a hole', () => {
    // No migration leaves v0 in the shipped registry: the walk must stop at once
    // and still hand back a usable, current document.
    const { applied, fromVersion, params } = migrate({ v: 0, tone: { exposure: 0.2 } });
    expect(fromVersion).toBe(0);
    expect(applied).toEqual([]);
    expect(params.v).toBe(PARAMS_VERSION);
    expect(params.tone.exposure).toBeCloseTo(0.2);
  });
});

describe('registerMigration()', () => {
  it('adds a step that migrate() then replays in order', () => {
    const shipped = MIGRATIONS.length;
    registerMigration({
      from: 0,
      to: 1,
      label: '0→1 legacy brightness → exposure',
      run: (p) => {
        const legacy = p['brightness'] as number | undefined;
        if (typeof legacy === 'number') p['tone'] = { exposure: legacy / 100 };
        delete p['brightness'];
        return p;
      },
    });
    const { applied, fromVersion, params } = migrate({ v: 0, brightness: 40 });
    expect(fromVersion).toBe(0);
    expect(applied[0]).toContain('0→1');
    expect(applied).toHaveLength(shipped + 1);
    expect(params.tone.exposure).toBeCloseTo(0.4);
    expect(params.v).toBe(PARAMS_VERSION);
  });

  it('keeps the registry sorted by source version', () => {
    registerMigration({ from: 0, to: 1, label: '0→1 a', run: (p) => p });
    registerMigration({ from: -1, to: 0, label: '-1→0 b', run: (p) => p });
    expect(MIGRATIONS.map((m) => m.from)).toEqual([...MIGRATIONS.map((m) => m.from)].sort((a, b) => a - b));
    expect(MIGRATIONS[0]!.from).toBe(-1);
  });
});
