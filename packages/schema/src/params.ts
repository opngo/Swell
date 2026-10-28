/**
 * DevelopParams — the single source of truth for a photo's edit (§7.2).
 *
 * Zod is the schema; the TypeScript types are *inferred* from it, so the
 * runtime validation at every IPC / storage boundary can never drift from the
 * compile-time types.
 *
 * Params are versioned (`v`). Older documents are upgraded by the migration
 * registry in ./migrations.ts before they reach the engine.
 */

import { z } from 'zod';

export const PARAMS_VERSION = 3;

/* ------------------------------------------------------------------ helpers */

const num = (min: number, max: number, def: number) =>
  z.number().min(min).max(max).default(def).catch(def);

const point = z.object({ x: z.number(), y: z.number() });
const points = (max = 16) => z.array(point).max(max).default([]);

/* ------------------------------------------------------------------- curves */

export const parametricSchema = z.object({
  highlights: num(-100, 100, 0),
  lights: num(-100, 100, 0),
  darks: num(-100, 100, 0),
  shadows: num(-100, 100, 0),
  splits: z.tuple([z.number(), z.number(), z.number()]).default([25, 50, 75]),
});

export const curvesSchema = z.object({
  mode: z.enum(['point', 'parametric']).default('point'),
  interpolation: z.enum(['monotone', 'smooth', 'linear']).default('monotone'),
  /** Amount the whole curve group is blended with the identity ramp (0…2). */
  amount: num(0, 2, 1),
  luma: points(),
  r: points(),
  g: points(),
  b: points(),
  parametric: parametricSchema.prefault({
    highlights: 0,
    lights: 0,
    darks: 0,
    shadows: 0,
    splits: [25, 50, 75],
  }),
  /** Hue-indexed curves; `y` is a delta around 0 (identity). */
  hueCurves: z
    .object({
      hh: points(),
      hs: points(),
      hl: points(),
      ls: points(),
      ss: points(),
    })
    .prefault({ hh: [], hs: [], hl: [], ls: [], ss: [] }),
  /** Keep luminance constant while the RGB curve shifts colour. */
  lockLuminosity: z.boolean().default(false),
});
export type Curves = z.output<typeof curvesSchema>;

/* -------------------------------------------------------------------- masks */

export const strokeSchema = z.object({
  x: z.number(),
  y: z.number(),
  r: z.number(),
  feather: z.number().default(0.5),
  flow: z.number().default(1),
  /** Vector path for tablet strokes: normalised points along the drag. */
  path: z.array(z.tuple([z.number(), z.number()])).default([]),
});

export const maskSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'brush',
    'linear',
    'radial',
    'luminance',
    'color',
    'depth',
    'subject',
    'sky',
    'background',
    'people',
    'object',
  ]),
  name: z.string().default('Mask'),
  op: z.enum(['add', 'subtract', 'intersect', 'replace']).default('replace'),
  invert: z.boolean().default(false),
  amount: num(0, 100, 100),
  feather: num(0, 100, 20),
  /** Brush */
  strokes: z.array(strokeSchema).default([]),
  brush: z
    .object({
      size: num(1, 100, 22),
      feather: num(0, 100, 50),
      flow: num(1, 100, 100),
      density: num(1, 100, 100),
      autoMask: z.boolean().default(false),
      erase: z.boolean().default(false),
      smoothing: num(0, 100, 40),
    })
    .prefault({}),
  /** Linear gradient: two handles + feather, all normalised to the frame. */
  linear: z
    .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })
    .optional(),
  /** Radial gradient */
  radial: z
    .object({
      cx: z.number(),
      cy: z.number(),
      rx: z.number(),
      ry: z.number(),
      rotation: z.number().default(0),
    })
    .optional(),
  /** Luminance range */
  luminance: z.object({ lo: z.number(), hi: z.number(), smooth: z.number().default(0.2) }).optional(),
  /** Colour range — OKLCH samples + fuzziness */
  color: z
    .object({ samples: z.array(z.object({ l: z.number(), c: z.number(), h: z.number() })).default([]), fuzziness: z.number().default(0.2) })
    .optional(),
  /** Depth range (Depth Anything V2 in the desktop build) */
  depth: z.object({ near: z.number(), far: z.number(), feather: z.number().default(0.2) }).optional(),
  /** People parsing parts */
  people: z
    .object({
      parts: z
        .array(
          z.enum(['body', 'face', 'skin', 'eyes', 'eyebrows', 'lips', 'teeth', 'hair', 'clothes']),
        )
        .default(['skin']),
    })
    .optional(),
  /** Edge refinement, shared by every mask kind */
  refine: z
    .object({
      shift: num(-100, 100, 0),
      smooth: num(0, 100, 0),
      decontaminate: z.boolean().default(false),
    })
    .prefault({}),
  overlay: z
    .object({
      visible: z.boolean().default(false),
      mode: z.enum(['color', 'bw', 'onBlack', 'onWhite']).default('color'),
      color: z.string().default('#ff3b6b'),
      opacity: num(0, 100, 55),
    })
    .prefault({}),
});

