/**
 * Curve math — the heart of Page 5 (Light Curves).
 *
 * Interpolation is **monotone cubic (Fritsch–Carlson)** by default: it never
 * overshoots, which is what photographers expect from a tone curve. `smooth`
 * (natural cubic spline) and `linear` (posterize / hard transfers) are also
 * available per channel.
 *
 * Every curve is compiled to a 1-D LUT (`Float32Array`) which the GPU samples
 * with a linear filter. See docs/PIPELINE.md §Curves for the encoding used.
 */

export type CurvePoint = { x: number; y: number };
export type CurveInterpolation = 'monotone' | 'smooth' | 'linear';

import { clamp, clamp01 } from './color.ts';
export { clamp as clampCurve, clamp01 as clamp01Curve };

/* ---------------------------------------------------------------------------
 * Perceptual encoding for the curve domain
 *
 * Curves are authored in a *display-referred perceptual* space so that shadow
 * and highlight edits feel balanced. The mapping is fixed, monotonic and
 * exactly invertible:
 *
 *     enc(y) = log2(1 + K·y) / log2(1 + K)        y ∈ [0, 1] → e ∈ [0, 1]
 *     dec(e) = (2^(e·log2(1+K)) − 1) / K
 *
 * with K = CURVE_K. The same functions are compiled into GLSL (packages/shaders).
 * ------------------------------------------------------------------------- */

export const CURVE_K = 12;
const LOG2_1PK = Math.log2(1 + CURVE_K);

export const encodePerceptual = (y: number): number => Math.log2(1 + CURVE_K * clamp(y, 0, 4)) / LOG2_1PK;
export const decodePerceptual = (e: number): number => (Math.pow(2, clamp01(e) * LOG2_1PK) - 1) / CURVE_K;

/* ---------------------------------------------------------------------------
 * Sorting / normalisation
 * ------------------------------------------------------------------------- */

export function normalizePoints(pts: CurvePoint[]): CurvePoint[] {
  const clean = pts
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp01(p.x), y: clamp(p.y, -0.5, 1.5) }));
  clean.sort((a, b) => a.x - b.x);
  // Drop duplicates on x (keep the last one — matches "drag past another point").
  const out: CurvePoint[] = [];
  for (const p of clean) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-5) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Fritsch–Carlson monotone cubic
 * ------------------------------------------------------------------------- */

export function monotoneTangents(pts: CurvePoint[]): number[] {
  const n = pts.length;
  const m = new Array<number>(n).fill(0);
  if (n === 0) return m;
  if (n === 1) {
    m[0] = 0;
    return m;
  }
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.x - pts[i]!.x;
    d.push(dx === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / dx);
  }
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1]!,
      b = d[i]!;
    if (a * b <= 0) m[i] = 0;
    else m[i] = (a + b) / 2;
  }
  // Fritsch–Carlson limiters: keep the interpolant monotone on each interval.
  for (let i = 0; i < n - 1; i++) {
    const s = d[i]!;
    if (s === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i]! / s;
    const beta = m[i + 1]! / s;
    const mag = Math.hypot(alpha, beta);
    if (mag > 3) {
      const t = 3 / mag;
      m[i] = t * alpha * s;
      m[i + 1] = t * beta * s;
    }
  }
  return m;
}

function hermite(p0: CurvePoint, p1: CurvePoint, m0: number, m1: number, x: number): number {
  const h = p1.x - p0.x;
  if (h <= 0) return p1.y;
  const t = (x - p0.x) / h;
  const t2 = t * t,
    t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0.y + h10 * h * m0 + h01 * p1.y + h11 * h * m1;
}

