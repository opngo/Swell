/**
 * DevelopParams → GLSL uniforms.
 *
 * Everything the GPU needs is derived here on the CPU: white-balance gains,
 * calibration primaries, the geometry homography, layer arrays and mask draw
 * descriptors. Keeping this pure makes it unit-testable without a GL context.
 */

import {
  IDENTITY,
  TEMP_TO_RGB,
  clamp,
  clamp01,
  from2020,
  hexToRgb,
  lrgbTo2020,
  mulMat3,
  spaceToSrgb,
  srgbToLinearRgb,
  toGlMat3,
  type ColorSpaceId,
  type Mat3,
} from '@swell/shared';
import type { DevelopParams, Layer, Mask, OverlayState } from '@swell/schema';
import { MAX_LAYERS } from '@swell/shaders';

export type PackContext = {
  /** Detected horizon tilt in degrees, used by Upright = Level/Auto. */
  horizonTilt?: number;
  proofSpace?: ColorSpaceId;
  exportSpace?: ColorSpaceId;
};

/* ------------------------------------------------------------ white balance */

export function wbGain(temp: number, tint: number): Float32Array {
  const base = TEMP_TO_RGB(6500);
  const cur = TEMP_TO_RGB(temp);
  // `temp` names the *illuminant*, so the correction is its reciprocal: a warm
  // 3200 K light needs blue gain, a cool 12000 K light needs red. That is the
  // convention the Temp slider's blue→yellow track and the WB presets (Tungsten
  // cools, Shade warms) already promise.
  const g = [base.r / Math.max(cur.r, 1e-3), base.g / Math.max(cur.g, 1e-3), base.b / Math.max(cur.b, 1e-3)];
  // normalise so white balance does not change exposure
  const luma = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  const k = 1 / Math.max(luma, 1e-4);
  const t = clamp(tint / 150, -1, 1);
  return new Float32Array([
    clamp(g[0] * k * (1 + t * 0.18), 0.2, 4),
    clamp(g[1] * k * (1 - t * 0.34), 0.2, 4),
    clamp(g[2] * k * (1 + t * 0.18), 0.2, 4),
  ]);
}

/** Gains that neutralise a sampled pixel (WB eyedropper). */
export function wbGainFromSample(r: number, g: number, b: number): { temp: number; tint: number } {
  const lin = srgbToLinearRgb({ r, g, b });
  const y = 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
  const gains = [y / Math.max(lin.r, 1e-4), y / Math.max(lin.g, 1e-4), y / Math.max(lin.b, 1e-4)];
  // search the Kelvin ramp for the closest match (coarse but stable)
  let best = 5500,
    bestErr = Infinity;
  for (let k = 2000; k <= 12000; k += 100) {
    const c = TEMP_TO_RGB(k);
    const base = TEMP_TO_RGB(6500);
    // Same reciprocal convention as wbGain(), so the picked temp renders neutral.
    const gr = [base.r / c.r, base.g / c.g, base.b / c.b];
    const l = 0.2126 * gr[0] + 0.7152 * gr[1] + 0.0722 * gr[2];
    const gn = [gr[0] / l, gr[1] / l, gr[2] / l];
    // neutralising gains are the inverse of the illuminant gains
    const err =
      Math.log(gn[0] / gains[0]) ** 2 + Math.log(gn[1] / gains[1]) ** 2 + Math.log(gn[2] / gains[2]) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = k;
    }
  }
  const c = TEMP_TO_RGB(best);
  const base = TEMP_TO_RGB(6500);
  const gr = [base.r / c.r, base.g / c.g, base.b / c.b];
  const l = 0.2126 * gr[0] + 0.7152 * gr[1] + 0.0722 * gr[2];
  const gn = [gr[0] / l, gr[1] / l, gr[2] / l];
  // What the Kelvin ramp could not explain, expressed as green-vs-red residual.
  // Below 1 means green needs less gain than red → the cast is green → correct
  // toward magenta (positive tint, matching the slider's green→magenta track).
  const residual = gains[1] / gn[1] / Math.max(gains[0] / gn[0], 1e-4);
  const tint = clamp((residual - 1) * -190, -150, 150);
  return { temp: best, tint };
}

