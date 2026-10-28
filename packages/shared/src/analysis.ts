/**
 * On-device image analysis (§8 Smart Detect).
 *
 * Everything here runs in a Worker on an `ImageData` downsample — no network,
 * no native deps. It produces the technical metrics Swell needs for culling
 * assists, duplicate detection, palettes and masks.
 *
 * Object/scene *recognition* in the shipped product comes from ONNX models
 * (packages/models). In the web runtime those models are unavailable, so this
 * module also provides a deterministic heuristic fallback; every result carries
 * a `provider` tag so the UI can be honest about where a label came from.
 */

import { clamp, clamp01, lrgbToOklab, oklabToOklch, oklchToCss, srgbToLinearRgb, type OKLCH } from './color.ts';
import { aHashFromGray, dHashFromGray, dHashToHex } from './hash.ts';

export type DetectionProvider = 'onnx' | 'heuristic' | 'metadata' | 'user';

export type PaletteColor = { oklch: OKLCH; css: string; weight: number };

export type ImageFeatures = {
  width: number;
  height: number;
  /** Rec.709 relative luminance, 0..1 */
  meanLuma: number;
  stdLuma: number;
  /** Fraction of pixels at/above 253 (0..1) */
  clippedHighlights: number;
  /** Fraction of pixels at/below 2 (0..1) */
  clippedShadows: number;
  contrast: number;
  /** Normalised variance of the Laplacian — higher is sharper */
  sharpness: number;
  /** 0..1, derived from sharpness relative to a reference */
  blurScore: number;
  skinRatio: number;
  skyRatio: number;
  greenRatio: number;
  /** −1 cool … +1 warm */
  warmCool: number;
  /** Dominant edge angle in degrees, −90..90 (horizon tilt) */
  horizonTilt: number;
  edgeDensity: number;
  saturationMean: number;
  isMonochrome: boolean;
  exposureScore: number;
  palette: PaletteColor[];
  lumaHistogram: Float32Array; // 256 bins, normalised
  rgbHistogram: Float32Array; // 3 × 256 bins, normalised
  dhash: string;
  ahash: string;
  /** Coarse third-by-third luminance grid, used by composition heuristics */
  ruleOfThirds: number[];
  provider: DetectionProvider;
};

const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function toGray(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luma709(data[p]! / 255, data[p + 1]! / 255, data[p + 2]! / 255);
  }
  return gray;
}