/** Natural cubic spline tangents (used by the `smooth` interpolation mode). */
export function naturalSplineTangents(pts: CurvePoint[]): number[] {
  const n = pts.length;
  if (n < 3) return monotoneTangents(pts);
  // Solve the tridiagonal system for the second derivatives, then convert.
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) h.push(pts[i + 1]!.x - pts[i]!.x || 1e-6);
  b[0] = 1;
  b[n - 1] = 1;
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i - 1]!;
    b[i] = 2 * (h[i - 1]! + h[i]!);
    c[i] = h[i]!;
    d[i] = 3 * ((pts[i + 1]!.y - pts[i]!.y) / h[i]! - (pts[i]!.y - pts[i - 1]!.y) / h[i - 1]!);
  }
  // Thomas algorithm
  for (let i = 1; i < n; i++) {
    const w = a[i] / (b[i - 1] || 1e-9);
    b[i] -= w * c[i - 1]!;
    d[i] -= w * d[i - 1]!;
  }
  const m2 = new Array<number>(n).fill(0); // second derivatives
  m2[n - 1] = d[n - 1]! / (b[n - 1] || 1e-9);
  for (let i = n - 2; i >= 0; i--) m2[i] = (d[i]! - c[i]! * m2[i + 1]!) / (b[i] || 1e-9);
  const tangents = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    tangents[i] =
      (pts[i + 1]!.y - pts[i]!.y) / h[i]! - (h[i]! * (m2[i + 1]! + 2 * m2[i]!)) / 3;
  }
  tangents[n - 1] =
    (pts[n - 1]!.y - pts[n - 2]!.y) / h[n - 2]! - (h[n - 2]! * (2 * m2[n - 1]! + m2[n - 2]!)) / 3;
  return tangents;
}

/** Evaluate a curve at `x` (endpoints are clamped, not extrapolated). */
export function sampleCurve(points: CurvePoint[], x: number, interp: CurveInterpolation = 'monotone'): number {
  const pts = normalizePoints(points);
  if (pts.length === 0) return clamp01(x);
  if (pts.length === 1) return clamp01(pts[0]!.y);
  if (x <= pts[0]!.x) return pts[0]!.y;
  const last = pts[pts.length - 1]!;
  if (x >= last.x) return last.y;
  // binary search for the interval
  let lo = 0,
    hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.x <= x) lo = mid;
    else hi = mid;
  }
  const p0 = pts[lo]!,
    p1 = pts[hi]!;
  if (interp === 'linear') {
    const t = (x - p0.x) / (p1.x - p0.x || 1e-6);
    return p0.y + t * (p1.y - p0.y);
  }
  const m = interp === 'smooth' ? naturalSplineTangents(pts) : monotoneTangents(pts);
  return hermite(p0, p1, m[lo]!, m[hi]!, x);
}

/**
 * Compile a curve to a LUT of `size` entries over the domain [0, 1].
 * An empty/degenerate curve returns the identity ramp.
 */
export function buildLut(
  points: CurvePoint[],
  size = 4096,
  interp: CurveInterpolation = 'monotone',
): Float32Array {
  const lut = new Float32Array(size);
  const pts = normalizePoints(points);
  if (pts.length < 2) {
    for (let i = 0; i < size; i++) lut[i] = i / (size - 1);
    return lut;
  }
  const m = interp === 'linear' ? null : interp === 'smooth' ? naturalSplineTangents(pts) : monotoneTangents(pts);
  let seg = 0;
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    while (seg < pts.length - 2 && x > pts[seg + 1]!.x) seg++;
    const p0 = pts[seg]!,
      p1 = pts[seg + 1]!;
    let y: number;
    if (x <= p0.x) y = p0.y;
    else if (x >= pts[pts.length - 1]!.x) y = pts[pts.length - 1]!.y;
    else if (interp === 'linear') {
      const t = (x - p0.x) / (p1.x - p0.x || 1e-6);
      y = p0.y + t * (p1.y - p0.y);
    } else y = hermite(p0, p1, m![seg]!, m![seg + 1]!, x);
    lut[i] = y;
  }
  return lut;
}

/* ---------------------------------------------------------------------------
 * Periodic curves (hue-indexed: H↔H, H↔S, H↔L, L↔S, S↔S)
 *
 * Output is a **delta** around 0 (identity). For H↔H the shader adds it to the
 * OKLCH hue; for the others it is used as `1 + delta` multiplier.
 * ------------------------------------------------------------------------- */

const DEFAULT_PERIODIC_PTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
];