/* ------------------------------------------------------------- calibration */

export function calibrationMatrix(c: DevelopParams['calibration']): Float32Array {
  const s = (v: number) => v / 100;
  const rh = s(c.red.hue) * 0.32,
    rs = 1 + s(c.red.sat) * 0.55;
  const gh = s(c.green.hue) * 0.32,
    gs = 1 + s(c.green.sat) * 0.55;
  const bh = s(c.blue.hue) * 0.32,
    bs = 1 + s(c.blue.sat) * 0.55;
  const st = s(c.shadowsTint) * 0.12;
  // columns are the modified primaries
  const m: Mat3 = [
    rs, gh * 0.28 * gs, bh * -0.22 * bs,
    rh * -0.3 * rs, gs, bh * 0.24 * bs,
    rh * 0.3 * rs, gh * -0.28 * gs, bs,
  ];
  // shadows tint nudges magenta/green in the low end — folded as a diagonal bias
  m[0] += st * 0.5;
  m[4] -= st * 0.7;
  m[8] += st * 0.5;
  return toGlMat3(m);
}

/* ---------------------------------------------------------------- geometry */

/**
 * Homography applied to normalised UVs before sampling:
 *   T(offset) · R(rotate) · S(scale, aspect) · P(perspective)
 */
export function geometryMatrix(
  g: DevelopParams['geometry'],
  ctx: PackContext = {},
): Float32Array {
  const upright = g.upright;
  // crop angle is handled by the output pass; this is the manual/geometric rotate only
  let rotate = (g.rotate * Math.PI) / 180;
  let kx = (g.horizontal / 100) * 0.65;
  let ky = (g.vertical / 100) * 0.65;

  const tilt = ((ctx.horizonTilt ?? 0) * Math.PI) / 180;
  if (upright === 'level' || upright === 'auto' || upright === 'full') rotate -= tilt;
  if (upright === 'vertical' || upright === 'auto' || upright === 'full') ky += 0.32;
  if (upright === 'full') kx += 0.16;
  if (upright === 'guided' && g.guidedLines.length >= 2) {
    const guided = guidedUpright(g.guidedLines);
    rotate -= guided.rotate;
    ky += guided.ky;
    kx += guided.kx;
  }

  const scale = (g.scale / 100) * 1.0;
  const aspect = g.aspect / 100;
  const sx = scale * aspect;
  const sy = scale / Math.max(aspect, 1e-3);
  const tx = (g.xOffset / 100) * 0.5;
  const ty = (g.yOffset / 100) * 0.5;

  const cs = Math.cos(rotate),
    sn = Math.sin(rotate);
  // Row-major, applied as M·(uv − 0.5, 1). The perspective terms live in the
  // third ROW (that is what makes w' = 1 + kx·x + ky·y) and the pan lives in the
  // third COLUMN — swapping them turns Offset into a keystone and Vertical into
  // a shift.
  const P: Mat3 = [1, 0, 0, 0, 1, 0, kx, ky, 1];
  const S: Mat3 = [sx, 0, 0, 0, sy, 0, 0, 0, 1];
  const R: Mat3 = [cs, sn, 0, -sn, cs, 0, 0, 0, 1];
  const T: Mat3 = [1, 0, tx, 0, 1, ty, 0, 0, 1];
  // T(offset) · R(rotate) · S(scale, aspect) · P(perspective)
  return toGlMat3(mulMat3(T, mulMat3(R, mulMat3(S, P))));
}

/** Re-exported so the engine and the UI share one implementation. */
export { guidedUpright } from '@swell/shared';
import { guidedUpright } from '@swell/shared';

/* ------------------------------------------------------------ soft proofing */