export type Mask = z.output<typeof maskSchema>;
export type MaskInput = z.input<typeof maskSchema>;
export type Stroke = z.output<typeof strokeSchema>;

/* ------------------------------------------------------------------- layers */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'hardLight',
  'colorDodge',
  'colorBurn',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'add',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const localAdjustSchema = z.object({
  exposure: num(-5, 5, 0),
  contrast: num(-100, 100, 0),
  highlights: num(-100, 100, 0),
  shadows: num(-100, 100, 0),
  whites: num(-100, 100, 0),
  blacks: num(-100, 100, 0),
  texture: num(-100, 100, 0),
  clarity: num(-100, 100, 0),
  dehaze: num(-100, 100, 0),
  temp: num(-100, 100, 0),
  tint: num(-100, 100, 0),
  vibrance: num(-100, 100, 0),
  saturation: num(-100, 100, 0),
  sharpness: num(0, 150, 0),
  noise: num(0, 100, 0),
  moire: num(0, 100, 0),
  defringe: num(0, 100, 0),
  grain: num(0, 100, 0),
  glow: num(0, 100, 0),
  halation: num(0, 100, 0),
  soften: num(0, 100, 0),
  curvesLuma: points(),
  curvesR: points(),
  curvesG: points(),
  curvesB: points(),
  gradeHue: num(0, 360, 0),
  gradeSat: num(0, 100, 0),
});
export type LocalAdjust = z.output<typeof localAdjustSchema>;

export const layerSchema = z.object({
  id: z.string(),
  kind: z.enum(['adjustment', 'image', 'fill', 'cutout', 'group', 'text']),
  name: z.string().default('Layer'),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  solo: z.boolean().default(false),
  opacity: num(0, 100, 100),
  fill: num(0, 100, 100),
  blend: z.enum(BLEND_MODES).default('normal'),
  color: z.string().optional(),
  clipped: z.boolean().default(false),
  parentId: z.string().optional(),
  masks: z.array(maskSchema).default([]),
  adjust: localAdjustSchema.prefault({}),
  /** Image layers: a placed bitmap (logo, texture, background plate). */
  image: z
    .object({
      src: z.string(),
      x: z.number().default(0.5),
      y: z.number().default(0.5),
      scale: z.number().default(1),
      rotation: z.number().default(0),
      flipH: z.boolean().default(false),
      flipV: z.boolean().default(false),
      /** width/height of the placed bitmap — needed for undistorted transforms */
      aspect: z.number().default(1),
    })
    .optional(),
  /** Fill layers */
  fillLayer: z
    .object({
      kind: z.enum(['solid', 'gradient', 'noise', 'pattern']).default('solid'),
      color: z.string().default('#ffffff'),
      color2: z.string().default('#000000'),
      angle: z.number().default(90),
      noiseAmount: z.number().default(20),
    })
    .optional(),
  /** Cutout layers (Remove Background output) */
  cutout: z
    .object({
      matteId: z.string().default(''),
      invert: z.boolean().default(false),
    })
    .optional(),
  text: z
    .object({
      content: z.string().default(''),
      fontFamily: z.string().default('Geist Sans'),
      size: z.number().default(48),
      tracking: z.number().default(0),
      color: z.string().default('#ffffff'),
      x: z.number().default(0.5),
      y: z.number().default(0.5),
    })
    .optional(),
});

