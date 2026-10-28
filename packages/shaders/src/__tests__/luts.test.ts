/**
 * Curve → LUT baking (§5.5) and `.cube` import (§9.2).
 *
 * The shaders never evaluate a curve: the CPU bakes a 4096-entry ramp per
 * channel plus a 1024-entry hue-indexed table, and the GPU samples those. These
 * tests are the only thing standing between a curve edit and a wrong-looking
 * photo, so they check the maths rather than the pixels.
 */

import { describe, expect, it } from 'vitest';
import {
  HUE_LUT_SIZE,
  LUT_SIZE,
  buildCurveLuts,
  hasHueCurve,
  hasLumaCurve,
  hasRgbCurve,
  lutsSignature,
  parseCube,
} from '@swell/shaders';
import { defaultParams, parseParams } from '@swell/schema';

const SIZE = 64; // small so the tests stay fast; the shape is identical at 4096
const HUE = 32;

const identityAt = (i: number) => i / (SIZE - 1);
const curveParams = (curves: Record<string, unknown>) => parseParams({ curves });

describe('buildCurveLuts — buffers', () => {
  it('bakes buffers of exactly the size the shader expects', () => {
    const l = buildCurveLuts(defaultParams(), SIZE, HUE);
    expect(l.size).toBe(SIZE);
    expect(l.hueSize).toBe(HUE);
    expect(l.luma).toHaveLength(SIZE);
    expect(l.rgb).toHaveLength(SIZE * 3);
    expect(l.hue).toHaveLength(HUE * 4);
    expect(l.hue2).toHaveLength(HUE);
    expect(l.cube).toBeNull();
    expect(l.cubeAmount).toBe(1);
  });

  it('defaults to the documented sizes', () => {
    expect(LUT_SIZE).toBe(4096);
    expect(HUE_LUT_SIZE).toBe(1024);
    const l = buildCurveLuts(defaultParams());
    expect(l.size).toBe(LUT_SIZE);
    expect(l.hueSize).toBe(HUE_LUT_SIZE);
    expect(l.luma).toHaveLength(LUT_SIZE);
  });

  it('an untouched photo bakes to the identity ramp (no-op render)', () => {
    const l = buildCurveLuts(defaultParams(), SIZE, HUE);
    for (let i = 0; i < SIZE; i++) {
      expect(l.luma[i]).toBeCloseTo(identityAt(i), 6);
      expect(l.rgb[i * 3]).toBeCloseTo(identityAt(i), 6);
      expect(l.rgb[i * 3 + 1]).toBeCloseTo(identityAt(i), 6);
      expect(l.rgb[i * 3 + 2]).toBeCloseTo(identityAt(i), 6);
    }
    for (const v of l.hue) expect(v).toBe(0);
    for (const v of l.hue2) expect(v).toBe(0);
  });

  it('values stay inside the range a LUT texture can hold', () => {
    const l = buildCurveLuts(
      curveParams({
        amount: 1,
        luma: [
          { x: 0, y: 0.05 },
          { x: 0.5, y: 0.72 },
          { x: 1, y: 0.95 },
        ],
      }),
      SIZE,
      HUE,
    );
    for (const v of l.luma) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('buildCurveLuts — luma point curve', () => {
  it('lifts the midtones and keeps the endpoints', () => {
    const l = buildCurveLuts(
      curveParams({
        luma: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.62 },
          { x: 1, y: 1 },
        ],
      }),
      SIZE,
      HUE,
    );
    const mid = Math.round((SIZE - 1) * 0.5);
    expect(l.luma[mid]!).toBeGreaterThan(identityAt(mid) + 0.05);
    expect(l.luma[0]!).toBeCloseTo(0, 5);
    expect(l.luma[SIZE - 1]!).toBeCloseTo(1, 5);
  });

  it('is monotonic for a monotone point set — no ringing in gradients', () => {
    const l = buildCurveLuts(
      curveParams({
        interpolation: 'monotone',
        luma: [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.18 },
          { x: 0.5, y: 0.55 },
          { x: 0.75, y: 0.8 },
          { x: 1, y: 1 },
        ],
      }),
      SIZE,
      HUE,
    );
    for (let i = 1; i < SIZE; i++) {
      expect(l.luma[i]!, `luma fell at ${i}`).toBeGreaterThanOrEqual(l.luma[i - 1]! - 1e-6);
    }
  });

  it('interpolation mode changes the shape between the same points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 1 },
    ];
    const monotone = buildCurveLuts(curveParams({ interpolation: 'monotone', luma: points }), SIZE, HUE);
    const linear = buildCurveLuts(curveParams({ interpolation: 'linear', luma: points }), SIZE, HUE);
    const smooth = buildCurveLuts(curveParams({ interpolation: 'smooth', luma: points }), SIZE, HUE);
    // Linear is exactly the chord; the others bow away from it.
    const quarter = Math.round((SIZE - 1) * 0.25);
    expect(linear.luma[quarter]!).toBeCloseTo(identityAt(quarter) * 1.4, 5);
    expect(Math.abs(monotone.luma[quarter]! - linear.luma[quarter]!)).toBeGreaterThan(1e-3);
    expect(Math.abs(smooth.luma[quarter]! - linear.luma[quarter]!)).toBeGreaterThan(1e-3);
  });

  it('a single point is not a curve — it stays identity', () => {
    const l = buildCurveLuts(curveParams({ luma: [{ x: 0.5, y: 0.9 }] }), SIZE, HUE);
    for (let i = 0; i < SIZE; i++) expect(l.luma[i]).toBeCloseTo(identityAt(i), 6);
  });
});