export function proofMatrices(proofSpace: ColorSpaceId | undefined, enabled: boolean) {
  if (!enabled || !proofSpace) {
    return {
      proof: toGlMat3(IDENTITY),
      display: toGlMat3(from2020('srgb')),
    };
  }
  // develop writes into the proof space; the output pass converts proof → display
  return {
    proof: toGlMat3(from2020(proofSpace)),
    display: toGlMat3(spaceToSrgb(proofSpace)),
  };
}

/* ------------------------------------------------------------------ layers */

export type MaskDraw = {
  slot: number;
  kind: number;
  maskA: Float32Array;
  maskB: Float32Array;
  maskC: Float32Array;
  range: Float32Array;
  matteMode: number;
  needsMatte: boolean;
  add: Float32Array; // vec4[48]
  addCount: number;
  sub: Float32Array; // vec4[16]
  subCount: number;
  flow: number;
};

const MASK_KIND_INDEX: Record<string, number> = {
  brush: 6,
  linear: 1,
  radial: 2,
  luminance: 3,
  color: 4,
  matte: 5,
  subject: 5,
  sky: 5,
  background: 5,
  depth: 7,
  people: 5,
  object: 5,
};

const BLEND_INDEX: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  softLight: 4,
  hardLight: 5,
  colorDodge: 6,
  colorBurn: 7,
  darken: 8,
  lighten: 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
  add: 16,
};

/** Flatten strokes + their vector paths into circles for the mask shader. */
export function strokeCircles(masks: Mask[], maxAdd = 48, maxSub = 16) {
  const add = new Float32Array(maxAdd * 4);
  const sub = new Float32Array(maxSub * 4);
  let an = 0,
    sn = 0;
  let flow = 1;
  for (const m of masks) {
    if (m.kind !== 'brush') continue;
    flow = (m.brush.flow / 100) * (m.amount / 100);
    const feather = m.brush.feather / 100;
    for (const s of m.strokes) {
      const pts = s.path.length >= 2 ? s.path : ([[s.x, s.y]] as [number, number][]);
      const erase = m.brush.erase;
      for (const [px, py] of pts) {
        const target = erase ? sub : add;
        const count = erase ? sn : an;
        const max = erase ? maxSub : maxAdd;
        if (count >= max) continue;
        target[count * 4] = px;
        target[count * 4 + 1] = py;
        target[count * 4 + 2] = Math.max(0.004, s.r);
        target[count * 4 + 3] = clamp01(s.feather ?? feather);
        if (erase) sn++;
        else an++;
      }
    }
  }
  return { add, addCount: an, sub, subCount: sn, flow };
}

export type PackedLayers = {
  count: number;
  layers: Layer[];
  op: Float32Array; // vec4 × MAX_LAYERS
  adjA: Float32Array;
  adjB: Float32Array;
  adjC: Float32Array;
  adjD: Float32Array;
  fill: Float32Array;
  fill2: Float32Array;
  img: Float32Array; // vec4 × 2
  img2: Float32Array;
  maskDraws: MaskDraw[];
  imageSlots: (Layer | null)[];
};

/**
 * Compact the stack to the ≤ MAX_LAYERS slots the GPU can address, bottom → top.
 * Hidden layers are dropped; groups contribute their opacity to children.
 */