export type Layer = z.output<typeof layerSchema>;
export type LayerInput = z.input<typeof layerSchema>;

/* ----------------------------------------------------------------- removals */

export const removalSchema = z.object({
  id: z.string(),
  kind: z.enum(['heal', 'clone', 'inpaint', 'redEye', 'wire']),
  strokes: z.array(strokeSchema).default([]),
  /** Clone source offset, normalised. */
  source: z.object({ dx: z.number(), dy: z.number() }).prefault({ dx: 0.08, dy: -0.06 }),
  strength: num(0, 100, 100),
  feather: num(0, 100, 40),
  autoSource: z.boolean().default(true),
  variant: z.number().int().min(0).max(3).default(0),
});
export type Removal = z.output<typeof removalSchema>;

/* ------------------------------------------------------------- bg removal */

export const bgRemovalSchema = z.object({
  enabled: z.boolean().default(false),
  output: z
    .object({
      kind: z.enum(['transparent', 'solid', 'gradient', 'blur', 'image', 'studioGray', 'whiteSweep'])
        .default('transparent'),
      color: z.string().default('#f2f2f2'),
      color2: z.string().default('#cfcfcf'),
      angle: z.number().default(135),
      blurRadius: num(0, 100, 40),
      imageSrc: z.string().optional(),
    })
    .prefault({}),
  edge: z
    .object({
      feather: num(0, 100, 12),
      shift: num(-100, 100, 0),
      smooth: num(0, 100, 25),
      hairRefine: z.boolean().default(true),
      decontaminate: z.boolean().default(true),
      glowMatch: z.boolean().default(false),
    })
    .prefault({}),
  shadows: z
    .object({
      kind: z.enum(['none', 'original', 'synthetic', 'reflection']).default('original'),
      angle: num(0, 360, 135),
      distance: num(0, 100, 12),
      blur: num(0, 100, 40),
      opacity: num(0, 100, 45),
    })
    .prefault({}),
  relightMatch: z.boolean().default(false),
  maskView: z
    .enum(['off', 'overlay', 'bw', 'onBlack', 'onWhite', 'checker'])
    .default('off'),
  subjects: z.array(z.object({ id: z.string(), included: z.boolean().default(true) })).default([]),
  model: z.string().default('birefnet'),
  matteId: z.string().default(''),
});
export type BgRemoval = z.output<typeof bgRemovalSchema>;

/* ---------------------------------------------------------------- geometry */

export const cropSchema = z.object({
  aspect: z
    .enum(['original', 'free', '1:1', '4:5', '5:7', '2:3', '3:4', '16:9', '3:2', 'custom'])
    .default('original'),
  customAspect: z.number().default(1.5),
  x: z.number().default(0),
  y: z.number().default(0),
  w: z.number().default(1),
  h: z.number().default(1),
  angle: num(-45, 45, 0),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  rotate90: z.number().int().default(0),
  constrain: z.boolean().default(true),
});

export const geometrySchema = z.object({
  crop: cropSchema.prefault({}),
  distortion: num(-100, 100, 0),
  vertical: num(-100, 100, 0),
  horizontal: num(-100, 100, 0),
  rotate: num(-180, 180, 0),
  aspect: num(50, 150, 100),
  scale: num(50, 200, 100),
  xOffset: num(-100, 100, 0),
  yOffset: num(-100, 100, 0),
  upright: z.enum(['off', 'auto', 'level', 'vertical', 'full', 'guided']).default('off'),
  guidedLines: z
    .array(z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }))
    .max(4)
    .default([]),
});