export function analyzeImage(img: ImageData): ImageFeatures {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const gray = toGray(img);

  let sum = 0,
    sumSq = 0,
    clipHi = 0,
    clipLo = 0,
    rSum = 0,
    gSum = 0,
    bSum = 0,
    satSum = 0,
    skin = 0,
    sky = 0,
    green = 0;
  const lumaHist = new Float32Array(256);
  const rgbHist = new Float32Array(768);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p]! / 255,
      g = data[p + 1]! / 255,
      b = data[p + 2]! / 255;
    const y = gray[i]!;
    sum += y;
    sumSq += y * y;
    if (data[p]! >= 253 && data[p + 1]! >= 253 && data[p + 2]! >= 253) clipHi++;
    if (data[p]! <= 2 && data[p + 1]! <= 2 && data[p + 2]! <= 2) clipLo++;
    rSum += r;
    gSum += g;
    bSum += b;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    satSum += sat;
    lumaHist[Math.min(255, Math.round(y * 255))]++;
    rgbHist[Math.min(255, data[p]!)]++;
    rgbHist[256 + Math.min(255, data[p + 1]!)]++;
    rgbHist[512 + Math.min(255, data[p + 2]!)]++;

    // skin tone: classic chromaticity test
    const R = data[p]!,
      G = data[p + 1]!,
      B = data[p + 2]!;
    if (R > 60 && G > 35 && B > 20 && R > G && R > B && Math.abs(R - G) > 12 && sat > 0.12) skin++;
    // sky: upper half, blue-dominant or bright & desaturated
    const yy = (i / w) | 0;
    if (yy < h * 0.55) {
      const bluish = B > R + 6 && B >= G - 8 && sat > 0.08;
      const brightFlat = y > 0.72 && sat < 0.18;
      if (bluish || brightFlat) sky++;
    }
    if (G > R + 8 && G > B + 8 && sat > 0.1) green++;
  }

  const meanLuma = sum / n;
  const variance = Math.max(0, sumSq / n - meanLuma * meanLuma);
  const stdLuma = Math.sqrt(variance);

  /* sharpness: variance of the 4-neighbour Laplacian */
  let lapSum = 0,
    lapSq = 0,
    lapCount = 0,
    edgeCount = 0;
  const stepX = Math.max(1, Math.round(w / 512));
  const stepY = Math.max(1, Math.round(h / 512));
  for (let y = 1; y < h - 1; y += stepY) {
    for (let x = 1; x < w - 1; x += stepX) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      lapCount++;
      if (Math.abs(lap) > 0.09) edgeCount++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const lapVar = Math.max(0, lapSq / Math.max(1, lapCount) - lapMean * lapMean);
  const sharpness = Math.sqrt(lapVar) * 100;
  const blurScore = clamp01(1 - sharpness / 26);
  const edgeDensity = edgeCount / Math.max(1, lapCount);

  /* horizon tilt: dominant gradient orientation, weighted by magnitude */
  const bins = new Float32Array(36);
  for (let y = 2; y < h - 2; y += stepY * 2) {
    for (let x = 2; x < w - 2; x += stepX * 2) {
      const i = y * w + x;
      const gx = gray[i + 1]! - gray[i - 1]!;
      const gy = gray[i + w]! - gray[i - w]!;
      const mag = Math.hypot(gx, gy);
      if (mag < 0.08) continue;
      let ang = (Math.atan2(gy, gx) * 180) / Math.PI + 90; // edge orientation
      ang = ((ang % 180) + 180) % 180;
      bins[Math.min(35, Math.floor(ang / 5))] += mag;
    }
  }
  let bestBin = 0,
    bestVal = -1,
    totalVal = 0;
  for (let i = 0; i < 36; i++) {
    totalVal += bins[i]!;
    if (bins[i]! > bestVal) ((bestVal = bins[i]!), (bestBin = i));
  }
  // bin 0 (edge orientation 0°) is a *level* horizon; orientations above 90°
  // wrap negative so the reading is the rotation Upright has to undo.
  const orientation = bestBin * 5;
  // Confidence gate: if no single 5° bin holds a real share of the gradient
  // energy there is no horizon to level, and guessing would rotate the photo.
  const confident = bestVal > 0 && totalVal > 0 && bestVal / totalVal > 0.15;
  const horizonTilt = confident ? clamp(orientation > 90 ? orientation - 180 : orientation, -90, 90) : 0;

  /* thirds grid */
  const ruleOfThirds = new Array<number>(9).fill(0);
  const thirdsCount = new Array<number>(9).fill(0);
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const cell = Math.min(2, Math.floor((y / h) * 3)) * 3 + Math.min(2, Math.floor((x / w) * 3));
      ruleOfThirds[cell] = (ruleOfThirds[cell] ?? 0) + gray[y * w + x]!;
      thirdsCount[cell]++;
    }
  }
  for (let i = 0; i < 9; i++) ruleOfThirds[i] = (ruleOfThirds[i] ?? 0) / Math.max(1, thirdsCount[i]!);

  const palette = extractPalette(data, w, h, 5);
  const meanR = rSum / n,
    meanG = gSum / n,
    meanB = bSum / n;
  const warmCool = clamp((meanR - meanB) * 2.2, -1, 1);
  const saturationMean = satSum / n;
  const isMonochrome = saturationMean < 0.06;

  /* Exposure score: reward mid-tones, punish clipping and extreme means. */
  const exposureScore = clamp01(
    1 -
      Math.abs(meanLuma - 0.44) * 1.5 -
      clipHi * 6 -
      clipLo * 6 -
      Math.max(0, 0.32 - stdLuma) * 0.8,
  );

  const norm = (arr: Float32Array) => {
    const s = arr.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / s;
    return arr;
  };
  norm(lumaHist);
  // Each channel plane is normalised on its own, so the three stay comparable.
  for (let plane = 0; plane < 3; plane++) norm(rgbHist.subarray(plane * 256, plane * 256 + 256));

  return {
    width: w,
    height: h,
    meanLuma,
    stdLuma,
    clippedHighlights: clipHi / n,
    clippedShadows: clipLo / n,
    contrast: stdLuma,
    sharpness,
    blurScore,
    skinRatio: skin / n,
    skyRatio: sky / n,
    greenRatio: green / n,
    warmCool,
    horizonTilt,
    edgeDensity,
    saturationMean,
    isMonochrome,
    exposureScore,
    palette,
    lumaHistogram: lumaHist,
    rgbHistogram: rgbHist,
    dhash: dHashToHex(dHashFromGray(gray, w, h)),
    ahash: dHashToHex(aHashFromGray(gray, w, h)),
    ruleOfThirds,
    provider: 'heuristic',
  };
}

/* ------------------------------------------------------------------ palette */

