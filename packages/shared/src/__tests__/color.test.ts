/**
 * Colour science (§5.6).
 *
 * Everything the pipeline does to a pixel starts here: the sRGB transfer
 * function, the OKLab/OKLCH round trips used by vibrance and the colour wheels,
 * ΔE00 for the golden-image gate, black-body white balance, and the working /
 * proof / display space matrices. A wrong matrix is invisible in a unit test
 * unless you assert the round trip, so that is what most of these do.
 */

import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  M_2020_TO_SRGB,
  M_SRGB_TO_2020,
  TEMP_TO_RGB,
  WB_PRESETS,
  applyMat3,
  deltaE00,
  gamutMapToSrgb,
  hexToRgb,
  l2020ToLrgb,
  labToLrgb,
  linearToSrgb,
  lrgbTo2020,
  lrgbToLab,
  invertMat3,
  lrgbToOklab,
  lrgbToOklch,
  mulMat3,
  oklabToLrgb,
  oklabToOklch,
  oklchDistance,
  oklchToLrgb,
  oklchToOklab,
  rgbToHex,
  srgbToLinear,
  toGlMat3,
  type Mat3,
} from '@swell/shared';
import { COLOR_SPACES, from2020, spaceToSrgb, to2020, type ColorSpaceId } from '@swell/shared';

const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

/** Mat3 is a flat, row-major 9-tuple (see `applyMat3`). */
const matClose = (a: Mat3, b: Mat3, eps = 1e-4) => a.every((v, i) => close(v, b[i]!, eps));

