/**
 * Curve maths (§5, Page 5).
 *
 * These are the invariants the whole tone pipeline rests on: the perceptual
 * encode/decode pair is exactly invertible, monotone cubic never overshoots
 * (no new extrema between knots — that is what "monotone" buys us), a LUT is
 * the identity for an untouched curve, hue curves are periodic, and the
 * parametric bands sum to a single continuous ramp.
 */

import { describe, expect, it } from 'vitest';
import {
  CURVE_K,
  CURVE_PRESETS,
  DEFAULT_PARAMETRIC,
  INVERT_CURVE,
  MIRROR_CURVE,
  blendCurveWithLinear,
  buildLut,
  buildParametricLut,
  composeLuts,
  decodePerceptual,
  encodePerceptual,
  monotoneTangents,
  normalizePoints,
  parametricWeights,
  sampleCurve,
  sampleParametric,
  samplePeriodic,
  type CurvePoint,
} from '@swell/shared';

const RAMP: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const S_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.18 },
  { x: 0.75, y: 0.82 },
  { x: 1, y: 1 },
];

describe('perceptual curve domain', () => {
  it('maps 0→0 and 1→1', () => {
    expect(encodePerceptual(0)).toBeCloseTo(0, 12);
    expect(encodePerceptual(1)).toBeCloseTo(1, 12);
    expect(decodePerceptual(0)).toBeCloseTo(0, 12);
    expect(decodePerceptual(1)).toBeCloseTo(1, 12);
  });

  it('is exactly invertible across the domain', () => {
    for (let i = 0; i <= 1000; i++) {
      const y = i / 1000;
      expect(decodePerceptual(encodePerceptual(y))).toBeCloseTo(y, 10);
    }
  });

  it('is monotonic and lifts shadows (K = 12)', () => {
    expect(CURVE_K).toBe(12);
    let prev = -1;
    for (let i = 0; i <= 512; i++) {
      const e = encodePerceptual(i / 512);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    // encoding lifts shadow values well above the identity ramp, which is why
    // shadow edits feel balanced instead of explosive
    expect(encodePerceptual(0.02)).toBeGreaterThan(0.02 * 3);
    expect(encodePerceptual(0.18)).toBeGreaterThan(0.18 * 2);
  });
});

describe('normalizePoints', () => {
  it('sorts by x, clamps and drops non-finite points', () => {
    const out = normalizePoints([
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.1 },
      { x: Number.NaN, y: 0.5 },
      { x: 1.4, y: 2 },
    ]);
    expect(out.map((p) => p.x)).toEqual([0.2, 0.8, 1]);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // y is clamped to a sane editing range, x to 0..1
    expect(out[2]!.y).toBeLessThanOrEqual(1.5);
  });

  it('keeps the last of two points at the same x (drag-past behaviour)', () => {
    const out = normalizePoints([
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.y).toBe(0.8);
  });
});

describe('sampling', () => {
  it('returns the identity for a two-point ramp', () => {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) {
      expect(sampleCurve(RAMP, x, 'monotone')).toBeCloseTo(x, 6);
      expect(sampleCurve(RAMP, x, 'linear')).toBeCloseTo(x, 6);
      expect(sampleCurve(RAMP, x, 'smooth')).toBeCloseTo(x, 6);
    }
  });

  it('clamps outside the first/last knot', () => {
    const pts: CurvePoint[] = [
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.6 },
    ];
    expect(sampleCurve(pts, 0)).toBeCloseTo(0.4, 6);
    expect(sampleCurve(pts, 1)).toBeCloseTo(0.6, 6);
  });

  it('linear interpolation hits the knots exactly', () => {
    for (const p of S_CURVE) {
      expect(sampleCurve(S_CURVE, p.x, 'linear')).toBeCloseTo(p.y, 6);
    }
  });

  it('monotone cubic never overshoots the knot range (no new extrema)', () => {
    const pts: CurvePoint[] = [
      { x: 0, y: 0.1 },
      { x: 0.3, y: 0.9 },
      { x: 0.6, y: 0.2 },
      { x: 1, y: 0.7 },
    ];
    const ys = pts.map((p) => p.y);
    for (let i = 0; i <= 2000; i++) {
      const y = sampleCurve(pts, i / 2000, 'monotone');
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
      expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
    }
  });

  it('monotone tangents are zero at a flat interior knot', () => {
    const pts: CurvePoint[] = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0.6 },
      { x: 0.6, y: 0.6 },
      { x: 1, y: 1 },
    ];
    const m = monotoneTangents(pts);
    expect(Math.abs(m[1]!)).toBeLessThan(1e-6);
    expect(Math.abs(m[2]!)).toBeLessThan(1e-6);
  });

  it('is monotonic for a monotonic S-curve', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 4096; i++) {
      const y = sampleCurve(S_CURVE, i / 4096, 'monotone');
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
});