export function extractPalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  k = 5,
  sampleCap = 4000,
): PaletteColor[] {
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / sampleCap)));
  const pts: number[][] = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const p = (y * w + x) * 4;
      const lab = lrgbToOklab(srgbToLinearRgb({ r: data[p]! / 255, g: data[p + 1]! / 255, b: data[p + 2]! / 255 }));
      pts.push([lab.r, lab.g, lab.b]);
    }
  }
  if (pts.length === 0) return [];
  // k-means++-ish init: spread by distance from the mean
  const centroids: number[][] = [];
  centroids.push(pts[0]!.slice());
  while (centroids.length < k && centroids.length < pts.length) {
    let best = pts[0]!,
      bestD = -1;
    for (let i = 0; i < pts.length; i += 7) {
      const p = pts[i]!;
      let d = Infinity;
      for (const c of centroids) d = Math.min(d, dist2(p, c));
      if (d > bestD) ((bestD = d), (best = p));
    }
    centroids.push(best.slice());
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 10; iter++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let bi = 0,
        bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist2(pts[i]!, centroids[c]!);
        if (d < bd) ((bd = d), (bi = c));
      }
      assign[i] = bi;
      const s = sums[bi]!;
      s[0] += pts[i]![0]!;
      s[1] += pts[i]![1]!;
      s[2] += pts[i]![2]!;
      s[3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      const s = sums[c]!;
      if (s[3] > 0) centroids[c] = [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]];
    }
  }
  const counts = new Array<number>(centroids.length).fill(0);
  for (const a of assign) counts[a] = (counts[a] ?? 0) + 1;

  // A seed that never won a pixel is not a colour in the photo, and k-means can
  // park several seeds on the same colour — merge those so the swatch row (and
  // search-by-colour) never shows duplicates.
  const merged: { lab: number[]; oklch: OKLCH; weight: number }[] = [];
  for (let i = 0; i < centroids.length; i++) {
    const count = counts[i] ?? 0;
    if (count === 0) continue;
    const lab = centroids[i]!;
    const dupe = merged.find((m) => dist2(m.lab, lab) < 1e-4);
    if (dupe) {
      dupe.weight += count / pts.length;
      continue;
    }
    merged.push({
      lab,
      oklch: oklabToOklch({ r: lab[0]!, g: lab[1]!, b: lab[2]! }),
      weight: count / pts.length,
    });
  }
  return merged
    .map(({ oklch, weight }) => ({
      oklch,
      css: oklchToCss({ ...oklch, l: clamp01(oklch.l), c: Math.min(0.37, oklch.c) }),
      weight,
    }))
    .sort((a, b) => b.weight - a.weight);
}

const dist2 = (a: number[], b: number[]) => {
  const dr = a[0]! - b[0]!,
    dg = a[1]! - b[1]!,
    db = a[2]! - b[2]!;
  return dr * dr + dg * dg + db * db;
};

/* --------------------------------------------------- subject matte (bg cut) */

export type MatteOptions = {
  /** Long edge of the matte. The UI upscales with a guided filter. */
  size?: number;
  /** 0…1 — how strongly the centre is assumed to hold the subject. */
  centrePrior?: number;
  /** Extra erosion/dilation of the alpha, −1…1: positive erodes, negative dilates. */
  edgeShift?: number;
  /** 0…1 — how soft the alpha transition is. 0 = crisp, 1 = fully translucent. */
  feather?: number;
  iterations?: number;
};

/**
 * GrabCut-lite: border seeds = background, centre prior = foreground, two
 * Gaussians in OKLab, then smoothing + contrast stretch.
 *
 * This is the *placeholder* for BiRefNet/ViTMatte (see packages/models). It is
 * deterministic, fast (< 40 ms at 256 px) and good enough for well-separated
 * subjects, which is what the demo catalog contains.
 */