export function packLayers(params: DevelopParams, aspect: number): PackedLayers {
  const ordered: { layer: Layer; opacity: number; blend: string }[] = [];

  const walk = (list: Layer[], inheritedOpacity: number, inheritedBlend: string) => {
    for (const l of list) {
      if (!l.visible) continue;
      const op = (l.opacity / 100) * inheritedOpacity;
      const blend = l.kind === 'group' ? inheritedBlend : l.blend;
      if (l.kind === 'group') {
        const children = params.layers.filter((c) => c.parentId === l.id);
        if (children.length) walk(children, op, blend);
        else ordered.push({ layer: l, opacity: op, blend });
        continue;
      }
      ordered.push({ layer: l, opacity: op, blend });
    }
  };
  walk(
    params.layers.filter((l) => !l.parentId),
    1,
    'normal',
  );

  const solo = ordered.find((o) => o.layer.solo);
  const list = solo ? ordered.filter((o) => o.layer.solo) : ordered;

  const out: PackedLayers = {
    count: Math.min(list.length, MAX_LAYERS),
    layers: [],
    op: new Float32Array(MAX_LAYERS * 4),
    adjA: new Float32Array(MAX_LAYERS * 4),
    adjB: new Float32Array(MAX_LAYERS * 4),
    adjC: new Float32Array(MAX_LAYERS * 4),
    adjD: new Float32Array(MAX_LAYERS * 4),
    fill: new Float32Array(MAX_LAYERS * 4),
    fill2: new Float32Array(MAX_LAYERS * 4),
    img: new Float32Array(8),
    img2: new Float32Array(8),
    maskDraws: [],
    imageSlots: [null, null],
  };

  let imgSlot = 0;
  for (let i = 0; i < out.count; i++) {
    const entry = list[i]!;
    const l = entry.layer;
    out.layers.push(l);
    const a = l.adjust;
    let kind = 0; // adjustment
    if (l.kind === 'image' && imgSlot < 2 && l.image) {
      kind = imgSlot + 1;
      out.imageSlots[imgSlot] = l;
      out.img[imgSlot * 4] = l.image.x;
      out.img[imgSlot * 4 + 1] = l.image.y;
      out.img[imgSlot * 4 + 2] = l.image.scale;
      out.img[imgSlot * 4 + 3] = (l.image.rotation * Math.PI) / 180;
      out.img2[imgSlot * 4] = (aspect / Math.max(l.image.aspect || 1, 1e-3));
      out.img2[imgSlot * 4 + 1] = l.image.flipH ? 1 : 0;
      out.img2[imgSlot * 4 + 2] = l.image.flipV ? 1 : 0;
      out.img2[imgSlot * 4 + 3] = l.fill / 100;
      imgSlot++;
    } else if (l.kind === 'fill' && l.fillLayer) {
      kind = 3;
      const f = l.fillLayer;
      const c1 = toWorking(f.color);
      const c2 = toWorking(f.color2);
      const kindIndex = f.kind === 'solid' ? 1 : f.kind === 'gradient' ? 2 : f.kind === 'noise' ? 3 : 1;
      out.fill[i * 4] = c1[0];
      out.fill[i * 4 + 1] = c1[1];
      out.fill[i * 4 + 2] = c1[2];
      out.fill[i * 4 + 3] = kindIndex;
      out.fill2[i * 4] = c2[0];
      out.fill2[i * 4 + 1] = c2[1];
      out.fill2[i * 4 + 2] = c2[2];
      out.fill2[i * 4 + 3] = f.angle;
    }

    out.op[i * 4] = entry.opacity;
    out.op[i * 4 + 1] = BLEND_INDEX[entry.blend] ?? 0;
    out.op[i * 4 + 2] = l.masks.length > 0 ? 1 : 0;
    out.op[i * 4 + 3] = kind;

    out.adjA[i * 4] = a.exposure;
    out.adjA[i * 4 + 1] = a.contrast;
    out.adjA[i * 4 + 2] = a.highlights;
    out.adjA[i * 4 + 3] = a.shadows;
    out.adjB[i * 4] = a.whites;
    out.adjB[i * 4 + 1] = a.blacks;
    out.adjB[i * 4 + 2] = a.temp;
    out.adjB[i * 4 + 3] = a.tint;
    out.adjC[i * 4] = a.vibrance;
    out.adjC[i * 4 + 1] = a.saturation;
    out.adjC[i * 4 + 2] = a.clarity;
    out.adjC[i * 4 + 3] = a.texture;
    out.adjD[i * 4] = a.dehaze;
    out.adjD[i * 4 + 1] = a.sharpness;
    out.adjD[i * 4 + 2] = a.grain;
    out.adjD[i * 4 + 3] = a.glow;

    if (!l.masks.length) continue;
    const m = compositeMask(l.masks);
    if (!m) continue;
    out.maskDraws.push(buildMaskDraw(i, l.masks, m, aspect));
  }
  return out;
}

