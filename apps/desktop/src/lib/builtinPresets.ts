/**
 * Built-in presets & profiles (§9). These ship with the app; user presets are
 * stored in IndexedDB (`presets.v1`) and merged in by the develop store.
 *
 * Values are real DevelopParams fragments — applying one of these actually
 * changes the render, and the amount slider scales every numeric field.
 */

import type { ParamFragment, Preset, Profile } from '@swell/schema';

/**
 * Presets are *fragments*: only the groups they touch. `paramFragmentSchema`
 * validates them without inventing defaults, so the literals below are checked
 * against `ParamFragment` and stay exactly as written.
 */
type Params = ParamFragment;

const p = (id: string, name: string, group: Preset['group'], params: Params, favorite = false, description?: string): Preset => ({
  id,
  name,
  group,
  favorite,
  description,
  include: Object.keys(params),
  amount: 100,
  params,
  createdAt: 0,
});

export const BUILTIN_PRESETS: Preset[] = [
  /* ------------------------------------------------------------- swell */
  p('sw-neutral', 'Swell Neutral', 'swell', {
    tone: { exposure: 0, contrast: 6, highlights: -8, shadows: 6, whites: 0, blacks: 0 },
    presence: { vibrance: 8, saturation: 0, clarity: 4, texture: 4, dehaze: 0 },
    detail: { sharpen: { amount: 42, radius: 1, detail: 26, masking: 8 } },
  }, true, 'The house look: clean, slightly lifted, honest colour.'),
  p('sw-punch', 'Swell Punch', 'swell', {
    tone: { contrast: 22, highlights: -18, shadows: 12, whites: 12, blacks: -10 },
    presence: { vibrance: 26, clarity: 16, texture: 10, dehaze: 8 },
    grading: {
      shadows: { hue: 232, sat: 8, lum: 0 },
      highs: { hue: 44, sat: 6, lum: 0 },
      blend: 40,
      balance: 0,
    },
  }, false, 'More bite for flat, overcast frames.'),
  p('sw-soft', 'Swell Soft', 'swell', {
    tone: { contrast: -12, highlights: -6, shadows: 14, whites: -6, blacks: 8 },
    presence: { vibrance: 6, clarity: -10, texture: -6 },
    effects: { vignette: { amount: -8, midpoint: 62, roundness: 0, feather: 78, highlights: 12 } },
  }, false, 'Low-contrast, gentle — good for skin and overcast light.'),
  p('sw-adaptive', 'Adaptive Light', 'swell', {
    tone: { exposure: 0.15, contrast: 10, highlights: -26, shadows: 22, whites: 6, blacks: -4 },
    presence: { vibrance: 12, dehaze: 4 },
    detail: { nr: { luminance: 12, detail: 54, contrast: 6, color: 30 } },
  }, false, 'Recovers highlight/shadow detail without flattening the frame.'),

  /* ------------------------------------------------------------ portrait */
  p('po-glow', 'Skin Glow', 'portrait', {
    tone: { exposure: 0.1, highlights: -12, shadows: 10 },
    presence: { vibrance: 10, clarity: -12, texture: -14 },
    mixer: {
      orange: { h: -4, s: -12, l: 10 },
      red: { h: 2, s: -6, l: 4 },
      yellow: { h: -8, s: -10, l: 6 },
    },
    grading: { highs: { hue: 62, sat: 6, lum: 2 }, blend: 30 },
    detail: { nr: { luminance: 14, detail: 46, contrast: 4, color: 34 } },
  }, true, 'Softens texture, warms skin, keeps eyes crisp.'),
  p('po-matte', 'Editorial Matte', 'portrait', {
    tone: { contrast: -8, highlights: -16, shadows: 6, blacks: 14 },
    presence: { vibrance: -6, saturation: -4, clarity: 6 },
    curves: {
      mode: 'point',
      interpolation: 'monotone',
      luma: [
        { x: 0, y: 0.045 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.965 },
      ],
    },
    grading: { shadows: { hue: 210, sat: 10, lum: 0 }, highs: { hue: 40, sat: 8, lum: 0 }, blend: 46 },
  }, false, 'Lifted blacks, cool shadow / warm highlight split.'),
  p('po-studio', 'Warm Studio', 'portrait', {
    wb: { temp: 5850, tint: 4 },
    tone: { contrast: 12, highlights: -10, shadows: 8 },
    presence: { vibrance: 12, clarity: 8 },
    mixer: { orange: { h: -3, s: -6, l: 6 } },
    effects: { vignette: { amount: -10, midpoint: 58, feather: 72, highlights: 8 } },
  }, false, 'Tungsten-balanced studio light, subtle falloff.'),
  p('po-freckle', 'Freckles', 'portrait', {
    presence: { texture: 26, clarity: 8, vibrance: 6 },
    detail: { sharpen: { amount: 62, radius: 0.9, detail: 38, masking: 12 } },
    tone: { contrast: 8, highlights: -6 },
  }, false, 'Keeps skin detail — texture up, no smoothing.'),

  /* ----------------------------------------------------------- landscape */
  p('la-golden', 'Golden Ridge', 'landscape', {
    wb: { temp: 6100, tint: 6 },
    tone: { contrast: 16, highlights: -22, shadows: 14, whites: 8, blacks: -6 },
    presence: { vibrance: 22, dehaze: 12, clarity: 10 },
    mixer: {
      orange: { h: -6, s: 14, l: 6 },
      yellow: { h: -10, s: 10, l: 4 },
      blue: { h: 6, s: 8, l: -6 },
      green: { h: -8, s: -6, l: -4 },
    },
    grading: { shadows: { hue: 226, sat: 10 }, highs: { hue: 58, sat: 12 }, blend: 38 },
  }, true, 'Sunset landscapes: warm mids, cool shadows, real depth.'),
  p('la-fjord', 'Deep Fjord', 'landscape', {
    tone: { contrast: 14, highlights: -26, shadows: 10, blacks: -12 },
    presence: { vibrance: 14, dehaze: 18, clarity: 12 },
    mixer: { aqua: { h: -8, s: 12, l: -4 }, blue: { h: -6, s: 14, l: -8 }, green: { h: -14, s: 6 } },
    grading: { shadows: { hue: 236, sat: 12 }, blend: 42 },
  }, false, 'Cold water, deep blues, haze cut.'),
  p('la-autumn', 'Autumn Boost', 'landscape', {
    presence: { vibrance: 26, saturation: 4, clarity: 8 },
    mixer: { red: { h: 4, s: 16 }, orange: { h: -6, s: 18, l: 4 }, yellow: { h: -12, s: 14, l: 6 }, green: { h: -18, s: 8 } },
    tone: { contrast: 10, highlights: -14, shadows: 8 },
  }, false, 'Foliage forward: oranges and yellows pop.'),
  p('la-haze', 'Haze Cutter', 'landscape', {
    presence: { dehaze: 34, vibrance: 10, clarity: 12 },
    tone: { contrast: 12, blacks: -10, highlights: -10 },
    detail: { sharpen: { amount: 58, radius: 1.1, detail: 30, masking: 22 } },
  }, false, 'For atmospheric frames that need separation.'),

  /* ---------------------------------------------------------------- film */
  p('fi-200', 'Negative 200', 'film', {
    tone: { contrast: -6, highlights: -10, shadows: 12, blacks: 10 },
    curves: {
      mode: 'point',
      luma: [
        { x: 0, y: 0.06 },
        { x: 0.28, y: 0.3 },
        { x: 0.72, y: 0.72 },
        { x: 1, y: 0.94 },
      ],
    },
    grading: { shadows: { hue: 190, sat: 14 }, mids: { hue: 60, sat: 6 }, highs: { hue: 48, sat: 12 }, blend: 52 },
    effects: { grain: { amount: 26, size: 32, roughness: 54 } },
    presence: { vibrance: -6, saturation: -4 },
  }, true, 'Print-negative curve, teal shadows, fine grain.'),
  p('fi-cine', 'Cine Teal & Orange', 'film', {
    tone: { contrast: 18, highlights: -14, shadows: 6, blacks: -8 },
    grading: { shadows: { hue: 205, sat: 26 }, mids: { hue: 40, sat: 8 }, highs: { hue: 46, sat: 20 }, blend: 58 },
    mixer: { orange: { h: -4, s: 18, l: 6 }, blue: { h: 8, s: 12, l: -6 }, aqua: { h: 10, s: 10 } },
    presence: { vibrance: 10, clarity: 8 },
    effects: { vignette: { amount: -14, midpoint: 55, feather: 68, highlights: 6 } },
  }, false, 'The blockbuster split-tone.'),
  p('fi-faded', 'Faded Print', 'film', {
    tone: { contrast: -16, blacks: 22, whites: -10, shadows: 8 },
    presence: { vibrance: -18, saturation: -10 },
    grading: { shadows: { hue: 250, sat: 10 }, highs: { hue: 78, sat: 10 }, blend: 44 },
    effects: { grain: { amount: 18, size: 26, roughness: 60 } },
    curves: {
      mode: 'point',
      luma: [
        { x: 0, y: 0.11 },
        { x: 1, y: 0.9 },
      ],
    },
  }, false, 'Sun-bleached, low contrast, lifted blacks.'),
  p('fi-push', 'Push 800', 'film', {
    tone: { contrast: 26, highlights: -20, shadows: -8, blacks: -16 },
    presence: { vibrance: 8, clarity: 12 },
    detail: { nr: { luminance: 6, color: 12 } },
    effects: { grain: { amount: 42, size: 38, roughness: 66 } },
    grading: { shadows: { hue: 150, sat: 8 }, blend: 30 },
  }, false, 'Pushed black-and-white-ish negative: gritty, dense blacks.'),

  /* ------------------------------------------------------------------ bw */
  p('bw-graphite', 'Graphite', 'bw', {
    treatment: 'bw',
    tone: { contrast: 14, highlights: -12, shadows: 8, blacks: -8 },
    mixer: { red: { l: 18 }, orange: { l: 10 }, yellow: { l: 2 }, green: { l: -8 }, aqua: { l: -14 }, blue: { l: -20 } },
    detail: { sharpen: { amount: 52, radius: 1, detail: 28, masking: 14 } },
    effects: { grain: { amount: 14, size: 24, roughness: 50 } },
  }, true, 'Balanced mono mix with red-weighted skin.'),
  p('bw-contrast', 'High Contrast Mono', 'bw', {
    treatment: 'bw',
    tone: { contrast: 38, highlights: -18, shadows: -10, blacks: -22 },
    mixer: { red: { l: 26 }, yellow: { l: 8 }, green: { l: -12 }, blue: { l: -30 } },
    presence: { clarity: 18, dehaze: 8 },
  }, false, 'Punchy, graphic, deep blacks.'),
  p('bw-silver', 'Silver Gelatin', 'bw', {
    treatment: 'bw',
    tone: { contrast: 8, highlights: -8, shadows: 12, blacks: 4 },
    curves: {
      mode: 'point',
      luma: [
        { x: 0, y: 0.05 },
        { x: 0.5, y: 0.52 },
        { x: 1, y: 0.95 },
      ],
    },
    mixer: { orange: { l: 12 }, blue: { l: -16 } },
    effects: { grain: { amount: 30, size: 22, roughness: 44 }, vignette: { amount: -12, midpoint: 60, feather: 74 } },
  }, false, 'Darkroom print feel: soft toe, warm mid-grey.'),
];