/* -------------------------------------------------------------------- lens */

export const lensSchema = z.object({
  enabled: z.boolean().default(true),
  profileId: z.string().default('auto'),
  distortion: num(0, 200, 100),
  vignetting: num(0, 200, 100),
  removeCA: z.boolean().default(true),
  caAmount: num(0, 200, 100),
  defringeAmount: num(0, 100, 0),
  defringeHue: z.tuple([z.number(), z.number()]).default([260, 320]),
});

/* ------------------------------------------------------------------- mixer */

export const MIXER_CHANNELS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;
export type MixerChannel = (typeof MIXER_CHANNELS)[number];

const mixerChannel = z.object({ h: num(-100, 100, 0), s: num(-100, 100, 0), l: num(-100, 100, 0) });

export const pointColorSchema = z.object({
  id: z.string(),
  l: z.number(),
  c: z.number(),
  h: z.number(),
  hueShift: num(-180, 180, 0),
  sat: num(-100, 100, 0),
  lum: num(-100, 100, 0),
  hueRange: num(1, 180, 30),
  satRange: num(0, 1, 0.5),
  lumRange: num(0, 1, 0.6),
  showMask: z.boolean().default(false),
});

/* ------------------------------------------------------------ top level */

export const developParamsSchema = z.object({
  v: z.number().int().default(PARAMS_VERSION),
  profile: z
    .object({
      id: z.string().default('swell-neutral'),
      amount: num(0, 200, 100),
      /** Optional .cube LUT applied as a creative profile. */
      lutId: z.string().optional(),
      lutAmount: num(0, 200, 100),
    })
    .prefault({}),
  treatment: z.enum(['color', 'bw']).default('color'),
  wb: z
    .object({
      temp: num(2000, 50000, 5500),
      tint: num(-150, 150, 0),
      mode: z
        .enum(['asShot', 'auto', 'daylight', 'cloudy', 'shade', 'tungsten', 'fluorescent', 'flash', 'custom'])
        .default('asShot'),
    })
    .prefault({}),
  tone: z
    .object({
      exposure: num(-5, 5, 0),
      contrast: num(-100, 100, 0),
      highlights: num(-100, 100, 0),
      shadows: num(-100, 100, 0),
      whites: num(-100, 100, 0),
      blacks: num(-100, 100, 0),
    })
    .prefault({}),
  presence: z
    .object({
      texture: num(-100, 100, 0),
      clarity: num(-100, 100, 0),
      dehaze: num(-100, 100, 0),
      vibrance: num(-100, 100, 0),
      saturation: num(-100, 100, 0),
    })
    .prefault({}),
  curves: curvesSchema.prefault({}),
  mixer: z.record(z.enum(MIXER_CHANNELS), mixerChannel).prefault({
    red: { h: 0, s: 0, l: 0 },
    orange: { h: 0, s: 0, l: 0 },
    yellow: { h: 0, s: 0, l: 0 },
    green: { h: 0, s: 0, l: 0 },
    aqua: { h: 0, s: 0, l: 0 },
    blue: { h: 0, s: 0, l: 0 },
    purple: { h: 0, s: 0, l: 0 },
    magenta: { h: 0, s: 0, l: 0 },
  }),
  pointColor: z.array(pointColorSchema).max(8).default([]),
  grading: z
    .object({
      shadows: z.object({ hue: num(0, 360, 0), sat: num(0, 100, 0), lum: num(-100, 100, 0) }).prefault({}),
      mids: z.object({ hue: num(0, 360, 0), sat: num(0, 100, 0), lum: num(-100, 100, 0) }).prefault({}),
      highs: z.object({ hue: num(0, 360, 0), sat: num(0, 100, 0), lum: num(-100, 100, 0) }).prefault({}),
      global: z.object({ hue: num(0, 360, 0), sat: num(0, 100, 0), lum: num(-100, 100, 0) }).prefault({}),
      blend: num(0, 100, 50),
      balance: num(-100, 100, 0),
    })
    .prefault({}),
  detail: z
    .object({
      sharpen: z
        .object({
          amount: num(0, 150, 40),
          radius: num(0.5, 3, 1),
          detail: num(0, 100, 25),
          masking: num(0, 100, 0),
        })
        .prefault({}),
      nr: z
        .object({
          luminance: num(0, 100, 0),
          detail: num(0, 100, 50),
          contrast: num(0, 100, 0),
          color: num(0, 100, 25),
          colorDetail: num(0, 100, 50),
          colorSmoothness: num(0, 100, 50),
        })
        .prefault({}),
      aiDenoise: z.object({ enabled: z.boolean().default(false), strength: num(0, 100, 50) }).prefault({}),
      deconvolution: z.boolean().default(false),
    })
    .prefault({}),
  lens: lensSchema.prefault({}),
  geometry: geometrySchema.prefault({}),
  effects: z
    .object({
      vignette: z
        .object({
          style: z.enum(['highlightPriority', 'colorPriority', 'paintOverlay']).default('highlightPriority'),
          amount: num(-100, 100, 0),
          midpoint: num(0, 100, 50),
          roundness: num(-100, 100, 0),
          feather: num(0, 100, 50),
          highlights: num(0, 100, 0),
        })
        .prefault({}),
      grain: z
        .object({ amount: num(0, 100, 0), size: num(1, 100, 25), roughness: num(0, 100, 50) })
        .prefault({}),
    })
    .prefault({}),
  calibration: z
    .object({
      profile: z.string().default('camera-standard'),
      shadowsTint: num(-100, 100, 0),
      red: z.object({ hue: num(-100, 100, 0), sat: num(-100, 100, 0) }).prefault({}),
      green: z.object({ hue: num(-100, 100, 0), sat: num(-100, 100, 0) }).prefault({}),
      blue: z.object({ hue: num(-100, 100, 0), sat: num(-100, 100, 0) }).prefault({}),
    })
    .prefault({}),
  layers: z.array(layerSchema).max(64).default([]),
  removals: z.array(removalSchema).default([]),
  bgRemoval: bgRemovalSchema.optional(),
});

