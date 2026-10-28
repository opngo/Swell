/**
 * DevelopParams → GLSL uniforms (§5.7, §6).
 *
 * The GPU only ever sees numbers baked here, so this file is where a white
 * balance, a keystone correction or a layer stack either survives the trip or
 * silently doesn't. Everything is pure: no GL context needed.
 */

import { describe, expect, it } from 'vitest';
import {
  BEFORE_AFTER_MODE,
  BG_KIND,
  CLIPPING_MODE,
  calibrationMatrix,
  geometryMatrix,
  packLayers,
  proofMatrices,
  strokeCircles,
  toDisplayRgb,
  toWorking,
  wbGain,
  wbGainFromSample,
} from '@engine/uniforms.ts';
import { MAX_LAYERS } from '@swell/shaders';
import { IDENTITY, from2020, mulMat3, spaceToSrgb, srgbToLinearRgb, toGlMat3 } from '@swell/shared';
import { defaultParams, parseParams, type DevelopParams, type Mask } from '@swell/schema';

/** Apply a GL (column-major) mat3 the way the shader does: M · (x, y, 1). */
function applyMat3(gl: Float32Array, x: number, y: number): { x: number; y: number; w: number } {
  return {
    x: gl[0]! * x + gl[3]! * y + gl[6]!,
    y: gl[1]! * x + gl[4]! * y + gl[7]!,
    w: gl[2]! * x + gl[5]! * y + gl[8]!,
  };
}

/** Homography → normalised UV, mirroring `mapUv` in the geometry pass. */
function mapUv(gl: Float32Array, u: number, v: number) {
  const hp = applyMat3(gl, u - 0.5, v - 0.5);
  return { x: hp.x / hp.w + 0.5, y: hp.y / hp.w + 0.5, w: hp.w };
}

const lumaOf = (g: Float32Array) => 0.2126 * g[0]! + 0.7152 * g[1]! + 0.0722 * g[2]!;

/** Uniform arrays are Float32Array, so compare with a tolerance, never `toEqual`. */
function expectVec(actual: ArrayLike<number>, expected: readonly number[], digits = 5) {
  expect(actual.length).toBeGreaterThanOrEqual(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]! - expected[i]!), `component ${i}`).toBeLessThan(10 ** -digits);
  }
}