describe('buildCurveLuts — parametric curve', () => {
  it('+shadows lifts the toe and leaves the highlights alone', () => {
    const l = buildCurveLuts(curveParams({ parametric: { shadows: 60 } }), SIZE, HUE);
    const toe = Math.round((SIZE - 1) * 0.08);
    const top = Math.round((SIZE - 1) * 0.95);
    expect(l.luma[toe]!).toBeGreaterThan(identityAt(toe));
    expect(Math.abs(l.luma[top]! - identityAt(top))).toBeLessThan(0.02);
  });

  it('+highlights lifts the top and leaves the toe alone', () => {
    const l = buildCurveLuts(curveParams({ parametric: { highlights: 60 } }), SIZE, HUE);
    const toe = Math.round((SIZE - 1) * 0.05);
    const top = Math.round((SIZE - 1) * 0.92);
    expect(l.luma[top]!).toBeGreaterThan(identityAt(top));
    expect(Math.abs(l.luma[toe]! - identityAt(toe))).toBeLessThan(0.02);
  });

  it('negative amounts push the other way', () => {
    const l = buildCurveLuts(curveParams({ parametric: { shadows: -60 } }), SIZE, HUE);
    const toe = Math.round((SIZE - 1) * 0.08);
    expect(l.luma[toe]!).toBeLessThan(identityAt(toe));
  });

  it('honours custom split points', () => {
    const wide = buildCurveLuts(curveParams({ parametric: { shadows: 50, splits: [10, 50, 90] } }), SIZE, HUE);
    const narrow = buildCurveLuts(curveParams({ parametric: { shadows: 50, splits: [40, 50, 60] } }), SIZE, HUE);
    const x = Math.round((SIZE - 1) * 0.2);
    // With the shadow split at 40 %, x=0.2 is still inside the shadow band;
    // with it at 10 % the same x is in the "darks" band and barely moves.
    expect(Math.abs(narrow.luma[x]! - identityAt(x))).toBeGreaterThan(
      Math.abs(wide.luma[x]! - identityAt(x)),
    );
  });

  it('composes with the point curve rather than replacing it', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.62 },
      { x: 1, y: 1 },
    ];
    // Sample in the toe, where the shadow band has weight: the point curve moves
    // x first, then the parametric curve acts on the result.
    const toe = Math.round((SIZE - 1) * 0.12);
    const pointOnly = buildCurveLuts(curveParams({ luma: points }), SIZE, HUE);
    const paramOnly = buildCurveLuts(curveParams({ parametric: { shadows: 40 } }), SIZE, HUE);
    const both = buildCurveLuts(curveParams({ luma: points, parametric: { shadows: 40 } }), SIZE, HUE);
    expect(both.luma[toe]!).not.toBeCloseTo(pointOnly.luma[toe]!, 5);
    expect(both.luma[toe]!).not.toBeCloseTo(paramOnly.luma[toe]!, 5);
    expect(both.luma[toe]!).toBeGreaterThan(pointOnly.luma[toe]!); // shadows lift, applied after
  });
});