export type DevelopParams = z.output<typeof developParamsSchema>;
export type DevelopParamsInput = z.input<typeof developParamsSchema>;

/**
 * Recursive partial. Presets and profiles store only the groups they touch, so
 * `{ tone: { contrast: 12 } }` must be a legal value — merging fills the rest
 * from the photo's current params (see `applyPresetParams`).
 */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[] // mutable: fragments get merged into immer drafts
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type ParamFragment = DeepPartial<DevelopParams>;

/** Fully-populated default document. */
export const defaultParams = (): DevelopParams => developParamsSchema.parse({});

/** Deep-merge a partial document onto defaults, validating the result. */
export function parseParams(input: unknown): DevelopParams {
  return developParamsSchema.parse(input ?? {});
}

export function isValidParams(input: unknown): boolean {
  return developParamsSchema.safeParse(input).success;
}

/* ------------------------------------------------------------- fragments */

/**
 * Presets and profiles store *only* the groups they touch.
 *
 * `developParamsSchema.partial()` cannot express that on its own: every field
 * carries a default or prefault, so an absent key still materialises a full
 * default group — and merging a "fragment" that contains `layers: []` would
 * wipe the user's layer stack. Validate against the real schema, then prune
 * back to the keys the author actually wrote.
 */
function pruneFragment(raw: unknown, parsed: unknown): ParamFragment {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRecord(raw) || !isRecord(parsed)) return parsed as ParamFragment;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in parsed)) continue; // stripped: not a param group
    out[key] = pruneFragment(value, parsed[key]);
  }
  return out as ParamFragment;
}

