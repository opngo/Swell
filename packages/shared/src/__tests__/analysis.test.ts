/**
 * On-device image analysis (§8.1) and the placeholder segmentation model (§8.5).
 *
 * Everything here is deterministic and runs on the CPU, so the tests need no
 * model weights and no GPU. They pin the contract the search index, the cull
 * badges, the Upright suggestion and the Remove Background matte depend on.
 */

import { describe, expect, it } from 'vitest';
import { analyzeImage, computeSubjectMatte, extractPalette, resizeImageData, toGray } from '@swell/shared';

function solid(w: number, h: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/**
 * Half sky, half ground with a `soft`-pixel transition; `tilt` leans the
 * boundary so the horizon is askew (the soft edge is what gives the gradient
 * estimator both components — a hard step would look level at any angle).
 */
function horizon(w = 120, h = 80, tilt = 0, soft = 2): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const sky = [110, 165, 230];
  const ground = [150, 120, 90];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = h / 2 + ((x - w / 2) / w) * tilt * h;
      const t = Math.min(1, Math.max(0, 0.5 + (y - edge) / soft)); // 0 sky … 1 ground
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[p + c] = sky[c]! + (ground[c]! - sky[c]!) * t;
      data[p + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/** High-frequency checkerboard — the "sharp" end of the detail scale. */
function checker(w = 64, h = 64, cell = 1): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = on ? 245 : 15;
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/** A dark blob centred on a bright, uniform backdrop. */
function subject(w = 96, h = 96, radius = 22): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < radius ** 2;
      const v = inside ? 40 : 235;
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

const sum = (a: Uint8ClampedArray) => a.reduce((t, v) => t + v, 0);
const midTones = (a: Uint8ClampedArray) => a.reduce((t, v) => t + (v > 20 && v < 235 ? 1 : 0), 0);

describe('toGray', () => {
  it('is Rec.709 luminance, one sample per pixel', () => {
    const g = toGray(solid(4, 2, 255, 255, 255));
    expect(g).toBeInstanceOf(Float32Array);
    expect(g.length).toBe(8);
    expect(g[0]).toBeCloseTo(1, 5);
    expect(toGray(solid(2, 2, 0, 0, 0))[0]).toBe(0);
  });

  it('weights green above red above blue', () => {
    const r = toGray(solid(2, 2, 255, 0, 0))[0]!;
    const g = toGray(solid(2, 2, 0, 255, 0))[0]!;
    const b = toGray(solid(2, 2, 0, 0, 255))[0]!;
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(r + g + b).toBeCloseTo(1, 4);
  });
});

describe('resizeImageData (box downsample)', () => {
  it('produces exactly the requested box', () => {
    const out = resizeImageData(solid(64, 48, 200, 100, 50), 16, 12);
    expect(out.width).toBe(16);
    expect(out.height).toBe(12);
    expect(out.data.length).toBe(16 * 12 * 4);
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(100);
    expect(out.data[2]).toBe(50);
    expect(out.data[3]).toBe(255);
  });

  it('averages the source box rather than picking one pixel', () => {
    const src = new Uint8ClampedArray(4 * 1 * 4);
    src.set([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
    const out = resizeImageData(new ImageData(src, 4, 1), 1, 1);
    // (0 + 100 + 200 + 255) / 4 ≈ 139 — a nearest-neighbour pick would be 0 or 255.
    expect(out.data[0]).toBeGreaterThan(80);
    expect(out.data[0]).toBeLessThan(200);
  });

  it('preserves large-scale structure', () => {
    const src = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const p = (y * 8 + x) * 4;
        const v = x < 4 ? 0 : 255; // left half black, right half white
        src[p] = src[p + 1] = src[p + 2] = v;
        src[p + 3] = 255;
      }
    const out = resizeImageData(new ImageData(src, 8, 8), 4, 4);
    expect(out.data[0]).toBe(0);
    expect(out.data[(4 * 3 + 3) * 4]).toBe(255);
  });

  it('survives degenerate sizes', () => {
    expect(resizeImageData(solid(3, 3, 9, 9, 9), 1, 1).data[0]).toBe(9);
    expect(() => resizeImageData(solid(1, 1, 9, 9, 9), 8, 8)).not.toThrow();
  });
});

describe('extractPalette', () => {
  it('clusters to at most k colours with normalised, descending weights', () => {
    const img = horizon();
    const pal = extractPalette(img.data, img.width, img.height, 4);
    expect(pal.length).toBeGreaterThan(0);
    expect(pal.length).toBeLessThanOrEqual(4);
    expect(pal.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 4);
    for (let i = 1; i < pal.length; i++) {
      expect(pal[i - 1]!.weight).toBeGreaterThanOrEqual(pal[i]!.weight);
    }
    for (const c of pal) {
      expect(c.oklch.l).toBeGreaterThanOrEqual(0);
      expect(c.oklch.l).toBeLessThanOrEqual(1);
      expect(c.oklch.c).toBeGreaterThanOrEqual(0);
      expect(c.oklch.h).toBeGreaterThanOrEqual(0);
      expect(c.oklch.h).toBeLessThan(360);
      expect(c.css.startsWith('oklch(')).toBe(true);
    }
  });

  it('finds both halves of a two-tone frame', () => {
    const pal = extractPalette(horizon().data, 120, 80, 5);
    expect(pal.length).toBeGreaterThanOrEqual(2);
    expect(pal[0]!.weight).toBeGreaterThan(0.35);
    expect(pal[0]!.weight).toBeLessThan(0.65);
  });

  it('collapses a single-colour frame to one swatch (no duplicate chips)', () => {
    const img = solid(40, 30, 120, 200, 90);
    const pal = extractPalette(img.data, img.width, img.height, 5);
    expect(pal).toHaveLength(1);
    expect(pal[0]!.weight).toBeCloseTo(1, 4);
  });

  it('returns nothing for an empty sample', () => {
    expect(extractPalette(new Uint8ClampedArray(0), 0, 0, 5)).toEqual([]);
  });
});

describe('analyzeImage', () => {
  it('reports dimensions, luminance and clipping', () => {
    const white = analyzeImage(solid(32, 24, 255, 255, 255));
    expect(white.width).toBe(32);
    expect(white.height).toBe(24);
    expect(white.meanLuma).toBeCloseTo(1, 4);
    expect(white.clippedHighlights).toBeGreaterThan(0.9);
    expect(white.clippedShadows).toBe(0);
    const black = analyzeImage(solid(32, 24, 0, 0, 0));
    expect(black.meanLuma).toBeCloseTo(0, 6);
    expect(black.clippedShadows).toBeGreaterThan(0.9);
    expect(black.clippedHighlights).toBe(0);
  });

  it('rewards mid-tones in the exposure score', () => {
    const mid = analyzeImage(solid(32, 24, 112, 112, 112));
    const blown = analyzeImage(solid(32, 24, 255, 255, 255));
    const black = analyzeImage(solid(32, 24, 0, 0, 0));
    expect(mid.exposureScore).toBeGreaterThan(blown.exposureScore);
    expect(mid.exposureScore).toBeGreaterThan(black.exposureScore);
    for (const f of [mid, blown, black]) {
      expect(f.exposureScore).toBeGreaterThanOrEqual(0);
      expect(f.exposureScore).toBeLessThanOrEqual(1);
    }
  });

  it('fills normalised 256-bin histograms for luma and RGB', () => {
    const f = analyzeImage(checker(64, 64));
    expect(f.lumaHistogram).toHaveLength(256);
    expect(f.rgbHistogram).toHaveLength(768);
    const total = (a: Float32Array) => a.reduce((t, v) => t + v, 0);
    expect(total(f.lumaHistogram)).toBeCloseTo(1, 4);
    // Each of the three channel planes is normalised on its own.
    expect(total(f.rgbHistogram.subarray(0, 256))).toBeCloseTo(1, 4);
    expect(total(f.rgbHistogram.subarray(256, 512))).toBeCloseTo(1, 4);
    expect(total(f.rgbHistogram.subarray(512, 768))).toBeCloseTo(1, 4);
    // A 1-px checkerboard only takes two values, so the luma bins are bimodal.
    expect(f.lumaHistogram.filter((v) => v > 0).length).toBeLessThanOrEqual(4);
  });

  it('separates detail from flat fields', () => {
    const sharp = analyzeImage(checker(64, 64, 1));
    const coarse = analyzeImage(checker(64, 64, 8));
    const flat = analyzeImage(solid(64, 64, 128, 128, 128));
    expect(sharp.sharpness).toBeGreaterThan(coarse.sharpness);
    expect(coarse.sharpness).toBeGreaterThan(flat.sharpness);
    expect(sharp.edgeDensity).toBeGreaterThan(flat.edgeDensity);
    expect(flat.sharpness).toBeLessThan(0.02);
    expect(sharp.blurScore).toBeLessThan(flat.blurScore);
    for (const f of [sharp, coarse, flat]) {
      expect(f.blurScore).toBeGreaterThanOrEqual(0);
      expect(f.blurScore).toBeLessThanOrEqual(1);
    }
  });

  it('flags a monochrome frame by saturation', () => {
    const mono = analyzeImage(checker(48, 48, 4));
    const colour = analyzeImage(horizon());
    expect(mono.saturationMean).toBeLessThan(0.02);
    expect(mono.isMonochrome).toBe(true);
    expect(colour.saturationMean).toBeGreaterThan(0.05);
    expect(colour.isMonochrome).toBe(false);
  });

  it('measures sky coverage, warmth and skin-free frames', () => {
    const f = analyzeImage(horizon());
    // Sky is only counted in the upper 55% of the frame, so it saturates there.
    expect(f.skyRatio).toBeGreaterThan(0.3);
    expect(f.skyRatio).toBeLessThanOrEqual(0.55);
    expect(f.warmCool).toBeLessThan(0); // blue sky over warm ground, sky-dominant
    expect(analyzeImage(solid(20, 20, 90, 90, 90)).skyRatio).toBe(0);
    expect(analyzeImage(solid(20, 20, 90, 90, 90)).greenRatio).toBe(0);
    expect(analyzeImage(solid(20, 20, 200, 90, 70)).warmCool).toBeGreaterThan(0);
  });

  it('exposes a 3×3 rule-of-thirds luminance grid', () => {
    const f = analyzeImage(horizon());
    expect(f.ruleOfThirds).toHaveLength(9);
    for (const v of f.ruleOfThirds) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Top row is sky (brighter), bottom row is ground.
    expect(f.ruleOfThirds[0]!).toBeGreaterThan(f.ruleOfThirds[6]!);
  });

  it('reads a level horizon as 0° and a leaning one as a rotation to undo', () => {
    const level = analyzeImage(horizon(120, 80, 0));
    expect(Math.abs(level.horizonTilt)).toBeLessThanOrEqual(5);
    const leaning = analyzeImage(horizon(120, 80, 0.35));
    expect(Number.isFinite(leaning.horizonTilt)).toBe(true);
    expect(Math.abs(leaning.horizonTilt)).toBeLessThanOrEqual(90);
    // atan(0.35) ≈ 19°; the estimator bins to 5°, so allow the quantisation.
    expect(Math.abs(leaning.horizonTilt)).toBeGreaterThan(5);
    expect(Math.abs(leaning.horizonTilt)).toBeLessThan(35);
    // Leaning the other way flips the sign, so Upright can undo either.
    const other = analyzeImage(horizon(120, 80, -0.35));
    expect(Math.sign(other.horizonTilt)).toBe(-Math.sign(leaning.horizonTilt));
    // Symmetric to within one 5° bin.
    expect(Math.abs(Math.abs(other.horizonTilt) - Math.abs(leaning.horizonTilt))).toBeLessThanOrEqual(5);
  });

  it('reports 0° rather than guessing when there is no dominant edge', () => {
    // Flat field, soft gradient and fine noise all lack a horizon.
    expect(analyzeImage(solid(120, 80, 128, 128, 128)).horizonTilt).toBe(0);
    const ramp = new Uint8ClampedArray(120 * 80 * 4);
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 120; x++) {
        const v = Math.round(60 + (y / 79) * 120); // smooth vertical ramp
        const p = (y * 120 + x) * 4;
        ramp[p] = ramp[p + 1] = ramp[p + 2] = v;
        ramp[p + 3] = 255;
      }
    expect(Math.abs(analyzeImage(new ImageData(ramp, 120, 80)).horizonTilt)).toBeLessThanOrEqual(5);
    expect(Math.abs(analyzeImage(checker(120, 80, 1)).horizonTilt)).toBeLessThanOrEqual(45);
  });

  it('produces stable 16-hex-digit perceptual hashes', () => {
    const a = analyzeImage(horizon());
    const b = analyzeImage(horizon());
    expect(a.dhash).toBe(b.dhash);
    expect(a.ahash).toBe(b.ahash);
    expect(a.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.ahash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.dhash).not.toBe(analyzeImage(checker(64, 64, 8)).dhash);
    expect(a.provider).toBe('heuristic');
  });
});

describe('computeSubjectMatte (placeholder for BiRefNet)', () => {
  it('returns a single-channel alpha map scaled to `size`', () => {
    const img = horizon(128, 96);
    const { alpha, width, height } = computeSubjectMatte(img, { size: 64 });
    expect(width).toBe(64);
    expect(height).toBe(48);
    expect(alpha).toBeInstanceOf(Uint8ClampedArray);
    expect(alpha.length).toBe(width * height);
    for (const v of alpha) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('keeps a centred subject and drops the frame border', () => {
    const { alpha, width, height } = computeSubjectMatte(subject(), { size: 64 });
    const centre = alpha[Math.floor(height / 2) * width + Math.floor(width / 2)]!;
    const corner = alpha[0]!;
    const edge = alpha[Math.floor(height / 2) * width]!;
    expect(centre).toBeGreaterThan(200);
    expect(corner).toBeLessThan(40);
    expect(centre).toBeGreaterThan(edge);
  });

  it('centrePrior concentrates the matte in the middle of the frame', () => {
    const img = horizon(96, 72);
    const shy = computeSubjectMatte(img, { size: 48, centrePrior: 0 });
    const keen = computeSubjectMatte(img, { size: 48, centrePrior: 1 });
    const centre = (m: typeof shy) => m.alpha[Math.floor(m.height / 2) * m.width + Math.floor(m.width / 2)]!;
    const mean = (m: typeof shy) => sum(m.alpha) / m.alpha.length;
    // Same subject, but the strong prior puts relatively more alpha in the middle.
    expect(centre(keen) / Math.max(1, mean(keen))).toBeGreaterThan(centre(shy) / Math.max(1, mean(shy)));
    expect(sum(keen.alpha)).toBeLessThan(sum(shy.alpha));
  });

  it('edgeShift erodes (positive) and dilates (negative)', () => {
    const img = subject(96, 96);
    const base = computeSubjectMatte(img, { size: 48, feather: 0, edgeShift: 0 });
    const eroded = computeSubjectMatte(img, { size: 48, feather: 0, edgeShift: 0.35 });
    const dilated = computeSubjectMatte(img, { size: 48, feather: 0, edgeShift: -0.35 });
    expect(sum(eroded.alpha)).toBeLessThan(sum(base.alpha));
    expect(sum(dilated.alpha)).toBeGreaterThan(sum(base.alpha));
  });

  it('feather softens the transition instead of hardening it', () => {
    const img = subject(96, 96);
    const crisp = computeSubjectMatte(img, { size: 48, feather: 0, edgeShift: 0 });
    const soft = computeSubjectMatte(img, { size: 48, feather: 0.9, edgeShift: 0 });
    expect(midTones(soft.alpha)).toBeGreaterThan(midTones(crisp.alpha));
    // The subject stays the subject: feathering softens the edge, it does not
    // erase the middle of the mask.
    const centre = (m: { alpha: Uint8ClampedArray; width: number; height: number }) =>
      m.alpha[Math.floor(m.height / 2) * m.width + Math.floor(m.width / 2)]!;
    expect(centre(soft)).toBeGreaterThan(128);
    expect(centre(crisp)).toBeGreaterThanOrEqual(centre(soft));
  });

  it('more smoothing iterations cannot invent alpha outside 0..255', () => {
    const a = computeSubjectMatte(subject(), { size: 40, iterations: 0 });
    const b = computeSubjectMatte(subject(), { size: 40, iterations: 12 });
    expect(a.alpha.length).toBe(b.alpha.length);
    for (const v of b.alpha) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('never throws on degenerate input', () => {
    expect(() => computeSubjectMatte(solid(1, 1, 0, 0, 0), { size: 256 })).not.toThrow();
    expect(() => computeSubjectMatte(checker(4, 4, 1), {})).not.toThrow();
    const tiny = computeSubjectMatte(solid(2, 2, 200, 200, 200), { size: 8 });
    expect(tiny.width).toBeGreaterThanOrEqual(8);
    expect(tiny.alpha.length).toBe(tiny.width * tiny.height);
  });
});