describe('buildLut', () => {
  it('defaults to 4096 entries', () => {
    expect(buildLut(S_CURVE).length).toBe(4096);
    expect(buildLut(S_CURVE, 1024).length).toBe(1024);
  });

  it('is the identity ramp for a degenerate curve', () => {
    const lut = buildLut([], 256);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBeCloseTo(i / 255, 6);
    const single = buildLut([{ x: 0.5, y: 0.5 }], 256);
    for (let i = 0; i < 256; i++) expect(single[i]).toBeCloseTo(i / 255, 6);
  });

  it('stays inside 0..1 and agrees with sampleCurve', () => {
    const lut = buildLut(S_CURVE, 4096);
    for (let i = 0; i < 4096; i += 37) {
      const x = i / 4095;
      expect(lut[i]!).toBeGreaterThanOrEqual(0);
      expect(lut[i]!).toBeLessThanOrEqual(1);
      expect(lut[i]!).toBeCloseTo(sampleCurve(S_CURVE, x, 'monotone'), 4);
    }
  });

  it('composeLuts with the identity is a no-op', () => {
    const lut = buildLut(S_CURVE, 1024);
    const identity = buildLut([], 1024);
    const composed = composeLuts(lut, identity, 1024);
    for (let i = 0; i < 1024; i += 11) expect(composed[i]!).toBeCloseTo(lut[i]!, 4);
  });

  it('blendCurveWithLinear(0) is the identity and (1) is the curve', () => {
    const lut = buildLut(S_CURVE, 512);
    const zero = blendCurveWithLinear(S_CURVE, 0, 512);
    const one = blendCurveWithLinear(S_CURVE, 1, 512);
    for (let i = 0; i < 512; i += 13) {
      expect(zero[i]!).toBeCloseTo(i / 511, 6);
      expect(one[i]!).toBeCloseTo(lut[i]!, 6);
      // halfway blend sits halfway between identity and curve
      const half = blendCurveWithLinear(S_CURVE, 0.5, 512)[i]!;
      expect(half).toBeCloseTo((i / 511 + lut[i]!) / 2, 6);
    }
  });
});

