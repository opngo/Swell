/**
 * Curve → LUT compilation (CPU side).
 *
 * Every curve from Page 5 is compiled here into the `CurveLuts` payload the
 * engine uploads. Budget: < 0.2 ms per rebuild (§5.4); measured in
 * tests/curve.test.ts.
 */

import {
  buildLut,
  buildPeriodicLut,
  composeLuts,
  sampleParametric,
  type CurveInterpolation,
  type CurvePoint,
} from '@swell/shared';
import type { CurveLuts, DevelopParams } from '@swell/schema';

export const LUT_SIZE = 4096;
export const HUE_LUT_SIZE = 1024;

export function buildCurveLuts(
  params: Pick<DevelopParams, 'curves'>,
  size = LUT_SIZE,
  hueSize = HUE_LUT_SIZE,
): CurveLuts {
  const curves = params.curves;
  const interp: CurveInterpolation = curves.interpolation ?? 'monotone';
  const amount = curves.amount ?? 1;
  const identity = new Float32Array(size);
  for (let i = 0; i < size; i++) identity[i] = i / (size - 1);

  /* ---- luma: point curve ∘ parametric, both in the encoded domain ---- */
  const lumaPoint = curves.luma.length > 1 ? buildLut(curves.luma, size, interp) : identity;
  const p = curves.parametric;
  const hasParametric =
    p.highlights !== 0 || p.lights !== 0 || p.darks !== 0 || p.shadows !== 0;

  let luma = lumaPoint;
  if (hasParametric) {
    const pLut = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = i / (size - 1);
      pLut[i] = sampleParametric(x, {
        highlights: p.highlights,
        lights: p.lights,
        darks: p.darks,
        shadows: p.shadows,
        splits: p.splits,
      });
    }
    luma = lumaPoint === identity ? pLut : composeLuts(lumaPoint, pLut, size);
  }
  if (amount !== 1) {
    const out = new Float32Array(size);
    for (let i = 0; i < size; i++) out[i] = identity[i]! + (luma[i]! - identity[i]!) * amount;
    luma = out;
  }

  /* ---- per-channel RGB curves, packed into one RGB texel ---- */
  const rgb = new Float32Array(size * 3);
  const chans: Float32Array[] = [
    curves.r.length > 1 ? buildLut(curves.r, size, interp) : identity,
    curves.g.length > 1 ? buildLut(curves.g, size, interp) : identity,
    curves.b.length > 1 ? buildLut(curves.b, size, interp) : identity,
  ];
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < 3; k++) {
      rgb[i * 3 + k] = identity[i]! + (chans[k]![i]! - identity[i]!) * amount;
    }
  }

  /* ---- hue-indexed curves: deltas around 0 ---- */
  const hue = new Float32Array(hueSize * 4);
  const hh = buildPeriodicLut(curves.hueCurves.hh, hueSize);
  const hs = buildPeriodicLut(curves.hueCurves.hs, hueSize);
  const hl = buildPeriodicLut(curves.hueCurves.hl, hueSize);
  const ls = buildPeriodicLut(curves.hueCurves.ls, hueSize);
  const ss = buildPeriodicLut(curves.hueCurves.ss, hueSize);
  for (let i = 0; i < hueSize; i++) {
    hue[i * 4] = hh[i]! * amount;
    hue[i * 4 + 1] = hs[i]! * amount;
    hue[i * 4 + 2] = hl[i]! * amount;
    hue[i * 4 + 3] = ls[i]! * amount;
  }
  const hue2 = new Float32Array(hueSize);
  for (let i = 0; i < hueSize; i++) hue2[i] = ss[i]! * amount;

  return { luma, rgb, hue, hue2, hueSize, size, cube: null, cubeAmount: 1 };
}

/* --------------------------------------------------------------- queries */

export const hasLumaCurve = (params: DevelopParams): boolean => {
  const c = params.curves;
  const p = c.parametric;
  return (
    c.luma.length > 1 ||
    p.highlights !== 0 ||
    p.lights !== 0 ||
    p.darks !== 0 ||
    p.shadows !== 0
  );
};

export const hasRgbCurve = (params: DevelopParams): boolean => {
  const c = params.curves;
  return c.r.length > 1 || c.g.length > 1 || c.b.length > 1;
};

export const hasHueCurve = (params: DevelopParams): boolean => {
  const h = params.curves.hueCurves;
  return h.hh.length > 1 || h.hs.length > 1 || h.hl.length > 1 || h.ls.length > 1 || h.ss.length > 1;
};

/** Signature used to skip redundant LUT uploads (cache-by-hash, §6.2). */
export function lutsSignature(params: DevelopParams): string {
  const c = params.curves;
  return [
    c.amount,
    c.interpolation,
    JSON.stringify(c.luma),
    JSON.stringify(c.r),
    JSON.stringify(c.g),
    JSON.stringify(c.b),
    JSON.stringify(c.parametric),
    JSON.stringify(c.hueCurves),
    c.lockLuminosity ? 1 : 0,
  ].join('|');
}

/* --------------------------------------------------------- .cube LUTs */

export type CubeLut = { size: number; data: Uint8Array; title: string };

/**
 * Minimal .cube / .3dl parser (Adobe/Iridas cube format).
 * Supports LUT_1D_SIZE and LUT_3D_SIZE with float triplets.
 */
export function parseCube(text: string): CubeLut {
  const lines = text.split(/\r?\n/);
  let size = 0;
  let is3d = true;
  let title = '';
  const values: number[] = [];
  let domainMin = 0,
    domainMax = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.toUpperCase().startsWith('TITLE')) {
      title = line.replace(/^TITLE\s*/i, '').replace(/["']/g, '');
      continue;
    }
    const m3 = line.match(/^LUT_3D_SIZE\s+(\d+)/i);
    if (m3) {
      size = parseInt(m3[1]!, 10);
      is3d = true;
      continue;
    }
    const m1 = line.match(/^LUT_1D_SIZE\s+(\d+)/i);
    if (m1) {
      size = parseInt(m1[1]!, 10);
      is3d = false;
      continue;
    }
    const dm = line.match(/^DOMAIN_(MIN|MAX)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/i);
    if (dm) {
      if (dm[1]!.toUpperCase() === 'MIN') domainMin = parseFloat(dm[2]!);
      else domainMax = parseFloat(dm[2]!);
      continue;
    }
    const nums = line.split(/[\s,]+/).map(Number);
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) {
      values.push(nums[0]!, nums[1]!, nums[2]!);
    }
  }
  if (size === 0) size = Math.round(Math.cbrt(values.length / 3));
  if (size < 2) throw new Error('Not a valid .cube file (no LUT size)');
  const expected = is3d ? size * size * size : size;
  if (values.length < expected * 3) {
    throw new Error(`Truncated .cube: expected ${expected * 3} values, got ${values.length}`);
  }
  const scale = domainMax - domainMin || 1;
  const data = new Uint8Array(expected * 4);
  for (let i = 0; i < expected; i++) {
    const r = (values[i * 3]! - domainMin) / scale;
    const g = (values[i * 3 + 1]! - domainMin) / scale;
    const b = (values[i * 3 + 2]! - domainMin) / scale;
    data[i * 4] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    data[i * 4 + 3] = 255;
  }
  return { size, data, title: title || 'Imported LUT' };
}