describe('buildCurveLuts — amount, RGB channels and hue curves', () => {
  const sCurve = {
    luma: [
      { x: 0, y: 0.02 },
      { x: 0.5, y: 0.44 },
      { x: 1, y: 0.98 },
    ],
  };

  it('amount 0 is a no-op, amount 1 is the curve', () => {
    const zero = buildCurveLuts(curveParams({ ...sCurve, amount: 0 }), SIZE, HUE);
    const full = buildCurveLuts(curveParams({ ...sCurve, amount: 1 }), SIZE, HUE);
    for (let i = 0; i < SIZE; i++) expect(zero.luma[i]).toBeCloseTo(identityAt(i), 6);
    const mid = Math.round((SIZE - 1) * 0.5);
    expect(full.luma[mid]!).toBeLessThan(identityAt(mid));
  });

  it('amount scales the deviation from identity linearly (0–200 %)', () => {
    const half = buildCurveLuts(curveParams({ ...sCurve, amount: 0.5 }), SIZE, HUE);
    const full = buildCurveLuts(curveParams({ ...sCurve, amount: 1 }), SIZE, HUE);
    const double = buildCurveLuts(curveParams({ ...sCurve, amount: 2 }), SIZE, HUE);
    const mid = Math.round((SIZE - 1) * 0.5);
    const dev = (l: Float32Array) => l[mid]! - identityAt(mid);
    expect(dev(half.luma)).toBeCloseTo(dev(full.luma) / 2, 6);
    expect(dev(double.luma)).toBeCloseTo(dev(full.luma) * 2, 6);
  });

  it('packs per-channel curves into one RGB texel', () => {
    const l = buildCurveLuts(
      curveParams({
        r: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.6 },
          { x: 1, y: 1 },
        ],
      }),
      SIZE,
      HUE,
    );
    const mid = Math.round((SIZE - 1) * 0.5);
    expect(l.rgb[mid * 3]!).toBeGreaterThan(identityAt(mid));
    expect(l.rgb[mid * 3 + 1]!).toBeCloseTo(identityAt(mid), 6);
    expect(l.rgb[mid * 3 + 2]!).toBeCloseTo(identityAt(mid), 6);
  });

  it('amount scales the RGB channels too', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.66 },
      { x: 1, y: 1 },
    ];
    const mid = Math.round((SIZE - 1) * 0.5);
    const full = buildCurveLuts(curveParams({ g: pts, amount: 1 }), SIZE, HUE);
    const half = buildCurveLuts(curveParams({ g: pts, amount: 0.5 }), SIZE, HUE);
    expect(half.rgb[mid * 3 + 1]! - identityAt(mid)).toBeCloseTo((full.rgb[mid * 3 + 1]! - identityAt(mid)) / 2, 6);
  });

  it('writes each hue curve into its own slot', () => {
    // Hue deltas are normalised: ±0.5 is a half-turn (±180°), and the schema
    // clamps y to −0.5…1.5.
    const pts = [
      { x: 0.25, y: 0.3 },
      { x: 0.6, y: -0.2 },
    ];
    const hh = buildCurveLuts(curveParams({ hueCurves: { hh: pts } }), SIZE, HUE);
    const hs = buildCurveLuts(curveParams({ hueCurves: { hs: pts } }), SIZE, HUE);
    const hl = buildCurveLuts(curveParams({ hueCurves: { hl: pts } }), SIZE, HUE);
    const ls = buildCurveLuts(curveParams({ hueCurves: { ls: pts } }), SIZE, HUE);
    const ss = buildCurveLuts(curveParams({ hueCurves: { ss: pts } }), SIZE, HUE);
    const peak = (a: Float32Array) => Math.max(...Array.from(a));
    expect(peak(hh.hue.subarray(0, HUE * 4).filter((_, i) => i % 4 === 0) as unknown as Float32Array)).toBeGreaterThan(0);
    expect(peak(hs.hue.filter((_, i) => i % 4 === 1) as unknown as Float32Array)).toBeGreaterThan(0);
    expect(peak(hl.hue.filter((_, i) => i % 4 === 2) as unknown as Float32Array)).toBeGreaterThan(0);
    expect(peak(ls.hue.filter((_, i) => i % 4 === 3) as unknown as Float32Array)).toBeGreaterThan(0);
    expect(peak(ss.hue2)).toBeGreaterThan(0);
    // …and nothing leaks into the other slots.
    expect(Math.max(...Array.from(hh.hue2))).toBe(0);
    expect(Math.max(...Array.from(ss.hue))).toBe(0);
    expect(Math.max(...Array.from(hh.hue.filter((_, i) => i % 4 === 1) as unknown as Float32Array))).toBe(0);
  });

  it('hue curves are periodic — the ramp wraps from 1 back to 0', () => {
    // Two control points: +10 at hue 0, 0 at hue 0.5. Catmull-Rom on a ring, so
    // the last entries must climb back toward the first one.
    const l = buildCurveLuts(
      curveParams({ hueCurves: { hh: [{ x: 0, y: 0.4 }, { x: 0.5, y: 0 }] } }),
      SIZE,
      HUE,
    );
    const at = (i: number) => l.hue[i * 4]!;
    expect(at(0)).toBeCloseTo(0.4, 4);
    expect(at(Math.floor(HUE / 2))).toBeCloseTo(0, 4);
    expect(at(HUE - 1)).toBeGreaterThan(at(Math.floor(HUE * 0.75)));
    expect(at(HUE - 1)).toBeLessThanOrEqual(at(0) + 1e-4);
  });

  it('a single hue point is not a curve — it stays flat', () => {
    const l = buildCurveLuts(curveParams({ hueCurves: { hh: [{ x: 0.5, y: 12 }] } }), SIZE, HUE);
    for (const v of l.hue) expect(v).toBe(0);
  });
});