describe('wbGain — the Temp and Tint sliders', () => {
  it('is neutral at the reference white', () => {
    const g = wbGain(6500, 0);
    expect(g).toHaveLength(3);
    expect(g[0]).toBeCloseTo(1, 5);
    expect(g[1]).toBeCloseTo(1, 5);
    expect(g[2]).toBeCloseTo(1, 5);
  });

  it('a warm illuminant (low K) cools the image — blue gain up, red down', () => {
    for (const temp of [3200, 4000, 5500]) {
      const g = wbGain(temp, 0);
      expect(g[2]!, `${temp}K blue`).toBeGreaterThan(1);
      expect(g[0]!, `${temp}K red`).toBeLessThan(1);
      expect(g[2]!).toBeGreaterThan(g[0]!);
    }
  });

  it('a cool illuminant (high K) warms the image — red gain up, blue down', () => {
    for (const temp of [7500, 12000, 25000]) {
      const g = wbGain(temp, 0);
      expect(g[0]!, `${temp}K red`).toBeGreaterThan(1);
      expect(g[2]!, `${temp}K blue`).toBeLessThan(1);
    }
  });

  it('the named WB presets push the image the way their label says', () => {
    const tungsten = wbGain(3200, 0); // warm light → blue correction
    const shade = wbGain(7500, 0); // cool light → warm correction
    expect(tungsten[2]!).toBeGreaterThan(tungsten[0]!);
    expect(shade[0]!).toBeGreaterThan(shade[2]!);
  });

  it('keeps exposure constant (gains are luma-normalised)', () => {
    for (const temp of [3200, 4500, 5500, 6500, 8000, 12000, 30000]) {
      expect(lumaOf(wbGain(temp, 0)), `${temp}K`).toBeCloseTo(1, 4);
    }
  });

  it('stays inside the range the shader can use, however extreme the slider', () => {
    for (const temp of [2000, 50000, 1000, 100000]) {
      for (const tint of [-150, 0, 150]) {
        const g = wbGain(temp, tint);
        for (const v of g) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0.2);
          expect(v).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('positive tint goes magenta, negative goes green', () => {
    const magenta = wbGain(6500, 150);
    const green = wbGain(6500, -150);
    expect(magenta[1]!).toBeLessThan(1);
    expect(magenta[0]!).toBeGreaterThan(1);
    expect(magenta[2]!).toBeGreaterThan(1);
    expect(green[1]!).toBeGreaterThan(1);
    expect(green[0]!).toBeLessThan(1);
    // Tint is monotone in the slider.
    expect(wbGain(6500, 40)[1]!).toBeLessThan(wbGain(6500, 0)[1]!);
    expect(wbGain(6500, -40)[1]!).toBeGreaterThan(wbGain(6500, 0)[1]!);
  });

  it('the blue gain falls monotonically as the slider moves toward yellow', () => {
    let prev = Infinity;
    for (let temp = 2500; temp <= 20000; temp += 500) {
      const b = wbGain(temp, 0)[2]!;
      expect(b).toBeLessThan(prev);
      prev = b;
    }
  });
});

describe('wbGainFromSample — the WB eyedropper', () => {
  it('a neutral grey reads the reference white with no tint', () => {
    for (const v of [0.2, 0.5, 0.8]) {
      const { temp, tint } = wbGainFromSample(v, v, v);
      expect(temp, `grey ${v}`).toBe(6500);
      expect(Math.abs(tint)).toBeLessThan(1);
    }
  });

  it('an orange sample reads a warm illuminant, a blue sample a cool one', () => {
    expect(wbGainFromSample(0.8, 0.6, 0.35).temp).toBeLessThan(5000);
    expect(wbGainFromSample(0.35, 0.5, 0.85).temp).toBeGreaterThan(8000);
  });

  it('a green cast asks for magenta, a magenta cast asks for green', () => {
    expect(wbGainFromSample(0.5, 0.7, 0.5).tint).toBeGreaterThan(50);
    expect(wbGainFromSample(0.7, 0.45, 0.7).tint).toBeLessThan(-50);
  });

  it('stays inside the slider ranges', () => {
    for (const [r, g, b] of [
      [0.02, 0.9, 0.1],
      [0.95, 0.05, 0.05],
      [0, 0, 0],
      [1, 1, 1],
    ]) {
      const out = wbGainFromSample(r, g, b);
      expect(out.temp).toBeGreaterThanOrEqual(2000);
      expect(out.temp).toBeLessThanOrEqual(12000);
      expect(out.tint).toBeGreaterThanOrEqual(-150);
      expect(out.tint).toBeLessThanOrEqual(150);
      expect(Number.isFinite(out.tint)).toBe(true);
    }
  });

  it('applying the estimate actually neutralises the sampled pixel', () => {
    for (const sample of [
      [0.8, 0.6, 0.35],
      [0.35, 0.5, 0.85],
      [0.5, 0.7, 0.5],
      [0.7, 0.45, 0.7],
      [0.62, 0.58, 0.5],
    ] as const) {
      const [r, g, b] = sample;
      const lin = srgbToLinearRgb({ r, g, b });
      const spread = (v: [number, number, number]) => Math.max(...v) - Math.min(...v);
      const { temp, tint } = wbGainFromSample(r, g, b);
      const gain = wbGain(temp, tint);
      const corrected: [number, number, number] = [lin.r * gain[0]!, lin.g * gain[1]!, lin.b * gain[2]!];
      expect(spread(corrected), `sample ${sample.join(',')}`).toBeLessThan(spread([lin.r, lin.g, lin.b]));
    }
  });
});

describe('calibrationMatrix — camera profile primaries', () => {
  it('is the identity when nothing is shifted', () => {
    const m = calibrationMatrix(defaultParams().calibration);
    expect(m).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(m[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 6);
    }
  });

  it('shifting a primary hue/sat changes the matrix but keeps it finite', () => {
    const base = calibrationMatrix(defaultParams().calibration);
    const shifted = calibrationMatrix(
      parseParams({ calibration: { red: { hue: 40, sat: -30 }, green: { hue: -12 }, blue: { sat: 25 } } }).calibration,
    );
    let differs = false;
    for (let i = 0; i < 9; i++) {
      expect(Number.isFinite(shifted[i])).toBe(true);
      expect(Math.abs(shifted[i]!)).toBeLessThan(4);
      if (Math.abs(shifted[i]! - base[i]!) > 1e-4) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('shadows tint biases the diagonal toward magenta or green', () => {
    const magenta = calibrationMatrix(parseParams({ calibration: { shadowsTint: 100 } }).calibration);
    const green = calibrationMatrix(parseParams({ calibration: { shadowsTint: -100 } }).calibration);
    // Diagonal entries survive the row→column transpose unchanged.
    expect(magenta[0]!).toBeGreaterThan(1);
    expect(magenta[4]!).toBeLessThan(1);
    expect(green[0]!).toBeLessThan(1);
    expect(green[4]!).toBeGreaterThan(1);
  });

  it('uploads column-major, so the first GL column is the red primary', () => {
    // red.hue = 100 → rh = 0.32, and only the red column moves: (1, ∓0.3·rh).
    const m = calibrationMatrix(parseParams({ calibration: { red: { hue: 100 } } }).calibration);
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[1]).toBeCloseTo(-0.096, 6);
    expect(m[2]).toBeCloseTo(0.096, 6);
    expectVec(m.slice(3) as Float32Array, [0, 1, 0, 0, 0, 1], 6);
  });
});

describe('geometryMatrix — crop, perspective, rotation and Upright', () => {
  const geo = (over: Partial<DevelopParams['geometry']> = {}) => parseParams({ geometry: over }).geometry;

  it('is the identity for untouched geometry', () => {
    const m = geometryMatrix(geo());
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 6);
    const p = mapUv(m, 0.3, 0.7);
    expect(p.x).toBeCloseTo(0.3, 6);
    expect(p.y).toBeCloseTo(0.7, 6);
    expect(p.w).toBeCloseTo(1, 6);
  });

  it('the third row carries the perspective terms (kx, ky, 1)', () => {
    const m = geometryMatrix(geo({ vertical: 100 }));
    // GL column-major: row 3 = elements 2, 5, 8.
    expect(m[8]).toBeCloseTo(1, 6);
    expect(m[5]).toBeCloseTo(0.65, 6); // ky = vertical/100 · 0.65
    expect(m[2]).toBeCloseTo(0, 6);
    const bottom = mapUv(m, 0.5, 0.9);
    const top = mapUv(m, 0.5, 0.1);
    expect(bottom.w).toBeGreaterThan(1);
    expect(top.w).toBeLessThan(1);
    // Keystone: the far edge compresses toward the centre, the near edge expands.
    expect(Math.abs(bottom.y - 0.5)).toBeLessThan(0.4);
    expect(Math.abs(top.y - 0.5)).toBeGreaterThan(0.4);
  });

  it('horizontal perspective uses kx the same way', () => {
    const m = geometryMatrix(geo({ horizontal: -100 }));
    expect(m[2]).toBeCloseTo(-0.65, 6);
    expect(mapUv(m, 0.9, 0.5).w).toBeLessThan(1);
  });

  it('offsets translate the sampling window', () => {
    const m = geometryMatrix(geo({ xOffset: 50, yOffset: -50 }));
    const p = mapUv(m, 0.5, 0.5);
    expect(p.x).toBeCloseTo(0.75, 6);
    expect(p.y).toBeCloseTo(0.25, 6);
  });

  it('scale and aspect zoom the frame around its centre', () => {
    const zoomed = geometryMatrix(geo({ scale: 200 }));
    const p = mapUv(zoomed, 0.75, 0.5);
    expect(p.x).toBeCloseTo(1, 6); // 0.5 + 2·0.25
    const wide = geometryMatrix(geo({ aspect: 150 }));
    const q = mapUv(wide, 1, 0.5);
    expect(q.x).toBeCloseTo(1.25, 6); // 0.5 + 0.5 · 1.5
    expect(mapUv(wide, 0.5, 1).y).toBeCloseTo(0.5 + 0.5 / 1.5, 6); // squeezed to keep area
  });

  it('rotate turns the frame around its centre', () => {
    const m = geometryMatrix(geo({ rotate: 90 }));
    const centre = mapUv(m, 0.5, 0.5);
    expect(centre.x).toBeCloseTo(0.5, 6);
    expect(centre.y).toBeCloseTo(0.5, 6);
    const right = mapUv(m, 1, 0.5);
    expect(Math.abs(right.x - 0.5)).toBeLessThan(1e-5);
    expect(Math.abs(right.y - 0.5)).toBeCloseTo(0.5, 6);
  });

  it('Upright = Level removes the detected horizon tilt', () => {
    const off = geometryMatrix(geo({ upright: 'off' }), { horizonTilt: 12 });
    const level = geometryMatrix(geo({ upright: 'level' }), { horizonTilt: 12 });
    expect(off).toEqual(geometryMatrix(geo({ upright: 'off' }))); // tilt ignored
    expect(level).not.toEqual(off);
    // A 12° correction is the same matrix as a manual −12° rotation.
    expect(Array.from(level)).toEqual(Array.from(geometryMatrix(geo({ rotate: -12 }))));
  });

  it('Upright = Vertical adds keystone but ignores the horizon tilt', () => {
    const vertical = geometryMatrix(geo({ upright: 'vertical' }), { horizonTilt: 20 });
    expect(vertical[5]).toBeCloseTo(0.32, 6); // ky
    expect(vertical[2]).toBeCloseTo(0, 6); // kx untouched
    // No rotation was applied: the linear part is still the identity.
    expect(vertical[0]).toBeCloseTo(1, 6);
    expect(vertical[1]).toBeCloseTo(0, 6);
    expect(vertical[3]).toBeCloseTo(0, 6);
    expect(vertical[4]).toBeCloseTo(1, 6);
  });

  it('Upright = Auto levels and corrects verticals; Full adds horizontal', () => {
    const auto = geometryMatrix(geo({ upright: 'auto' }), { horizonTilt: 8 });
    expect(auto[5]).toBeCloseTo(0.32, 6);
    expect(auto[2]).toBeCloseTo(0, 6);
    const full = geometryMatrix(geo({ upright: 'full' }), { horizonTilt: 8 });
    expect(full[5]).toBeCloseTo(0.32, 6);
    expect(full[2]).toBeCloseTo(0.16, 6);
  });

  it('Upright = Guided needs two lines and stays finite', () => {
    const m = geometryMatrix(
      geo({
        upright: 'guided',
        guidedLines: [
          { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.26 },
          { x0: 0.2, y0: 0.1, x1: 0.24, y1: 0.9 },
        ],
      }),
    );
    for (const v of m) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(m)).not.toEqual(Array.from(geometryMatrix(geo({ upright: 'off' }))));
    // One line is not enough: nothing is applied.
    const one = geometryMatrix(geo({ upright: 'guided', guidedLines: [{ x0: 0, y0: 0, x1: 1, y1: 0.1 }] }));
    expect(Array.from(one)).toEqual(Array.from(geometryMatrix(geo({ upright: 'off' }))));
  });

  it('combines scale, rotate and offsets into one homography', () => {
    const m = geometryMatrix(geo({ scale: 150, rotate: 30, xOffset: 10, yOffset: -20, vertical: 25 }));
    for (const [u, v] of [
      [0, 0],
      [1, 1],
      [0.5, 0.5],
    ]) {
      const p = mapUv(m, u, v);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.w).not.toBeCloseTo(0, 6);
    }
    const centre = mapUv(m, 0.5, 0.5);
    expect(centre.x).toBeCloseTo(0.55, 6); // only the offset moves the centre
    expect(centre.y).toBeCloseTo(0.4, 6);
  });
});

describe('proofMatrices — soft proofing (S)', () => {
  it('off means identity proof and the normal display transform', () => {
    const off = proofMatrices(undefined, false);
    expect(Array.from(off.proof)).toEqual(Array.from(toGlMat3(IDENTITY)));
    expect(Array.from(off.display)).toEqual(Array.from(toGlMat3(from2020('srgb'))));
    const disabled = proofMatrices('prophoto', false);
    expect(Array.from(disabled.proof)).toEqual(Array.from(toGlMat3(IDENTITY)));
  });

  it('on routes the develop pass through the proof space and back to the display', () => {
    for (const space of ['srgb', 'adobergb', 'displayP3', 'prophoto', 'rec2020'] as const) {
      const { proof, display } = proofMatrices(space, true);
      expect(Array.from(proof)).toEqual(Array.from(toGlMat3(from2020(space))));
      expect(Array.from(display)).toEqual(Array.from(toGlMat3(spaceToSrgb(space))));
      for (const v of [...proof, ...display]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('proof → display composes back to the plain 2020 → sRGB path', () => {
    for (const space of ['adobergb', 'displayP3', 'prophoto'] as const) {
      const composed = mulMat3(spaceToSrgb(space), from2020(space));
      const direct = from2020('srgb');
      for (let i = 0; i < 9; i++) expect(composed[i]).toBeCloseTo(direct[i]!, 4);
    }
  });

  it('proofing sRGB is a no-op pair', () => {
    const { proof, display } = proofMatrices('srgb', true);
    expect(Array.from(display)).toEqual(Array.from(toGlMat3(IDENTITY)));
    expect(Array.from(proof)).toEqual(Array.from(toGlMat3(from2020('srgb'))));
  });
});

describe('strokeCircles — brush strokes to GPU circles', () => {
  const brush = (over: Partial<Mask> = {}, brushOver: Partial<Mask['brush']> = {}, strokes: Mask['strokes'] = []) =>
    ({
      id: 'm1',
      kind: 'brush',
      amount: 100,
      feather: 20,
      brush: { size: 22, feather: 50, flow: 100, density: 100, autoMask: false, erase: false, smoothing: 40, ...brushOver },
      strokes,
      refine: { shift: 0, smooth: 0, decontaminate: false },
      ...over,
    }) as unknown as Mask;

  it('packs nothing when there are no brush strokes', () => {
    const out = strokeCircles([]);
    expect(out.addCount).toBe(0);
    expect(out.subCount).toBe(0);
    expect(out.flow).toBe(1);
    expect(out.add).toHaveLength(48 * 4);
    expect(out.sub).toHaveLength(16 * 4);
  });

  it('ignores gradient and range masks', () => {
    const linear = { ...brush(), kind: 'linear', strokes: [{ x: 0.5, y: 0.5, r: 0.1, feather: 0.5, flow: 1, path: [] }] } as unknown as Mask;
    expect(strokeCircles([linear]).addCount).toBe(0);
  });

  it('turns a single click into one circle with radius and feather', () => {
    const out = strokeCircles([brush({}, {}, [{ x: 0.25, y: 0.75, r: 0.08, feather: 0.4, flow: 1, path: [] }])]);
    expect(out.addCount).toBe(1);
    expect(out.add[0]).toBeCloseTo(0.25);
    expect(out.add[1]).toBeCloseTo(0.75);
    expect(out.add[2]).toBeCloseTo(0.08);
    expect(out.add[3]).toBeCloseTo(0.4);
  });

  it('expands a tablet path into one circle per point', () => {
    const path: [number, number][] = [
      [0.1, 0.1],
      [0.2, 0.15],
      [0.3, 0.2],
    ];
    const out = strokeCircles([brush({}, {}, [{ x: 0.1, y: 0.1, r: 0.05, feather: 0.5, flow: 1, path }])]);
    expect(out.addCount).toBe(3);
    expect(out.add[4]).toBeCloseTo(0.2);
    expect(out.add[8]).toBeCloseTo(0.3);
  });

  it('an erase brush writes to the subtract list instead', () => {
    const out = strokeCircles([
      brush({}, { erase: true }, [
        { x: 0.5, y: 0.5, r: 0.1, feather: 0.5, flow: 1, path: [] },
        { x: 0.6, y: 0.5, r: 0.1, feather: 0.5, flow: 1, path: [] },
      ]),
    ]);
    expect(out.addCount).toBe(0);
    expect(out.subCount).toBe(2);
    expect(out.sub[0]).toBeCloseTo(0.5);
    expect(out.sub[4]).toBeCloseTo(0.6);
  });

  it('flow is brush flow × mask amount', () => {
    expect(strokeCircles([brush({ amount: 50 }, { flow: 80 })]).flow).toBeCloseTo(0.4);
    expect(strokeCircles([brush({ amount: 100 }, { flow: 100 })]).flow).toBeCloseTo(1);
    expect(strokeCircles([brush({ amount: 0 }, { flow: 100 })]).flow).toBeCloseTo(0);
  });

  it('clamps a zero radius to the smallest dab the shader can draw', () => {
    const out = strokeCircles([brush({}, {}, [{ x: 0.5, y: 0.5, r: 0, feather: 2, flow: 1, path: [] }])]);
    expect(out.add[2]).toBeCloseTo(0.004);
    const clamped = strokeCircles([brush({}, {}, [{ x: 0.5, y: 0.5, r: 0.1, feather: 2, flow: 1, path: [] }])]);
    expect(clamped.add[3]).toBe(1); // feather is clamped to 0..1
  });

  it('falls back to the brush feather when a stroke has none', () => {
    const out = strokeCircles([
      brush({}, { feather: 25 }, [{ x: 0.5, y: 0.5, r: 0.1, feather: undefined as unknown as number, flow: 1, path: [] }]),
    ]);
    expect(out.add[3]).toBeCloseTo(0.25);
  });

  it('respects the add/subtract caps so the uniform array cannot overflow', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      x: i / 60,
      y: 0.5,
      r: 0.02,
      feather: 0.5,
      flow: 1,
      path: [] as [number, number][],
    }));
    expect(strokeCircles([brush({}, {}, many)]).addCount).toBe(48);
    expect(strokeCircles([brush({}, { erase: true }, many)]).subCount).toBe(16);
    expect(strokeCircles([brush({}, {}, many)], 8, 4).addCount).toBe(8);
  });
});

describe('packLayers — the stack the GPU can address', () => {
  const layers = (n: number, over: Partial<DevelopParams['layers'][number]> = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `l${i}`, kind: 'adjustment' as const, ...over }));

  it('allocates exactly MAX_LAYERS slots and nothing else when empty', () => {
    const out = packLayers(defaultParams(), 1.5);
    expect(out.count).toBe(0);
    expect(out.layers).toEqual([]);
    expect(out.maskDraws).toEqual([]);
    expect(out.imageSlots).toEqual([null, null]);
    for (const arr of [out.op, out.adjA, out.adjB, out.adjC, out.adjD, out.fill, out.fill2]) {
      expect(arr).toHaveLength(MAX_LAYERS * 4);
    }
    expect(out.img).toHaveLength(8);
    expect(out.img2).toHaveLength(8);
  });

  it('packs opacity, blend index, mask flag and kind into one vec4', () => {
    const params = parseParams({
      layers: [
        { id: 'a', kind: 'adjustment', opacity: 75, blend: 'multiply', adjust: { exposure: 0.6 } },
        { id: 'b', kind: 'adjustment', opacity: 100, blend: 'screen', masks: [{ id: 'm', kind: 'linear' }] },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.count).toBe(2);
    expect(out.op[0]).toBeCloseTo(0.75);
    expect(out.op[1]).toBe(1); // multiply
    expect(out.op[2]).toBe(0); // no mask
    expect(out.op[3]).toBe(0); // adjustment
    expect(out.op[4]).toBeCloseTo(1);
    expect(out.op[5]).toBe(2); // screen
    expect(out.op[6]).toBe(1); // masked
    expect(out.adjA[0]).toBeCloseTo(0.6);
    expect(out.maskDraws).toHaveLength(1);
    expect(out.maskDraws[0]!.slot).toBe(1);
    expect(out.maskDraws[0]!.kind).toBe(1); // linear gradient
  });

  it('drops hidden layers and keeps the order bottom → top', () => {
    const params = parseParams({
      layers: [
        { id: 'a', kind: 'adjustment', name: 'bottom' },
        { id: 'b', kind: 'adjustment', name: 'hidden', visible: false },
        { id: 'c', kind: 'adjustment', name: 'top' },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.count).toBe(2);
    expect(out.layers.map((l) => l.name)).toEqual(['bottom', 'top']);
  });

  it('a group multiplies its opacity into its children and adds no slot', () => {
    const params = parseParams({
      layers: [
        { id: 'g', kind: 'group', opacity: 50 },
        { id: 'c1', kind: 'adjustment', parentId: 'g', opacity: 80 },
        { id: 'c2', kind: 'adjustment', parentId: 'g', opacity: 100 },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.count).toBe(2);
    expect(out.layers.map((l) => l.id)).toEqual(['c1', 'c2']);
    expect(out.op[0]).toBeCloseTo(0.4); // 0.8 · 0.5
    expect(out.op[4]).toBeCloseTo(0.5); // 1.0 · 0.5
  });

  it('an empty group still occupies a slot', () => {
    const out = packLayers(parseParams({ layers: [{ id: 'g', kind: 'group', opacity: 40 }] }), 1.5);
    expect(out.count).toBe(1);
    expect(out.op[0]).toBeCloseTo(0.4);
  });

  it('solo shows only the soloed layers', () => {
    const params = parseParams({
      layers: [
        { id: 'a', kind: 'adjustment', solo: true },
        { id: 'b', kind: 'adjustment' },
        { id: 'c', kind: 'adjustment', solo: true },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.layers.map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('caps at MAX_LAYERS even though the document allows 64', () => {
    const out = packLayers(parseParams({ layers: layers(64) }), 1.5);
    expect(out.count).toBe(MAX_LAYERS);
    expect(out.layers).toHaveLength(MAX_LAYERS);
  });

  it('gives image layers the two texture slots and their transform', () => {
    const params = parseParams({
      layers: [
        {
          id: 'i1',
          kind: 'image',
          image: { src: 'a.png', x: 0.3, y: 0.4, scale: 1.5, rotation: 90, aspect: 2, flipH: true },
          fill: 80,
        },
        { id: 'i2', kind: 'image', image: { src: 'b.png' } },
        { id: 'i3', kind: 'image', image: { src: 'c.png' } },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.count).toBe(3);
    expect(out.op[3]).toBe(1); // first image slot
    expect(out.op[7]).toBe(2); // second image slot
    expect(out.op[11]).toBe(0); // third falls back to a plain adjustment
    expect(out.imageSlots[0]?.id).toBe('i1');
    expect(out.imageSlots[1]?.id).toBe('i2');
    expect(out.img[0]).toBeCloseTo(0.3);
    expect(out.img[1]).toBeCloseTo(0.4);
    expect(out.img[2]).toBeCloseTo(1.5);
    expect(out.img[3]).toBeCloseTo(Math.PI / 2); // degrees → radians
    expect(out.img2[0]).toBeCloseTo(1.5 / 2); // stage aspect / image aspect
    expect(out.img2[1]).toBe(1); // flipH
    expect(out.img2[3]).toBeCloseTo(0.8); // fill as a fraction
  });

  it('converts fill-layer colours into the working space', () => {
    const params = parseParams({
      layers: [{ id: 'f', kind: 'fill', fillLayer: { kind: 'gradient', color: '#ff0000', color2: '#0000ff', angle: 45 } }],
    });
    const out = packLayers(params, 1.5);
    expect(out.op[3]).toBe(3); // fill kind
    expect(out.fill[3]).toBe(2); // gradient
    expect(out.fill2[3]).toBe(45);
    const red = toWorking('#ff0000');
    expect(out.fill[0]).toBeCloseTo(red[0], 6);
    expect(out.fill[1]).toBeCloseTo(red[1], 6);
    expect(out.fill[2]).toBeCloseTo(red[2], 6);
    const blue = toWorking('#0000ff');
    expect(out.fill2[2]).toBeCloseTo(blue[2], 6);
    expect(out.fill2[0]).toBeCloseTo(blue[0], 6);
  });

  it('builds a mask draw per masked layer, with matte kinds flagged', () => {
    const params = parseParams({
      layers: [
        { id: 'a', kind: 'adjustment', masks: [{ id: 'm1', kind: 'radial', radial: { cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.3, rotation: 30 }, feather: 40, amount: 80 }] },
        { id: 'b', kind: 'adjustment', masks: [{ id: 'm2', kind: 'sky' }] },
        { id: 'c', kind: 'adjustment', masks: [{ id: 'm3', kind: 'luminance', luminance: { lo: 0.2, hi: 0.7, smooth: 0.3 } }] },
        { id: 'd', kind: 'adjustment' },
      ],
    });
    const out = packLayers(params, 1.5);
    expect(out.maskDraws).toHaveLength(3);
    const [radial, sky, lum] = out.maskDraws as [typeof out.maskDraws[number], typeof out.maskDraws[number], typeof out.maskDraws[number]];
    expect(radial.slot).toBe(0);
    expect(radial.kind).toBe(2);
    expectVec(radial.maskA, [0.4, 0.6, 0.2, 0.3]);
    expect(radial.maskB[0]).toBeCloseTo(0.4); // feather 40 %
    expect(radial.maskB[2]).toBeCloseTo(0.8); // amount 80 %
    expect(radial.maskB[3]).toBeCloseTo((30 * Math.PI) / 180);
    expect(radial.needsMatte).toBe(false);
    expect(sky.kind).toBe(5);
    expect(sky.matteMode).toBe(1);
    expect(sky.needsMatte).toBe(true);
    expect(lum.kind).toBe(3);
    expectVec(lum.maskA, [0.2, 0.7, 0.3, 0]);
    expect(out.maskDraws.every((d) => d.slot < out.count)).toBe(true);
  });

  it('a background mask asks for matte mode 2', () => {
    const params = parseParams({ layers: [{ id: 'a', kind: 'adjustment', masks: [{ id: 'm', kind: 'background' }] }] });
    const draw = packLayers(params, 1.5).maskDraws[0]!;
    expect(draw.matteMode).toBe(2);
    expect(draw.needsMatte).toBe(true);
  });

  it('a luminance refine component rides along in the range vector', () => {
    const params = parseParams({
      layers: [
        {
          id: 'a',
          kind: 'adjustment',
          masks: [
            { id: 'm1', kind: 'radial', op: 'replace' },
            { id: 'm2', kind: 'luminance', op: 'intersect', luminance: { lo: 0.1, hi: 0.9, smooth: 0.4 } },
          ],
        },
      ],
    });
    const draw = packLayers(params, 1.5).maskDraws[0]!;
    expect(draw.kind).toBe(2); // the radial gradient is primary
    expectVec(draw.range, [0.1, 0.9, 0.4, 1]);
  });
});

describe('colour helpers and mode tables', () => {
  it('toWorking converts sRGB hex into linear Rec.2020', () => {
    const white = toWorking('#ffffff');
    expect(white[0]).toBeCloseTo(1, 5);
    expect(white[1]).toBeCloseTo(1, 5);
    expect(white[2]).toBeCloseTo(1, 5);
    const black = toWorking('000000'); // no leading hash needed
    expect(black.every((v) => Math.abs(v) < 1e-6)).toBe(true);
    const red = toWorking('#ff0000');
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(red[0]).toBeGreaterThan(red[2]);
  });

  it('toDisplayRgb stays in display-encoded sRGB', () => {
    expect(toDisplayRgb('#ff8000')[0]).toBeCloseTo(1, 6);
    expect(toDisplayRgb('#ff8000')[1]).toBeCloseTo(128 / 255, 6);
    expect(toDisplayRgb('#ff8000')[2]).toBeCloseTo(0, 6);
  });

  it('overlay mode tables match the shader switches', () => {
    expect(CLIPPING_MODE).toEqual({ off: 0, both: 1, highlights: 2, shadows: 3 });
    expect(BG_KIND.transparent).toBe(0);
    expect(BG_KIND.none).toBe(0);
    expect(BG_KIND.checker).toBe(1);
    expect(BG_KIND.image).toBe(7);
    expect(new Set(Object.values(BG_KIND)).size).toBe(Object.values(BG_KIND).length - 1); // none/transparent share 0
    expect(BEFORE_AFTER_MODE).toEqual({ off: 0, split: 1, left: 2, right: 2, top: 3, bottom: 3, toggle: 4 });
  });
});