export const PRESET_GROUPS: { id: Preset['group']; label: string }[] = [
  { id: 'swell', label: 'Swell' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'film', label: 'Film' },
  { id: 'bw', label: 'Black & White' },
  { id: 'local', label: 'Local' },
  { id: 'user', label: 'User' },
];

/* ---------------------------------------------------------------- profiles */

const prof = (id: string, name: string, group: Profile['group'], params: Params, description?: string): Profile => ({
  id,
  name,
  group,
  description,
  params: params as unknown as Profile['params'],
  favorite: false,
});

export const BUILTIN_PROFILES: Profile[] = [
  prof('swell-neutral', 'Swell Neutral', 'swell', {
    profile: { id: 'swell-neutral', amount: 100 },
    calibration: { profile: 'swell-neutral', red: { hue: 0, sat: 0 }, green: { hue: 0, sat: 0 }, blue: { hue: 0, sat: 0 } },
  }, 'Flat, colour-managed starting point. Every other profile is a delta on this.'),
  prof('swell-vivid', 'Swell Vivid', 'swell', {
    profile: { id: 'swell-vivid', amount: 100 },
    presence: { vibrance: 18, saturation: 4 },
    calibration: { red: { sat: 8 }, green: { sat: 6 }, blue: { sat: 10 } },
  }),
  prof('swell-portrait', 'Swell Portrait', 'swell', {
    profile: { id: 'swell-portrait', amount: 100 },
    mixer: { orange: { h: -3, s: -8, l: 5 } },
    presence: { vibrance: 6, clarity: -4 },
  }, 'Skin-protective: pulls orange saturation down a touch.'),
  prof('swell-landscape', 'Swell Landscape', 'swell', {
    profile: { id: 'swell-landscape', amount: 100 },
    mixer: { blue: { s: 8 }, green: { h: -6, s: 6 } },
    presence: { vibrance: 12, dehaze: 4 },
  }),
  prof('swell-mono', 'Swell Monochrome', 'swell', {
    profile: { id: 'swell-mono', amount: 100 },
    treatment: 'bw',
  }),
  prof('cam-canon-r5', 'Canon R5 — Standard', 'camera', {
    profile: { id: 'cam-canon-r5', amount: 100 },
    calibration: { red: { hue: 4, sat: 6 }, green: { hue: -3, sat: 2 }, blue: { hue: -6, sat: 8 } },
  }, 'Matches the in-camera Standard picture style.'),
  prof('cam-nikon-z8', 'Nikon Z8 — Standard', 'camera', {
    profile: { id: 'cam-nikon-z8', amount: 100 },
    calibration: { red: { hue: -2, sat: 4 }, green: { hue: 2, sat: -2 }, blue: { hue: 4, sat: 6 } },
  }),
  prof('cam-sony-a1', 'Sony α — Neutral', 'camera', {
    profile: { id: 'cam-sony-a1', amount: 100 },
    calibration: { red: { hue: 2, sat: -4 }, green: { hue: 0, sat: 0 }, blue: { hue: -4, sat: 4 } },
  }),
  prof('cam-fuji-xt5', 'Fujifilm X — Provia', 'camera', {
    profile: { id: 'cam-fuji-xt5', amount: 100 },
    presence: { vibrance: 6 },
    calibration: { red: { hue: -4, sat: 6 }, green: { hue: 4, sat: 4 }, blue: { hue: 2, sat: -2 } },
  }),
  prof('cre-bleach', 'Creative — Bleach Bypass', 'creative', {
    profile: { id: 'cre-bleach', amount: 100 },
    tone: { contrast: 22 },
    presence: { saturation: -22, clarity: 12 },
    grading: { shadows: { hue: 200, sat: 12 }, highs: { hue: 50, sat: 8 }, blend: 40 },
  }),
  prof('cre-kodachrome', 'Creative — Chrome Slide', 'creative', {
    profile: { id: 'cre-kodachrome', amount: 100 },
    presence: { vibrance: 14, saturation: 6 },
    mixer: { red: { s: 10 }, blue: { s: 12, l: -6 }, green: { h: -8, s: 8 } },
    tone: { contrast: 12, blacks: -6 },
  }),
];

export const PROFILE_GROUPS: { id: Profile['group']; label: string }[] = [
  { id: 'swell', label: 'Swell' },
  { id: 'camera', label: 'Camera Matching' },
  { id: 'creative', label: 'Creative' },
  { id: 'lut', label: 'LUT / .cube' },
];