describe('curve predicates (the engine skips work when nothing is set)', () => {
  it('defaults have no curves at all', () => {
    const p = defaultParams();
    expect(hasLumaCurve(p)).toBe(false);
    expect(hasRgbCurve(p)).toBe(false);
    expect(hasHueCurve(p)).toBe(false);
  });

  it('each curve type flips exactly its own predicate', () => {
    expect(hasLumaCurve(curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] }))).toBe(true);
    expect(hasRgbCurve(curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] }))).toBe(false);
    expect(hasLumaCurve(curveParams({ parametric: { darks: 12 } }))).toBe(true);
    expect(hasLumaCurve(curveParams({ parametric: { splits: [20, 50, 80] } }))).toBe(false);
    expect(hasRgbCurve(curveParams({ b: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] }))).toBe(true);
    expect(hasHueCurve(curveParams({ hueCurves: { ls: [{ x: 0.2, y: 3 }, { x: 0.8, y: -3 }] } }))).toBe(true);
    expect(hasHueCurve(curveParams({ hueCurves: { hh: [{ x: 0.5, y: 3 }] } }))).toBe(false); // one point is not a curve
  });
});

describe('lutsSignature (cache key for LUT uploads)', () => {
  it('is stable for equal curve state', () => {
    const a = curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] });
    const b = curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] });
    expect(lutsSignature(a)).toBe(lutsSignature(b));
  });

  it('changes when anything about the curves changes', () => {
    const base = curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] });
    const sig = lutsSignature(base);
    expect(lutsSignature(curveParams({ luma: [{ x: 0, y: 0 }, { x: 1, y: 0.8 }] }))).not.toBe(sig);
    expect(lutsSignature(curveParams({ luma: base.curves.luma, amount: 0.5 }))).not.toBe(sig);
    expect(lutsSignature(curveParams({ luma: base.curves.luma, interpolation: 'linear' }))).not.toBe(sig);
    expect(lutsSignature(curveParams({ luma: base.curves.luma, lockLuminosity: true }))).not.toBe(sig);
    expect(lutsSignature(curveParams({ parametric: { lights: 10 } }))).not.toBe(lutsSignature(defaultParams()));
  });

  it('ignores everything that is not a curve, so tone edits do not re-upload LUTs', () => {
    const a = parseParams({ tone: { exposure: 0.4 }, curves: { amount: 0.9 } });
    const b = parseParams({ tone: { exposure: -1.2 }, wb: { temp: 3200 }, curves: { amount: 0.9 } });
    expect(lutsSignature(a)).toBe(lutsSignature(b));
  });
});