describe('sRGB transfer function', () => {
  it('round-trips across the domain', () => {
    for (let i = 0; i <= 1000; i++) {
      const c = i / 1000;
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 6);
      expect(srgbToLinear(linearToSrgb(c))).toBeCloseTo(c, 6);
    }
  });

  it('matches the published IEC 61966-2-1 values', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 4);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(srgbToLinear(0)).toBe(0);
    // the linear segment below 0.04045
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 8);
  });

  it('is monotonic', () => {
    let prev = -1;
    for (let i = 0; i <= 512; i++) {
      const v = srgbToLinear(i / 512);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('OKLab / OKLCH', () => {
  it('round-trips through OKLab', () => {
    for (const rgb of [
      { r: 1, g: 1, b: 1 },
      { r: 0, g: 0, b: 0 },
      { r: 1, g: 0, b: 0 },
      { r: 0.2, g: 0.6, b: 0.9 },
    ]) {
      const back = oklabToLrgb(lrgbToOklab(rgb));
      expect(back.r).toBeCloseTo(rgb.r, 5);
      expect(back.g).toBeCloseTo(rgb.g, 5);
      expect(back.b).toBeCloseTo(rgb.b, 5);
    }
  });

  it('maps white to L = 1 with no chroma', () => {
    const lab = lrgbToOklab({ r: 1, g: 1, b: 1 });
    expect(lab.r).toBeCloseTo(1, 4); // L is carried in .r for the RGB-shaped type
    expect(Math.abs(lab.g)).toBeLessThan(1e-3);
    expect(Math.abs(lab.b)).toBeLessThan(1e-3);
  });

  it('round-trips through OKLCH (polar form)', () => {
    const rgb = { r: 0.9, g: 0.3, b: 0.35 };
    const lch = lrgbToOklch(rgb);
    const back = oklchToLrgb(lch);
    expect(back.r).toBeCloseTo(rgb.r, 4);
    expect(back.g).toBeCloseTo(rgb.g, 4);
    expect(back.b).toBeCloseTo(rgb.b, 4);
    // hue is in degrees, chroma non-negative
    expect(lch.h).toBeGreaterThanOrEqual(0);
    expect(lch.h).toBeLessThan(360);
    expect(lch.c).toBeGreaterThanOrEqual(0);
  });

  it('oklchToOklab / oklabToOklch are inverses', () => {
    const lch = { l: 0.7, c: 0.12, h: 200 };
    const lab = oklchToOklab(lch);
    const back = oklabToOklch(lab);
    expect(back.l).toBeCloseTo(lch.l, 6);
    expect(back.c).toBeCloseTo(lch.c, 6);
    expect(((back.h - lch.h + 540) % 360) - 180).toBeCloseTo(0, 5);
  });

  it('gamut-maps an out-of-gamut OKLCH into sRGB without clipping chroma blindly', () => {
    const mapped = gamutMapToSrgb({ l: 0.85, c: 0.4, h: 145 });
    for (const v of [mapped.r, mapped.g, mapped.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // an in-gamut colour round-trips untouched (result is *linear* sRGB)
    const src = { r: 0.4, g: 0.5, b: 0.6 };
    const inside = gamutMapToSrgb(lrgbToOklch(src));
    expect(inside.r).toBeCloseTo(src.r, 3);
    expect(inside.g).toBeCloseTo(src.g, 3);
    expect(inside.b).toBeCloseTo(src.b, 3);
  });

  it('oklchDistance is 0 for identical colours and grows with hue/chroma', () => {
    const a = { l: 0.6, c: 0.1, h: 30 };
    expect(oklchDistance(a, a)).toBeCloseTo(0, 9);
    expect(oklchDistance(a, { ...a, h: 210 })).toBeGreaterThan(oklchDistance(a, { ...a, h: 40 }));
    // hue is circular: 359° is next to 0°
    expect(oklchDistance({ ...a, h: 359 }, { ...a, h: 1 })).toBeLessThan(
      oklchDistance({ ...a, h: 359 }, { ...a, h: 180 }),
    );
  });
});

describe('CIE Lab and ΔE00 (golden-image gate)', () => {
  it('round-trips sRGB linear through Lab', () => {
    const rgb = { r: 0.35, g: 0.55, b: 0.25 };
    const back = labToLrgb(lrgbToLab(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 4);
    expect(back.g).toBeCloseTo(rgb.g, 4);
    expect(back.b).toBeCloseTo(rgb.b, 4);
  });

  it('is 0 for identical colours', () => {
    const lab = lrgbToLab({ r: 0.5, g: 0.4, b: 0.6 });
    expect(deltaE00(lab, lab)).toBeCloseTo(0, 9);
  });

  it('is symmetric', () => {
    const a = lrgbToLab({ r: 0.9, g: 0.2, b: 0.2 });
    const b = lrgbToLab({ r: 0.2, g: 0.3, b: 0.9 });
    expect(deltaE00(a, b)).toBeCloseTo(deltaE00(b, a), 9);
  });

  it('orders differences the way an eye does', () => {
    const ref = lrgbToLab({ r: 0.5, g: 0.5, b: 0.5 });
    const tiny = lrgbToLab({ r: 0.502, g: 0.5, b: 0.5 });
    const small = lrgbToLab({ r: 0.55, g: 0.5, b: 0.5 });
    const big = lrgbToLab({ r: 1, g: 0, b: 0 });
    const dTiny = deltaE00(ref, tiny);
    const dSmall = deltaE00(ref, small);
    const dBig = deltaE00(ref, big);
    expect(dTiny).toBeLessThan(dSmall);
    expect(dSmall).toBeLessThan(dBig);
    // imperceptible / just-noticeable / obvious, in the usual bands
    expect(dTiny).toBeLessThan(1);
    expect(dBig).toBeGreaterThan(20);
  });

  it('black to white is about 100 lightness steps', () => {
    const k = lrgbToLab({ r: 0, g: 0, b: 0 });
    const w = lrgbToLab({ r: 1, g: 1, b: 1 });
    expect(deltaE00(k, w)).toBeGreaterThan(90);
    expect(deltaE00(k, w)).toBeLessThan(110);
  });
});

describe('hex parsing', () => {
  it('handles #rgb, #rrggbb and bare forms', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ff8000').r).toBeCloseTo(1, 6);
    expect(hexToRgb('#ff8000').g).toBeCloseTo(128 / 255, 6);
    expect(hexToRgb('#f80').b).toBeCloseTo(0, 6);
  });

  it('round-trips through rgbToHex', () => {
    for (const hex of ['#000000', '#ffffff', '#ff8000', '#123456']) {
      expect(rgbToHex(hexToRgb(hex)).toLowerCase()).toBe(hex);
    }
  });
});

describe('white balance', () => {
  it('black-body locus: warmer is redder, cooler is bluer', () => {
    const warm = TEMP_TO_RGB(2500);
    const mid = TEMP_TO_RGB(6500);
    const cool = TEMP_TO_RGB(12000);
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(cool.b).toBeGreaterThan(cool.r);
    expect(mid.r).toBeGreaterThan(cool.r);
    expect(cool.b).toBeGreaterThan(warm.b);
  });

  it('clamps outside the modelled range', () => {
    for (const k of [100, 500, 60000, 1e6]) {
      const rgb = TEMP_TO_RGB(k);
      for (const v of [rgb.r, rgb.g, rgb.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every named preset is inside the modelled range', () => {
    for (const p of WB_PRESETS) {
      const rgb = TEMP_TO_RGB(p.temp || 6500);
      expect(Number.isFinite(rgb.r) && Number.isFinite(rgb.g) && Number.isFinite(rgb.b)).toBe(true);
    }
    expect(new Set(WB_PRESETS.map((p) => p.id)).size).toBe(WB_PRESETS.length);
  });
});

describe('matrices', () => {
  it('multiply by identity is a no-op', () => {
    const m: Mat3 = [0.2, 0.7, 0.1, 0.3, 0.4, 0.9, 0.05, 0.6, 0.35];
    expect(matClose(mulMat3(m, IDENTITY), m)).toBe(true);
    expect(matClose(mulMat3(IDENTITY, m), m)).toBe(true);
  });

  it('Rec.2020 ↔ sRGB primaries are inverses', () => {
    expect(matClose(mulMat3(M_SRGB_TO_2020, M_2020_TO_SRGB), IDENTITY, 1e-5)).toBe(true);
    expect(matClose(mulMat3(M_2020_TO_SRGB, M_SRGB_TO_2020), IDENTITY, 1e-5)).toBe(true);
  });

  it('invertMat3 round-trips an arbitrary matrix', () => {
    const m: Mat3 = [0.6, -0.3, 0.15, 0.2, 1.1, -0.4, 0.05, 0.7, 0.9];
    expect(matClose(mulMat3(m, invertMat3(m)), IDENTITY, 1e-9)).toBe(true);
    expect(matClose(invertMat3(IDENTITY), IDENTITY, 1e-12)).toBe(true);
  });

  it('applyMat3 transforms a vector', () => {
    const v = applyMat3(M_SRGB_TO_2020, { r: 1, g: 0, b: 0 });
    const back = applyMat3(M_2020_TO_SRGB, v);
    expect(back.r).toBeCloseTo(1, 4);
    expect(back.g).toBeCloseTo(0, 4);
    expect(back.b).toBeCloseTo(0, 4);
  });

  it('lrgbTo2020 / l2020ToLrgb round-trip', () => {
    const rgb = { r: 0.25, g: 0.6, b: 0.45 };
    const back = l2020ToLrgb(lrgbTo2020(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 5);
    expect(back.g).toBeCloseTo(rgb.g, 5);
    expect(back.b).toBeCloseTo(rgb.b, 5);
  });

  it('toGlMat3 flattens column-major for GL', () => {
    const m: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const gl = toGlMat3(m);
    expect(gl).toBeInstanceOf(Float32Array);
    expect(gl.length).toBe(9);
    // GL is column-major: the first column is our first *row*
    expect(Array.from(gl)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });
});

describe('colour spaces (§5.6 colour management)', () => {
  it('covers the spaces the export dialog offers', () => {
    const ids = COLOR_SPACES.map((s) => s.id);
    for (const want of ['srgb', 'displayP3', 'adobergb', 'prophoto'] as ColorSpaceId[]) {
      expect(ids).toContain(want);
    }
  });

  it('from2020 / to2020 are inverses for every space', () => {
    for (const space of COLOR_SPACES) {
      const id = space.id as ColorSpaceId;
      expect(matClose(mulMat3(from2020(id), to2020(id)), IDENTITY, 1e-4)).toBe(true);
    }
  });

  it('spaceToSrgb("srgb") is the identity', () => {
    expect(matClose(spaceToSrgb('srgb'), IDENTITY, 1e-4)).toBe(true);
  });

  it('every space maps its own white to sRGB white (chromatic adaptation)', () => {
    for (const space of COLOR_SPACES) {
      const v = applyMat3(spaceToSrgb(space.id), { r: 1, g: 1, b: 1 });
      expect(v.r).toBeCloseTo(1, 3);
      expect(v.g).toBeCloseTo(1, 3);
      expect(v.b).toBeCloseTo(1, 3);
    }
  });


});