export function computeSubjectMatte(img: ImageData, opts: MatteOptions = {}): {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
} {
  const size = opts.size ?? 256;
  const scale = size / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const small = resizeImageData(img, w, h);
  const n = w * h;

  const lab = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const c = lrgbToOklab(
      srgbToLinearRgb({
        r: small.data[p]! / 255,
        g: small.data[p + 1]! / 255,
        b: small.data[p + 2]! / 255,
      }),
    );
    lab[i * 3] = c.r;
    lab[i * 3 + 1] = c.g;
    lab[i * 3 + 2] = c.b;
  }

  // Seeds
  const bg = [0, 0, 0],
    fg = [0, 0, 0];
  let bgN = 0,
    fgN = 0;
  const border = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isBorder = x < border || y < border || x >= w - border || y >= h - border;
      const isCentre =
        x > w * 0.3 && x < w * 0.7 && y > h * 0.28 && y < h * 0.8;
      if (isBorder) {
        bg[0] += lab[i * 3]!;
        bg[1] += lab[i * 3 + 1]!;
        bg[2] += lab[i * 3 + 2]!;
        bgN++;
      } else if (isCentre) {
        fg[0] += lab[i * 3]!;
        fg[1] += lab[i * 3 + 1]!;
        fg[2] += lab[i * 3 + 2]!;
        fgN++;
      }
    }
  }
  for (let k = 0; k < 3; k++) {
    bg[k] = bg[k]! / Math.max(1, bgN);
    fg[k] = fg[k]! / Math.max(1, fgN);
  }
  const bgVar = varianceAround(lab, bg, w, h, border, true);
  const fgVar = varianceAround(lab, fg, w, h, border, false);

  const centrePrior = opts.centrePrior ?? 0.55;
  const p = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dBg = weightedDist(lab, i, bg, bgVar);
      const dFg = weightedDist(lab, i, fg, fgVar);
      let prob = 1 / (1 + Math.exp((dFg - dBg) * 1.6));
      const cx = (x + 0.5) / w - 0.5,
        cy = (y + 0.5) / h - 0.5;
      const centre = clamp01(1 - Math.hypot(cx * 1.5, cy * 1.7) * 1.25);
      prob = clamp01(prob * (1 - centrePrior * 0.45) + centre * centrePrior * 0.45);
      p[i] = prob;
    }
  }

  const iterations = opts.iterations ?? 4;
  let cur = p;
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let s = cur[i]! * 4,
          c = 4;
        if (x > 0) ((s += cur[i - 1]! * 2), (c += 2));
        if (x < w - 1) ((s += cur[i + 1]! * 2), (c += 2));
        if (y > 0) ((s += cur[i - w]! * 2), (c += 2));
        if (y < h - 1) ((s += cur[i + w]! * 2), (c += 2));
        next[i] = s / c;
      }
    }
    cur = next;
  }

  // contrast stretch around the median
  const sorted = Float32Array.from(cur).sort();
  const lo = sorted[Math.floor(n * 0.05)] ?? 0;
  const hi = sorted[Math.floor(n * 0.95)] ?? 1;
  const span = Math.max(1e-3, hi - lo);
  const shift = opts.edgeShift ?? 0;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    let a = (cur[i]! - lo - shift * span * 0.35) / span;
    a = clamp01(a);
    // Feather pulls alpha toward 0.5, so a bigger value means a *softer* edge.
    const f = clamp01(opts.feather ?? 0.25);
    if (f > 0) a = clamp01((a - 0.5) * (1 - f) + 0.5);
    alpha[i] = Math.round(a * 255);
  }
  return { width: w, height: h, alpha };
}

function varianceAround(
  lab: Float32Array,
  mean: number[],
  w: number,
  h: number,
  border: number,
  outside: boolean,
): number {
  let s = 0,
    c = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const isBorder = x < border * 3 || y < border * 3 || x >= w - border * 3 || y >= h - border * 3;
      if (isBorder !== outside) continue;
      const i = y * w + x;
      s +=
        (lab[i * 3]! - mean[0]!) ** 2 +
        (lab[i * 3 + 1]! - mean[1]!) ** 2 +
        (lab[i * 3 + 2]! - mean[2]!) ** 2;
      c++;
    }
  }
  return Math.max(0.0008, s / Math.max(1, c));
}

function weightedDist(lab: Float32Array, i: number, mean: number[], v: number): number {
  const dr = lab[i * 3]! - mean[0]!,
    dg = lab[i * 3 + 1]! - mean[1]!,
    db = lab[i * 3 + 2]! - mean[2]!;
  return (dr * dr + dg * dg + db * db) / v;
}

/** Box downsample (area-ish) — good enough for analysis, keeps moiré down. */
export function resizeImageData(src: ImageData, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  const sx = src.width / w,
    sy = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx),
        y0 = Math.floor(y * sy);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)),
        y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        c = 0;
      for (let yy = y0; yy < y1; yy += Math.max(1, Math.floor((y1 - y0) / 4))) {
        for (let xx = x0; xx < x1; xx += Math.max(1, Math.floor((x1 - x0) / 4))) {
          const p = (yy * src.width + xx) * 4;
          r += src.data[p]!;
          g += src.data[p + 1]!;
          b += src.data[p + 2]!;
          a += src.data[p + 3]!;
          c++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / c;
      out.data[o + 1] = g / c;
      out.data[o + 2] = b / c;
      out.data[o + 3] = a / c;
    }
  }
  return out;
}