/** A validated `ParamFragment`: real values, no invented defaults. */
export const paramFragmentSchema = z.record(z.string(), z.unknown()).transform((raw, ctx) => {
  const res = developParamsSchema.partial().safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues;
    ctx.addIssue({
      code: 'custom',
      path: issues[0]?.path ?? [],
      message: issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
    });
    return z.NEVER;
  }
  return pruneFragment(raw, res.data);
});

/* --------------------------------------------------------------- presets */

export const presetGroupSchema = z.enum([
  'swell',
  'portrait',
  'landscape',
  'film',
  'bw',
  'local',
  'user',
]);

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: presetGroupSchema.default('user'),
  favorite: z.boolean().default(false),
  description: z.string().optional(),
  /** Which param groups the preset touches (drives the create-preset checklist). */
  include: z.array(z.string()).default(['tone', 'presence', 'curves', 'grading']),
  amount: num(0, 200, 100),
  params: paramFragmentSchema.prefault({}),
  createdAt: z.number().default(() => Date.now()),
  thumb: z.string().optional(),
});
export type Preset = z.output<typeof presetSchema>;
/**
 * What `addPreset` accepts. The id is optional: the store generates one unless
 * the caller already has it (duplicating a preset, importing a `.swellpreset`),
 * in which case keeping the id makes a re-import update rather than duplicate.
 */
export type PresetInput = Omit<z.input<typeof presetSchema>, 'id'> & { id?: string };

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.enum(['swell', 'camera', 'creative', 'lut']).default('swell'),
  /** Parametric look — applied before the develop params. */
  params: paramFragmentSchema.prefault({}),
  lutId: z.string().optional(),
  favorite: z.boolean().default(false),
  description: z.string().optional(),
});
export type Profile = z.output<typeof profileSchema>;

export const snapshotSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  name: z.string(),
  params: developParamsSchema.prefault({}),
  ts: z.number(),
});
export type Snapshot = z.output<typeof snapshotSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  photoId: z.string(),
  label: z.string(),
  ts: z.number(),
  /** Param diff — never pixels (§5.2). */
  diff: z.record(z.string(), z.unknown()).prefault({}),
  parentId: z.string().optional(),
  branch: z.number().default(0),
});
export type HistoryEntry = z.output<typeof historyEntrySchema>;

/* ------------------------------------------------------- param group meta */

export const PARAM_GROUPS = [
  { id: 'profile', label: 'Profile', icon: 'palette' },
  { id: 'wb', label: 'White Balance', icon: 'sunlight' },
  { id: 'tone', label: 'Tone', icon: 'half-moon' },
  { id: 'presence', label: 'Presence', icon: 'sparks' },
  { id: 'curves', label: 'Tone Curve', icon: 'wave' },
  { id: 'mixer', label: 'Color Mixer', icon: 'color-picker' },
  { id: 'pointColor', label: 'Point Color', icon: 'target' },
  { id: 'grading', label: 'Color Grading', icon: 'palette' },
  { id: 'detail', label: 'Detail', icon: 'sharp' },
  { id: 'lens', label: 'Lens Corrections', icon: 'lens' },
  { id: 'geometry', label: 'Geometry & Crop', icon: 'crop' },
  { id: 'effects', label: 'Effects', icon: 'sun-light' },
  { id: 'calibration', label: 'Calibration', icon: 'sliders' },
  { id: 'layers', label: 'Layers & Masks', icon: 'layers' },
  { id: 'removals', label: 'Spot Removal', icon: 'eraser' },
  { id: 'bgRemoval', label: 'Background', icon: 'magic-wand' },
  { id: 'treatment', label: 'Treatment', icon: 'media-image' },
] as const;

export type ParamGroupId = (typeof PARAM_GROUPS)[number]['id'];