/** Periodic Catmull-Rom through wrapped control points. */
export function samplePeriodic(points: CurvePoint[], x: number): number {
  const pts = points.length >= 2 ? normalizePoints(points) : DEFAULT_PERIODIC_PTS;
  const wrap = (i: number) => pts[((i % pts.length) + pts.length) % pts.length]!;
  const t = ((x % 1) + 1) % 1;
  // find segment
  let seg = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    if (t >= pts[i]!.x && (i === pts.length - 1 || t < pts[i + 1]!.x)) {
      seg = i;
      break;
    }
  }
  const p1 = wrap(seg),
    p2 = wrap(seg + 1);
  const p0 = wrap(seg - 1),
    p3 = wrap(seg + 2);
  let span = p2.x - p1.x;
  if (span <= 0) span += 1;
  let local = t - p1.x;
  if (local < 0) local += 1;
  const u = clamp(local / span, 0, 1);
  // tangents from central differences on the wrapped ring
  const d1 = (p2.y - p0.y) / 2;
  const d2 = (p3.y - p1.y) / 2;
  const u2 = u * u,
    u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p1.y + (u3 - 2 * u2 + u) * d1 + (-2 * u3 + 3 * u2) * p2.y + (u3 - u2) * d2
  );
}

export function buildPeriodicLut(points: CurvePoint[], size = 1024): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = samplePeriodic(points, i / size);
  return lut;
}

/* ---------------------------------------------------------------------------
 * Parametric curve (4 regions + 3 draggable split points)
 * ------------------------------------------------------------------------- */

export type ParametricCurve = {
  highlights: number; // −100 … +100
  lights: number;
  darks: number;
  shadows: number;
  splits: [number, number, number]; // 0…100, ascending
};

export const DEFAULT_PARAMETRIC: ParametricCurve = {
  highlights: 0,
  lights: 0,
  darks: 0,
  shadows: 0,
  splits: [25, 50, 75],
};

/**
 * Region weights for the four parametric bands.
 *
 * The three split handles define four regions; each boundary is a raised-cosine
 * transition whose half-width reaches halfway to the neighbouring split, so the
 * bands overlap instead of meeting at a point. The four weights form a partition
 * of unity — they always sum to exactly 1 — which means (a) there is no dead
 * zone where a slider does nothing, and (b) pushing every band by the same
 * amount is a no-op rather than a 4× edit.
 */
export function parametricWeights(x: number, splits: [number, number, number]) {
  const [s1, s2, s3] = splits.map((s) => clamp01(s / 100)) as [number, number, number];
  const cx = clamp01(x);

  /** Raised-cosine step centred on `c`, reaching `halfWidth` either side. */
  const step = (c: number, halfWidth: number) => {
    if (halfWidth <= 1e-4) return cx < c ? 0 : 1;
    const t = clamp01((cx - (c - halfWidth)) / (2 * halfWidth));
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  };

  const t1 = step(s1, Math.max(1e-4, s2 * 0.5));
  const t2 = step(s2, Math.max(1e-4, (s3 - s1) * 0.5));
  const t3 = step(s3, Math.max(1e-4, (1 - s2) * 0.5));

  // Widely spaced splits can make a transition overtake its neighbour; clamp the
  // band to zero and renormalise so the four still sum to 1.
  const raw = {
    shadows: Math.max(0, 1 - t1),
    darks: Math.max(0, t1 - t2),
    lights: Math.max(0, t2 - t3),
    highlights: Math.max(0, t3),
  };
  const total = raw.shadows + raw.darks + raw.lights + raw.highlights;
  if (total <= 1e-9) return { shadows: 0, darks: 0, lights: 0, highlights: 0 };
  return {
    shadows: raw.shadows / total,
    darks: raw.darks / total,
    lights: raw.lights / total,
    highlights: raw.highlights / total,
  };
}

export function sampleParametric(x: number, p: ParametricCurve = DEFAULT_PARAMETRIC): number {
  const w = parametricWeights(clamp01(x), p.splits);
  // Positive amounts push toward white (headroom = 1 − x), negative toward black.
  const push = (amount: number, weight: number) => {
    if (amount === 0 || weight === 0) return 0;
    const a = amount / 100;
    const headroom = a > 0 ? 1 - x : x;
    return a * weight * headroom * 0.9;
  };
  const dy =
    push(p.shadows, w.shadows) +
    push(p.darks, w.darks) +
    push(p.lights, w.lights) +
    push(p.highlights, w.highlights);
  return clamp01(x + dy);
}