/** Pick the dominant mask for the atlas tile (extra components refine it). */
function compositeMask(masks: Mask[]): Mask | null {
  return masks.find((m) => m.op === 'replace' || m.op === 'add') ?? masks[0] ?? null;
}

function buildMaskDraw(slot: number, masks: Mask[], primary: Mask, aspect: number): MaskDraw {
  const kind = MASK_KIND_INDEX[primary.kind] ?? 0;
  const maskA = new Float32Array(4);
  const maskB = new Float32Array(4);
  const maskC = new Float32Array(4);
  const range = new Float32Array(4);

  const feather = clamp01(primary.feather / 100);
  maskB[0] = feather;
  maskB[1] = primary.invert ? 1 : 0;
  maskB[2] = clamp01(primary.amount / 100);
  maskB[3] = 0;

  if (primary.kind === 'linear') {
    const l = primary.linear ?? { x0: 0, y0: 0.25, x1: 0, y1: 0.75 };
    maskA.set([l.x0, l.y0, l.x1, l.y1]);
  } else if (primary.kind === 'radial') {
    const r = primary.radial ?? { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, rotation: 0 };
    maskA.set([r.cx, r.cy, r.rx, r.ry]);
    maskB[3] = (r.rotation * Math.PI) / 180;
  } else if (primary.kind === 'luminance') {
    const lm = primary.luminance ?? { lo: 0, hi: 1, smooth: 0.2 };
    maskA.set([lm.lo, lm.hi, lm.smooth, 0]);
  } else if (primary.kind === 'color') {
    const cr = primary.color ?? { samples: [], fuzziness: 0.2 };
    const s0 = cr.samples[0];
    const s1 = cr.samples[1];
    if (s0) maskA.set([s0.l, s0.c, s0.h, cr.fuzziness]);
    if (s1) maskC.set([s1.l, s1.c, s1.h, 1]);
  } else if (primary.kind === 'depth') {
    const d = primary.depth ?? { near: 0, far: 0.5, feather: 0.2 };
    maskA.set([d.near, d.far, d.feather, 0]);
  }

  // luminance-range refine from a second mask component, if present
  const refine = masks.find((m) => m !== primary && m.kind === 'luminance');
  if (refine?.luminance) {
    range.set([refine.luminance.lo, refine.luminance.hi, refine.luminance.smooth, 1]);
  }
  const { add, addCount, sub, subCount, flow } = strokeCircles(masks);
  void aspect;
  return {
    slot,
    kind: primary.kind === 'brush' ? 6 : kind,
    maskA,
    maskB,
    maskC,
    range,
    matteMode: primary.kind === 'sky' ? 1 : primary.kind === 'background' ? 2 : 0,
    needsMatte: ['subject', 'sky', 'background', 'people', 'object'].includes(primary.kind),
    add,
    addCount,
    sub,
    subCount,
    flow,
  };
}

/** sRGB hex → linear Rec.2020 (for values used inside the working space). */
export function toWorking(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex.startsWith('#') ? hex : `#${hex}`);
  const c = lrgbTo2020(srgbToLinearRgb(rgb));
  return [c.r, c.g, c.b];
}

/** sRGB hex → display-encoded 0..1 (for values used after the output transform). */
export function toDisplayRgb(hex: string): [number, number, number] {
  const c = hexToRgb(hex.startsWith('#') ? hex : `#${hex}`);
  return [c.r, c.g, c.b];
}

/* --------------------------------------------------------------- overlays */

export const CLIPPING_MODE: Record<OverlayState['clipping'], number> = {
  off: 0,
  both: 1,
  highlights: 2,
  shadows: 3,
};

export const BG_KIND: Record<string, number> = {
  none: 0,
  transparent: 0,
  checker: 1,
  solid: 2,
  gradient: 3,
  blur: 4,
  studioGray: 5,
  whiteSweep: 6,
  image: 7,
};

export const BEFORE_AFTER_MODE: Record<string, number> = {
  off: 0,
  split: 1,
  left: 2,
  right: 2,
  top: 3,
  bottom: 3,
  toggle: 4,
};