describe('parseCube (.cube / .3dl import)', () => {
  const cube2 = [
    '# a comment',
    'TITLE "Swell Test 2"',
    '',
    'LUT_3D_SIZE 2',
    '0.0 0.0 0.0',
    '1.0 0.0 0.0',
    '0.0 1.0 0.0',
    '1.0 1.0 0.0',
    '0.0 0.0 1.0',
    '1.0 0.0 1.0',
    '0.0 1.0 1.0',
    '1.0 1.0 1.0',
  ].join('\n');

  it('reads size, title and RGBA data', () => {
    const lut = parseCube(cube2);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Swell Test 2');
    expect(lut.data).toBeInstanceOf(Uint8Array);
    expect(lut.data).toHaveLength(2 * 2 * 2 * 4);
    // First entry is black, last is white, alpha is opaque everywhere.
    expect(Array.from(lut.data.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(lut.data.subarray(-4))).toEqual([255, 255, 255, 255]);
    for (let i = 3; i < lut.data.length; i += 4) expect(lut.data[i]).toBe(255);
  });

  it('accepts lowercase headers and comma-separated triplets', () => {
    const lut = parseCube(
      [
        'lut_3d_size 2',
        'title "Comma Cube"',
        '0.0,0.0,0.0',
        '1.0,0.0,0.0',
        '0.0,1.0,0.0',
        '1.0,1.0,0.0',
        '0.0,0.0,1.0',
        '1.0,0.0,1.0',
        '0.0,1.0,1.0',
        '1.0,1.0,1.0',
      ].join('\r\n'),
    );
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Comma Cube');
    expect(Array.from(lut.data.subarray(-4))).toEqual([255, 255, 255, 255]);
  });

  it('infers the size when the header is missing', () => {
    const noHeader = cube2.split('\n').filter((l) => !l.startsWith('LUT_3D_SIZE')).join('\n');
    expect(parseCube(noHeader).size).toBe(2);
  });

  it('applies DOMAIN_MIN / DOMAIN_MAX', () => {
    const lut = parseCube(
      ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 2.0 2.0 2.0', ...Array.from({ length: 7 }, () => '0.0 0.0 0.0'), '2.0 2.0 2.0'].join('\n'),
    );
    // The last entry sits at the top of the domain → full white.
    expect(Array.from(lut.data.subarray(-4))).toEqual([255, 255, 255, 255]);
    // A mid-domain value maps to half.
    const half = parseCube(
      ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 2.0 2.0 2.0', ...Array.from({ length: 8 }, () => '1.0 1.0 1.0')].join('\n'),
    );
    expect(half.data[0]).toBe(128);
  });

  it('clamps out-of-range values into the byte ramp', () => {
    const lut = parseCube(['LUT_3D_SIZE 2', ...Array.from({ length: 7 }, () => '-0.4 -0.4 -0.4'), '1.7 1.7 1.7'].join('\n'));
    expect(Array.from(lut.data.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(lut.data.subarray(-4, -1))).toEqual([255, 255, 255]);
  });

  it('reads a 1D LUT as a ramp', () => {
    const lut = parseCube(['LUT_1D_SIZE 4', '0.0 0.0 0.0', '0.33 0.33 0.33', '0.66 0.66 0.66', '1.0 1.0 1.0'].join('\n'));
    expect(lut.size).toBe(4);
    expect(lut.data).toHaveLength(4 * 4);
    expect(lut.data[0]).toBe(0);
    expect(lut.data[12]).toBe(255);
  });

  it('gives an untitled LUT a usable name', () => {
    expect(parseCube(['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '0.5 0.5 0.5')].join('\n')).title).toBe('Imported LUT');
  });

  it('rejects files that are not LUTs', () => {
    expect(() => parseCube('')).toThrow(/no LUT size/);
    expect(() => parseCube('# just a comment\nTITLE "nothing"')).toThrow(/no LUT size/);
    expect(() => parseCube(['LUT_3D_SIZE 4', '0.0 0.0 0.0', '1.0 1.0 1.0'].join('\n'))).toThrow(/Truncated/);
    expect(() => parseCube('LUT_3D_SIZE 1\n0.0 0.0 0.0')).toThrow();
  });

  it('a 33-cube declares the length a TEXTURE_3D upload needs', () => {
    const rows = ['LUT_3D_SIZE 3'];
    for (let i = 0; i < 27; i++) rows.push('0.1 0.2 0.3');
    const lut = parseCube(rows.join('\n'));
    expect(lut.size).toBe(3);
    expect(lut.data).toHaveLength(3 * 3 * 3 * 4);
  });
});
