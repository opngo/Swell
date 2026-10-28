/**
 * Engine protocol (§5.2, §5.7).
 *
 * These are the typed messages that cross the UI ↔ engine boundary. The wire
 * format matters as much as the types:
 *
 *   • pixel data is **never** JSON — it moves as `Float32Array` / `Uint8Array`
 *     (transferable) or `ImageBitmap`
 *   • develop params move as *diffs* during a scrub, and only the coalesced
 *     final document is persisted
 *   • one render request per animation frame, latest-wins
 *
 * In the desktop build the same protocol crosses a `MessagePort` into the
 * hidden engine renderer; in the web build it crosses the same interface
 * in-process (`src/engine-client/`).
 */

import type { DevelopParams } from './params.ts';

export type Vec2 = { x: number; y: number };

/** Normalised rectangle in the *cropped, rotated* frame. */
export type ViewRect = { x: number; y: number; w: number; h: number };

export const FULL_VIEW: ViewRect = { x: 0, y: 0, w: 1, h: 1 };

export type OverlayState = {
  clipping: 'off' | 'both' | 'highlights' | 'shadows';
  gamutWarning: boolean;
  /** Mask preview for one layer */
  mask: {
    layerId: string | null;
    mode: 'color' | 'bw' | 'onBlack' | 'onWhite';
    color: string;
    opacity: number;
  } | null;
  sharpnessHeatmap: boolean;
  detectionBoxes: boolean;
  cropGuides: 'off' | 'thirds' | 'grid' | 'diagonal' | 'triangle' | 'golden' | 'spiral';
  spotVisualize: number; // 0 = off, otherwise sensitivity 0..1
  straighten: boolean;
  depthPreview: boolean;
};

export const emptyOverlays = (): OverlayState => ({
  clipping: 'off',
  gamutWarning: false,
  mask: null,
  sharpnessHeatmap: false,
  detectionBoxes: false,
  cropGuides: 'off',
  spotVisualize: 0,
  straighten: false,
  depthPreview: false,
});

export type BeforeAfterState = {
  mode: 'off' | 'split' | 'left' | 'right' | 'top' | 'bottom' | 'toggle';
  /** 0..1 divider position for split modes. */
  split: number;
  /** Params to show on the "before" side; null = original (identity) params. */
  params: DevelopParams | null;
  label?: string;
};

export type SoftProofState = {
  enabled: boolean;
  profile: 'srgb' | 'adobergb' | 'displayP3' | 'prophoto' | 'custom';
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  blackPoint: boolean;
  simulatePaper: boolean;
  paperWhite: string;
};

export type WatermarkState = {
  enabled: boolean;
  kind: 'text' | 'image';
  text: string;
  image?: ImageBitmap | null;
  position: string;
  inset: number;
  opacity: number;
  size: number;
};

export type BackgroundState = {
  kind: 'transparent' | 'checker' | 'solid' | 'gradient' | 'blur' | 'image' | 'studioGray' | 'whiteSweep';
  color: string;
  color2: string;
  angle: number;
  blurRadius: number;
  image?: ImageBitmap | null;
  opacity: number;
};

/* ---------------------------------------------------------------- payloads */

export type CurveLuts = {
  /** 1-D encoded-domain LUTs. `luma` is R; `rgb` is packed RGB. */
  luma: Float32Array;
  rgb: Float32Array; // length = luma.length * 3
  /** Hue-indexed deltas: hh, hs, hl, ls packed per texel (RGBA). */
  hue: Float32Array; // length = hueSize * 4
  /** Saturation-vs-saturation delta, indexed by chroma. */
  hue2: Float32Array; // length = hueSize
  hueSize: number;
  size: number;
  /** Optional 3-D LUT from a .cube profile. */
  cube?: { size: number; data: Uint8Array } | null;
  cubeAmount: number;
};

export type MattePayload = {
  id: string;
  width: number;
  height: number;
  /** 8-bit alpha, row-major. */
  alpha: Uint8Array;
};

export type ImageLayerPayload = {
  layerId: string;
  bitmap: ImageBitmap;
};

/* ---------------------------------------------------------------- commands */

