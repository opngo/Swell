/**
 * RenderRequest construction, shared by the stage, the preset previews and the
 * export queue. One place to keep the engine contract honest: every field the
 * output pass reads is filled here, with the neutral default when the caller
 * does not care.
 */

import type {
  BackgroundState,
  BeforeAfterState,
  CurveLuts,
  DevelopParams,
  OverlayState,
  ParamFragment,
  RenderRequest,
  SoftProofState,
  ViewRect,
  WatermarkState,
} from '@swell/schema';

export const EMPTY_LUTS: CurveLuts = {
  luma: new Float32Array(0),
  rgb: new Float32Array(0),
  hue: new Float32Array(0),
  hue2: new Float32Array(0),
  hueSize: 0,
  size: 0,
  cube: null,
  cubeAmount: 1,
};

export const OFF_BEFORE: BeforeAfterState = { mode: 'off', split: 0.5, params: null };

export const OFF_OVERLAYS: OverlayState = {
  clipping: 'off',
  gamutWarning: false,
  sharpnessHeatmap: false,
  cropGuides: 'off',
  straighten: false,
  depthPreview: false,
  detectionBoxes: false,
  spotVisualize: 0,
  mask: null,
};

export const OFF_PROOF: SoftProofState = {
  enabled: false,
  profile: 'srgb',
  intent: 'relative',
  blackPoint: true,
  simulatePaper: false,
  paperWhite: '#f2f0ec',
};

export const NO_WATERMARK: WatermarkState = {
  enabled: false,
  kind: 'text',
  text: '',
  position: 'bottom-right',
  inset: 4,
  opacity: 0.8,
  size: 3,
};

export function transparentBackground(): BackgroundState {
  return { kind: 'transparent', color: '#ffffff', color2: '#cfcfcf', angle: 135, blurRadius: 40, opacity: 1 };
}

/** Background state derived from `params.bgRemoval` (§4.7). */
export function backgroundFrom(params: DevelopParams): BackgroundState {
  const bg = params.bgRemoval;
  if (!bg || !bg.enabled) return transparentBackground();
  const o = bg.output;
  return {
    kind: o.kind === 'image' ? 'image' : o.kind,
    color: o.color,
    color2: o.color2,
    angle: o.angle,
    blurRadius: o.blurRadius,
    opacity: 1,
    image: undefined,
  } as BackgroundState;
}

export interface RequestOptions {
  photoId: string;
  requestId: number;
  params: DevelopParams;
  source: ImageBitmap;
  width: number;
  height: number;
  view?: ViewRect;
  zoom?: number;
  dpr?: number;
  quality?: 'proxy' | 'full';
  fast?: boolean;
  overlays?: Partial<OverlayState>;
  before?: BeforeAfterState;
  softProof?: SoftProofState;
  background?: BackgroundState;
  watermark?: WatermarkState;
  horizonTilt?: number;
  backdrop?: string;
}

export function makeRenderRequest(o: RequestOptions): RenderRequest {
  return {
    photoId: o.photoId,
    requestId: o.requestId,
    params: o.params,
    source: o.source,
    sourceWidth: o.source.width,
    sourceHeight: o.source.height,
    before: o.before ?? OFF_BEFORE,
    view: o.view ?? { x: 0, y: 0, w: 1, h: 1 },
    zoom: o.zoom ?? 1,
    target: { width: o.width, height: o.height, dpr: o.dpr ?? 1 },
    overlays: { ...OFF_OVERLAYS, ...(o.overlays ?? {}) },
    softProof: o.softProof ?? OFF_PROOF,
    background: o.background ?? backgroundFrom(o.params),
    watermark: o.watermark ?? NO_WATERMARK,
    luts: EMPTY_LUTS,
    quality: o.quality ?? 'full',
    fast: o.fast ?? false,
    horizonTilt: o.horizonTilt ?? 0,
    backdrop: o.backdrop ?? 'neutral-dark',
  };
}

/** Apply a preset's partial params over a base doc, scaled by `amount`. */
export function applyPresetParams(base: DevelopParams, patch: ParamFragment, amount = 1): DevelopParams {
  const out: Record<string, unknown> = { ...base };
  for (const [group, value] of Object.entries(patch)) {
    const before = (base as unknown as Record<string, unknown>)[group];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      out[group] = value;
      continue;
    }
    if (before === null || typeof before !== 'object' || Array.isArray(before)) {
      out[group] = value;
      continue;
    }
    const merged: Record<string, unknown> = { ...(before as Record<string, unknown>) };
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const b = (before as Record<string, unknown>)[k];
      if (typeof v === 'number' && typeof b === 'number') merged[k] = b + (v - b) * amount;
      else merged[k] = v;
    }
    out[group] = merged;
  }
  return out as DevelopParams;
}
