/**
 * Color math for the Swell pipeline.
 *
 * Everything here is dependency-free and pure so it can run in the renderer,
 * in a worker, in the (future) Rust native addon tests, and in Vitest.
 *
 * Spaces used:
 *  - `srgb`      8-bit display values (0..1, gamma encoded)
 *  - `lrgb`      linear sRGB / Rec.709 primaries
 *  - `l2020`     linear Rec.2020 — the Swell **working space** (see docs/PIPELINE.md)
 *  - `lab`       CIE Lab (D65)
 *  - `oklab`     OKLab / OKLCH — used for hue curves, color-range masks, palettes
 */

export type RGB = { r: number; g: number; b: number };
export type OKLCH = { l: number; c: number; h: number };
export type Lab = { L: number; a: number; b: number };

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/* ------------------------------------------------------------------ srgb */

export function srgbToLinear(c: number): number {
  const a = Math.abs(c);
  const v = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return c < 0 ? -v : v;
}

export function linearToSrgb(c: number): number {
  const a = Math.abs(c);
  const v = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return c < 0 ? -v : v;
}

export const srgbToLinearRgb = ({ r, g, b }: RGB): RGB => ({
  r: srgbToLinear(r),
  g: srgbToLinear(g),
  b: srgbToLinear(b),
});

export const linearToSrgbRgb = ({ r, g, b }: RGB): RGB => ({
  r: linearToSrgb(r),
  g: linearToSrgb(g),
  b: linearToSrgb(b),
});

/* ------------------------------------------------------- 3x3 matrix math */

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function applyMat3(m: Mat3, { r, g, b }: RGB): RGB {
  return {
    r: m[0]! * r + m[1]! * g + m[2]! * b,
    g: m[3]! * r + m[4]! * g + m[5]! * b,
    b: m[6]! * r + m[7]! * g + m[8]! * b,
  };
}

/**
 * Exact 3×3 inverse. Used for the chromatic-adaptation pair in `spaces.ts` so
 * the two Bradford matrices cannot drift apart through rounding — a mismatch
 * there shows up as a soft-proof that never round-trips.
 */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return IDENTITY_MAT3;
  const inv = 1 / det;
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return o;
}

/** sRGB (D65) primaries → Rec.2020 (both linear). */
export const M_SRGB_TO_2020: Mat3 = [
  0.6274039, 0.329283, 0.0433131, 0.0690973, 0.9195404, 0.0113623, 0.0163914, 0.0880133,
  0.8955953,
];

/**
 * Rec.2020 → sRGB (both D65, linear). Out-of-gamut values are expected; gamut
 * map before display. Derived from the primaries (see `docs/PIPELINE.md`) and
 * asserted to be the exact inverse of `M_SRGB_TO_2020` in the colour tests —
 * a wrong white point here shows up as a cast over every photo.
 */
export const M_2020_TO_SRGB: Mat3 = [
  1.660491, -0.5876411, -0.0728499, -0.1245505, 1.1328999, -0.0083494, -0.0181508, -0.1005789,
  1.1187297,
];

/** Linear sRGB → CIE XYZ (D65). */
export const M_LRGB_TO_XYZ: Mat3 = [
  0.4123908, 0.3575843, 0.1804808, 0.212639, 0.7151687, 0.0721923, 0.0193308, 0.1191948,
  0.9505322,
];

export const M_XYZ_TO_LRGB: Mat3 = [
  3.2409699, -1.5373832, -0.4986108, -0.9692436, 1.8759675, 0.0415551, 0.0556301, -0.203977,
  1.0569715,
];

export const lrgbTo2020 = (c: RGB): RGB => applyMat3(M_SRGB_TO_2020, c);
export const l2020ToLrgb = (c: RGB): RGB => applyMat3(M_2020_TO_SRGB, c);

/* ------------------------------------------------------------------- Lab */

const Xn = 0.95047,
  Yn = 1.0,
  Zn = 1.08883;
const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : (903.2962962 * t + 16) / 116);
const fInv = (t: number) => (t > 0.2068965517 ? t * t * t : (116 * t - 16) / 903.2962962);

export function xyzToLab({ r: x, g: y, b: z }: RGB): Lab {
  const fx = f(x / Xn),
    fy = f(y / Yn),
    fz = f(z / Zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToXyz({ L, a, b }: Lab): RGB {
  const fy = (L + 16) / 116;
  return { r: Xn * fInv(fy + a / 500), g: Yn * fInv(fy), b: Zn * fInv(fy - b / 200) };
}

export const lrgbToLab = (c: RGB): Lab => xyzToLab(applyMat3(M_LRGB_TO_XYZ, c));
export const labToLrgb = (l: Lab): RGB => applyMat3(M_XYZ_TO_LRGB, labToXyz(l));

/** CIEDE2000 — used by golden-image tests (docs/STATUS.md). */
export function deltaE00(l1: Lab, l2: Lab): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  const avgL = (l1.L + l2.L) / 2;
  const c1 = Math.hypot(l1.a, l1.b),
    c2 = Math.hypot(l2.a, l2.b);
  const avgC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = l1.a * (1 + g),
    a2p = l2.a * (1 + g);
  const c1p = Math.hypot(a1p, l1.b),
    c2p = Math.hypot(a2p, l2.b);
  const avgCp = (c1p + c2p) / 2;
  let h1p = deg(Math.atan2(l1.b, a1p));
  if (h1p < 0) h1p += 360;
  let h2p = deg(Math.atan2(l2.b, a2p));
  if (h2p < 0) h2p += 360;
  const dLp = l2.L - l1.L;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2);
  let avgHp = h1p + h2p;
  if (c1p * c2p !== 0 && Math.abs(h1p - h2p) > 180) avgHp += 360;
  avgHp /= 2;
  const t =
    1 -
    0.17 * Math.cos(rad(avgHp - 30)) +
    0.24 * Math.cos(rad(2 * avgHp)) +
    0.32 * Math.cos(rad(3 * avgHp + 6)) -
    0.2 * Math.cos(rad(4 * avgHp - 63));
  const sl = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const sc = 1 + 0.045 * avgCp;
  const sh = 1 + 0.015 * avgCp * t;
  const rt =
    -2 *
    Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7))) *
    Math.sin(rad(60 * Math.exp(-Math.pow((avgHp - 275) / 25, 2))));
  return Math.sqrt(
    Math.pow(dLp / sl, 2) + Math.pow(dCp / sc, 2) + Math.pow(dHp / sh, 2) + rt * (dCp / sc) * (dHp / sh),
  );
}