export function buildParametricLut(p: ParametricCurve, size = 4096): Float32Array {
  const lut = new Float32Array(size);
  const identity =
    p.highlights === 0 && p.lights === 0 && p.darks === 0 && p.shadows === 0;
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    lut[i] = identity ? x : sampleParametric(x, p);
  }
  return lut;
}

/** Compose two LUTs: `out[i] = b[a[i]]` (both in the same encoded domain). */
export function composeLuts(a: Float32Array, b: Float32Array, size = 4096): Float32Array {
  const out = new Float32Array(size);
  const scale = (b.length - 1) / 1;
  for (let i = 0; i < size; i++) {
    const av = a[Math.round((i / (size - 1)) * (a.length - 1))] ?? i / (size - 1);
    const idx = clamp(av, 0, 1) * scale;
    const i0 = Math.floor(idx),
      i1 = Math.min(b.length - 1, i0 + 1);
    out[i] = (b[i0] ?? 0) * (1 - (idx - i0)) + (b[i1] ?? 0) * (idx - i0);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Curve presets (Page 5, §5.1). Values are in the perceptual curve domain.
 * ------------------------------------------------------------------------- */

export type CurvePreset = { id: string; label: string; points: CurvePoint[] };

export const CURVE_PRESETS: CurvePreset[] = [
  { id: 'linear', label: 'Linear', points: [] },
  {
    id: 'medium-contrast',
    label: 'Medium Contrast',
    points: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.22 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.78 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'strong-contrast',
    label: 'Strong Contrast',
    points: [
      { x: 0, y: 0 },
      { x: 0.22, y: 0.14 },
      { x: 0.5, y: 0.5 },
      { x: 0.78, y: 0.87 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'lighten-shadows',
    label: 'Lighten Shadows',
    points: [
      { x: 0, y: 0.07 },
      { x: 0.25, y: 0.3 },
      { x: 0.6, y: 0.62 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'matte-fade',
    label: 'Matte Fade',
    points: [
      { x: 0, y: 0.11 },
      { x: 0.32, y: 0.34 },
      { x: 0.68, y: 0.68 },
      { x: 1, y: 0.93 },
    ],
  },
  {
    id: 's-curve',
    label: 'S-Curve',
    points: [
      { x: 0, y: 0 },
      { x: 0.18, y: 0.12 },
      { x: 0.42, y: 0.4 },
      { x: 0.62, y: 0.66 },
      { x: 0.85, y: 0.9 },
      { x: 1, y: 1 },
    ],
  },
  {
    id: 'film-toe',
    label: 'Film Toe',
    points: [
      { x: 0, y: 0.02 },
      { x: 0.12, y: 0.13 },
      { x: 0.38, y: 0.41 },
      { x: 0.72, y: 0.74 },
      { x: 0.92, y: 0.95 },
      { x: 1, y: 0.99 },
    ],
  },
  {
    id: 'cross-process',
    label: 'Cross Process',
    points: [
      { x: 0, y: 0.05 },
      { x: 0.3, y: 0.24 },
      { x: 0.55, y: 0.58 },
      { x: 0.8, y: 0.86 },
      { x: 1, y: 0.97 },
    ],
  },
  {
    id: 'faded-black',
    label: 'Faded Black',
    points: [
      { x: 0, y: 0.14 },
      { x: 0.4, y: 0.42 },
      { x: 1, y: 1 },
    ],
  },
];

export const INVERT_CURVE = (pts: CurvePoint[]): CurvePoint[] =>
  pts.map((p) => ({ x: p.x, y: clamp01(1 - p.y) }));

/** Mirror a channel curve horizontally (used by the "mirror R↔B" power tool). */
export const MIRROR_CURVE = (pts: CurvePoint[]): CurvePoint[] =>
  pts.map((p) => ({ x: clamp01(1 - p.x), y: p.y }));

/** Blend a curve with the identity ramp by `amount` (0…1) — preset strength. */
export function blendCurveWithLinear(pts: CurvePoint[], amount: number, size = 4096): Float32Array {
  const a = clamp(amount, 0, 2);
  if (a === 1) return buildLut(pts, size);
  const base = buildLut(pts, size);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const id = i / (size - 1);
    out[i] = id + (base[i]! - id) * a;
  }
  return out;
}