export type RenderRequest = {
  photoId: string;
  requestId: number;
  params: DevelopParams;
  /** Source pixels — transferred, never serialised. */
  source?: ImageBitmap | null;
  sourceWidth: number;
  sourceHeight: number;
  before?: BeforeAfterState;
  view: ViewRect;
  zoom: number;
  target: { width: number; height: number; dpr: number };
  overlays: OverlayState;
  softProof: SoftProofState;
  background: BackgroundState;
  watermark: WatermarkState;
  luts: CurveLuts;
  quality: 'proxy' | 'full';
  /** Detected horizon tilt in degrees — feeds Upright = Level/Auto. */
  horizonTilt?: number;
  /** Canvas backdrop token (§3.2). Must stay neutral for colour judgement. */
  backdrop?: string;
  /** Skip expensive passes during a fast scrub (AI masks, inpainting). */
  fast: boolean;
};

export type HistogramPayload = {
  /** 256 bins each: luma, r, g, b — normalised to 0..1 of the peak bin. */
  luma: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  peak: number;
  clippedHighlights: number;
  clippedShadows: number;
  meanLuma: number;
  /** Cursor readouts are computed on demand, not here. */
  ts: number;
};

export type EngineStats = {
  backend: 'webgl2' | 'webgpu' | 'none';
  renderer: string;
  textures: number;
  textureBytes: number;
  framebuffers: number;
  lastRenderMs: number;
  avgRenderMs: number;
  fps: number;
  passes: number;
  droppedFrames: number;
  workSize: { w: number; h: number };
};

export type EngineCommand =
  | { type: 'init'; target: { width: number; height: number }; backend: 'webgl2' | 'webgpu' }
  | { type: 'source'; photoId: string; bitmap: ImageBitmap; width: number; height: number }
  | { type: 'render'; request: RenderRequest }
  | { type: 'matte'; matte: MattePayload }
  | { type: 'imageLayer'; payload: ImageLayerPayload }
  | { type: 'lut'; luts: CurveLuts }
  | { type: 'resize'; target: { width: number; height: number; dpr: number } }
  | { type: 'capture'; requestId: number; format: 'png' | 'jpeg' | 'webp' | 'bitmap'; quality?: number }
  | { type: 'stats' }
  | { type: 'dispose' };

export type EngineEvent =
  | { type: 'ready'; stats: EngineStats }
  | { type: 'rendered'; requestId: number; ms: number }
  | { type: 'histogram'; photoId: string; histogram: HistogramPayload }
  | { type: 'stats'; stats: EngineStats }
  | { type: 'capture'; requestId: number; blob?: Blob; bitmap?: ImageBitmap }
  | { type: 'error'; message: string; requestId?: number };

/* ------------------------------------------------------------- diffing */

export type ParamDiff = Record<string, unknown>;

/**
 * Shallow-ish diff of two param documents, returning only changed leaf paths.
 * Used for the wire (§4: "send diffs, not full objects") and for history
 * entries (§7: history stores `params_diff_json`).
 */
export function diffParams(a: unknown, b: unknown, path = '', out: ParamDiff = {}): ParamDiff {
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    out[path || '$'] = b;
    return out;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out[path || '$'] = b;
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    diffParams((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

/** Apply a diff produced by `diffParams` onto a document. */
export function applyDiff(doc: Record<string, unknown>, diff: ParamDiff): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  for (const [path, value] of Object.entries(diff)) {
    const parts = path === '$' ? [] : path.split('.');
    if (parts.length === 0) continue;
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      const next = cur[key];
      if (typeof next !== 'object' || next === null) cur[key] = {};
      else cur[key] = { ...(next as Record<string, unknown>) };
      cur = cur[key] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  }
  return out;
}

/** Human-readable label for a history entry ("Exposure +0.35"). */
export function labelForDiff(diff: ParamDiff): string {
  const entries = Object.entries(diff);
  if (entries.length === 0) return 'No change';
  const [path, value] = entries[0]!;
  const leaf = path.split('.').pop() ?? path;
  const pretty = leaf.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  if (entries.length > 1) return `${pretty} +${entries.length - 1} more`;
  if (typeof value === 'number') {
    const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return `${pretty} ${value > 0 ? '+' : ''}${n}`;
  }
  if (typeof value === 'boolean') return `${pretty} ${value ? 'on' : 'off'}`;
  if (Array.isArray(value)) return `${pretty} (${value.length})`;
  return `${pretty} changed`;
}