describe('hue curves are periodic', () => {
  it('wraps: f(0) === f(1)', () => {
    const pts: CurvePoint[] = [
      { x: 0.1, y: 0.05 },
      { x: 0.5, y: -0.08 },
      { x: 0.9, y: 0.03 },
    ];
    expect(samplePeriodic(pts, 0)).toBeCloseTo(samplePeriodic(pts, 1), 6);
    expect(samplePeriodic(pts, -0.25)).toBeCloseTo(samplePeriodic(pts, 0.75), 6);
    expect(samplePeriodic(pts, 1.25)).toBeCloseTo(samplePeriodic(pts, 0.25), 6);
  });

  it('is continuous across the seam (no step at hue 0)', () => {
    const pts: CurvePoint[] = [
      { x: 0.05, y: 0.06 },
      { x: 0.5, y: -0.05 },
      { x: 0.95, y: 0.04 },
    ];
    const a = samplePeriodic(pts, 0.999);
    const b = samplePeriodic(pts, 0.001);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('an empty curve is the identity (zero delta)', () => {
    for (let i = 0; i <= 100; i++) expect(samplePeriodic([], i / 100)).toBeCloseTo(0, 6);
  });
});

describe('parametric curve (§5.1)', () => {
  it('bands are non-negative and form a partition of unity', () => {
    const splits: [number, number, number] = [25, 50, 75];
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      const w = parametricWeights(x, splits);
      for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
      // no dead zone: a slider always moves *something*
      expect(w.shadows + w.darks + w.lights + w.highlights).toBeCloseTo(1, 9);
    }
  });

  it('bands are local: each region owns its own span', () => {
    const splits: [number, number, number] = [25, 50, 75];
    const at = (x: number) => parametricWeights(x, splits);
    expect(at(0.05).shadows).toBeGreaterThan(at(0.05).highlights);
    expect(at(0.35).darks).toBeGreaterThan(at(0.35).shadows);
    expect(at(0.6).lights).toBeGreaterThan(at(0.6).darks);
    expect(at(0.95).highlights).toBeGreaterThan(at(0.95).lights);
    // exactly on a split the two neighbours share the weight
    const mid = at(0.5);
    expect(mid.darks).toBeCloseTo(mid.lights, 6);
  });

  it('moving a split handle moves the region boundary', () => {
    const narrow = parametricWeights(0.4, [20, 45, 70]);
    const wide = parametricWeights(0.4, [20, 70, 85]);
    expect(narrow.lights).toBeGreaterThan(wide.lights);
    expect(wide.darks).toBeGreaterThan(narrow.darks);
  });

  it('headroom anchoring: positive pushes can never clip white, negative never crush black', () => {
    const up = { ...DEFAULT_PARAMETRIC, highlights: 100, lights: 100, darks: 100, shadows: 100 };
    const down = { ...DEFAULT_PARAMETRIC, highlights: -100, lights: -100, darks: -100, shadows: -100 };
    // pushing everything up still leaves white exactly white (headroom → 0)
    expect(sampleParametric(1, up)).toBeCloseTo(1, 12);
    // pulling everything down still leaves black exactly black
    expect(sampleParametric(0, down)).toBeCloseTo(0, 12);
    // and neither ever leaves the domain
    for (const p of [up, down]) {
      for (let i = 0; i <= 100; i++) {
        const y = sampleParametric(i / 100, p);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('shadows weight peaks in the shadows, highlights in the highlights', () => {
    const splits: [number, number, number] = [25, 50, 75];
    const lo = parametricWeights(0.05, splits);
    const hi = parametricWeights(0.95, splits);
    expect(lo.shadows).toBeGreaterThan(lo.highlights);
    expect(hi.highlights).toBeGreaterThan(hi.shadows);
  });

  it('is the identity when every band is zero', () => {
    const lut = buildParametricLut(DEFAULT_PARAMETRIC, 512);
    for (let i = 0; i < 512; i++) expect(lut[i]!).toBeCloseTo(i / 511, 6);
  });

  it('positive highlights lift the top of the ramp and leave black alone', () => {
    const lut = buildParametricLut({ ...DEFAULT_PARAMETRIC, highlights: 60 }, 512);
    expect(lut[0]!).toBeCloseTo(0, 6);
    expect(lut[511]!).toBeGreaterThan(1 - 1e-6 - 0.0001);
    expect(lut[500]!).toBeGreaterThan(500 / 511);
    expect(lut[10]!).toBeCloseTo(10 / 511, 3);
  });

  it('never leaves 0..1', () => {
    const lut = buildParametricLut(
      { highlights: 100, lights: -100, darks: 100, shadows: -100, splits: [25, 50, 75] },
      1024,
    );
    for (let i = 0; i < 1024; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(0);
      expect(lut[i]!).toBeLessThanOrEqual(1);
    }
  });

  it('sampleParametric matches the LUT', () => {
    const p = { ...DEFAULT_PARAMETRIC, shadows: 30, highlights: -20 };
    const lut = buildParametricLut(p, 256);
    for (let i = 0; i < 256; i += 9) {
      expect(lut[i]!).toBeCloseTo(sampleParametric(i / 255, p), 5);
    }
  });
});

describe('curve power tools', () => {
  it('INVERT_CURVE flips y around 0.5', () => {
    const inv = INVERT_CURVE(S_CURVE);
    expect(inv[1]!.y).toBeCloseTo(1 - S_CURVE[1]!.y, 6);
  });

  it('MIRROR_CURVE flips x around 0.5', () => {
    const mir = MIRROR_CURVE(S_CURVE);
    expect(mir[0]!.x).toBeCloseTo(1 - S_CURVE[0]!.x, 6);
  });
});

describe('shipped curve presets stay legal', () => {
  it.each(CURVE_PRESETS.map((p) => [p.label, p] as const))('%s samples inside 0..1', (_label, preset) => {
    const lut = buildLut(preset.points, 1024);
    for (let i = 0; i < 1024; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(0);
      expect(lut[i]!).toBeLessThanOrEqual(1);
    }
  });
});