/* ----------------------------------------------------------------- OKLab */

const M1: Mat3 = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566,
  0.0883024619, 0.2817188376, 0.6299787005,
];
const M2: Mat3 = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099,
  0.0259040371, 0.7827717662, -0.808675766,
];
/** LMS → linear sRGB (inverse of M1). */
const M1_INV: Mat3 = [
  4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.707614701,
];
/** OKLab → cube-root LMS (inverse of M2). */
const M2_INV: Mat3 = [
  1.0, 0.3963377774, 0.2158037573, 1.0, -0.1055613458, -0.0638541728, 1.0, -0.0894841775,
  -1.291485548,
];

export function lrgbToOklab(c: RGB): RGB {
  const lms = applyMat3(M1, c);
  const l_ = Math.cbrt(lms.r),
    m_ = Math.cbrt(lms.g),
    s_ = Math.cbrt(lms.b);
  return applyMat3(M2, { r: l_, g: m_, b: s_ });
}

export function oklabToLrgb(lab: RGB): RGB {
  const lms = applyMat3(M2_INV, { r: lab.r, g: lab.g, b: lab.b });
  return applyMat3(M1_INV, {
    r: lms.r * lms.r * lms.r,
    g: lms.g * lms.g * lms.g,
    b: lms.b * lms.b * lms.b,
  });
}

export function oklabToOklch({ r: L, g: a, b }: RGB): OKLCH {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToOklab({ l, c, h }: OKLCH): RGB {
  const rad = (h * Math.PI) / 180;
  return { r: l, g: c * Math.cos(rad), b: c * Math.sin(rad) };
}

export const lrgbToOklch = (c: RGB): OKLCH => oklabToOklch(lrgbToOklab(c));
export const oklchToLrgb = (o: OKLCH): RGB => oklabToLrgb(oklchToOklab(o));

/* ------------------------------------------------------------- CSS/OKLCH */

export function oklchToCss({ l, c, h }: OKLCH, alpha = 1): string {
  return alpha >= 1
    ? `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)})`
    : `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)} / ${alpha})`;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const q = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${q(r)}${q(g)}${q(b)}`;
}

/** Distance in OKLCH used by color-range masks and "search by color". */
export function oklchDistance(a: OKLCH, b: OKLCH): number {
  const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 180;
  return Math.hypot(a.l - b.l, a.c - b.c, dh * 0.9);
}

/**
 * Gamut map an OKLCH color into sRGB by reducing chroma until it fits.
 * Returns **linear** sRGB (the pipeline's convention); encode before display.
 * Binary search — cheap enough for UI swatches and mask colours, not per pixel.
 */
export function gamutMapToSrgb(o: OKLCH): RGB {
  let lo = 0,
    hi = o.c;
  let best = oklchToLrgb({ ...o, c: 0 });
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklchToLrgb({ ...o, c: mid });
    const linear = linearToSrgbRgb(rgb);
    if (
      linear.r >= -0.001 &&
      linear.r <= 1.001 &&
      linear.g >= -0.001 &&
      linear.g <= 1.001 &&
      linear.b >= -0.001 &&
      linear.b <= 1.001
    ) {
      best = rgb;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

/* -------------------------------------------------------------- palettes */

export const TEMP_TO_RGB = (kelvin: number): RGB => {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return { r: clamp(r, 0, 255) / 255, g: clamp(g, 0, 255) / 255, b: clamp(b, 0, 255) / 255 };
};

/** Named white-balance presets, in Kelvin + tint (green/magenta) offsets. */
export const WB_PRESETS = [
  { id: 'asShot', label: 'As Shot', temp: 0, tint: 0 },
  { id: 'auto', label: 'Auto', temp: 0, tint: 0 },
  { id: 'daylight', label: 'Daylight', temp: 5500, tint: 0 },
  { id: 'cloudy', label: 'Cloudy', temp: 6500, tint: 0 },
  { id: 'shade', label: 'Shade', temp: 7500, tint: 0 },
  { id: 'tungsten', label: 'Tungsten', temp: 3200, tint: 0 },
  { id: 'fluorescent', label: 'Fluorescent', temp: 4000, tint: 6 },
  { id: 'flash', label: 'Flash', temp: 5400, tint: 0 },
  { id: 'custom', label: 'Custom', temp: 5000, tint: 0 },
] as const;
