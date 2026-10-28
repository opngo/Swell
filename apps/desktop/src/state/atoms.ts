/**
 * Jotai atoms for *live* editor state (§5.2).
 *
 * Why both Zustand and Jotai?
 *   · Zustand owns durable, cross-route state: the catalog, settings, develop
 *     history, the activity centre.
 *   · Jotai owns the per-frame state of the editor: the params being dragged,
 *     the brush, the histogram, the mask overlay. A drag writes here 60×/s and
 *     only the components that read the specific atom re-render — the history
 *     stack and the catalog never see it until `commitGesture()`.
 */

import { atom, createStore } from 'jotai';
import {
  defaultParams,
  parseParams,
  type DevelopParams,
  type EngineStats,
  type HistogramPayload,
  type MattePayload,
} from '@swell/schema';
import { useDevelop } from '@/state/develop.ts';
import type { ViewMath } from '@/editor/coords.ts';

/** Explicit store so non-React code (EngineClient, shortcut bus) can read it. */
export const editorStore = createStore();

/* ------------------------------------------------------------- live params */

export interface LiveParams {
  photoId: string;
  params: DevelopParams;
  /** true between pointerdown and pointerup on a control */
  dirty: boolean;
}

export const liveParamsAtom = atom<LiveParams>({ photoId: '', params: defaultParams(), dirty: false });

/** Load a photo into the live slot (called when the selection changes). */
export const loadPhotoAtom = atom(null, (get, set, photoId: string) => {
  if (!photoId) return;
  const current = get(liveParamsAtom);
  if (current.photoId === photoId) return;
  const committed = useDevelop.getState().params[photoId] ?? defaultParams();
  set(liveParamsAtom, { photoId, params: committed, dirty: false });
});

/**
 * The hot path: apply a partial patch during a drag.
 * `patch` may be a deep partial (`{ tone: { exposure: 0.4 } }`).
 */
export const patchLiveAtom = atom(null, (get, set, patch: Record<string, unknown>) => {
  const cur = get(liveParamsAtom);
  if (!cur.photoId) return;
  const merged = deepMerge(cur.params as unknown as Record<string, unknown>, patch);
  set(liveParamsAtom, { ...cur, params: parseParams(merged), dirty: true });
});

/** Replace the whole live doc (used by curve editors, layer ops). */
export const setLiveAtom = atom(null, (get, set, params: DevelopParams) => {
  const cur = get(liveParamsAtom);
  set(liveParamsAtom, { ...cur, params, dirty: true });
});

/** End a gesture: fold the live doc into the develop store as ONE history entry. */
export const commitGestureAtom = atom(null, (get, set, label: string) => {
  const cur = get(liveParamsAtom);
  if (!cur.photoId || !cur.dirty) return;
  useDevelop.getState().commit(cur.photoId, cur.params, label);
  set(liveParamsAtom, { ...cur, dirty: false });
});

/** Abandon the drag (Esc) and snap back to the committed doc. */
export const cancelGestureAtom = atom(null, (get, set) => {
  const cur = get(liveParamsAtom);
  if (!cur.photoId) return;
  const committed = useDevelop.getState().params[cur.photoId] ?? defaultParams();
  set(liveParamsAtom, { photoId: cur.photoId, params: committed, dirty: false });
});

/* --------------------------------------------------------- derived slices */

/** Per-section atoms: only the panel you are dragging re-renders. */
export const toneAtom = atom((get) => get(liveParamsAtom).params.tone);
export const presenceAtom = atom((get) => get(liveParamsAtom).params.presence);
export const wbAtom = atom((get) => get(liveParamsAtom).params.wb);
export const curvesAtom = atom((get) => get(liveParamsAtom).params.curves);
export const mixerAtom = atom((get) => get(liveParamsAtom).params.mixer);
export const gradingAtom = atom((get) => get(liveParamsAtom).params.grading);
export const detailAtom = atom((get) => get(liveParamsAtom).params.detail);
export const lensAtom = atom((get) => get(liveParamsAtom).params.lens);
export const geometryAtom = atom((get) => get(liveParamsAtom).params.geometry);
export const effectsAtom = atom((get) => get(liveParamsAtom).params.effects);
export const calibrationAtom = atom((get) => get(liveParamsAtom).params.calibration);
export const layersAtom = atom((get) => get(liveParamsAtom).params.layers);
export const removalsAtom = atom((get) => get(liveParamsAtom).params.removals);
export const bgRemovalAtom = atom((get) => get(liveParamsAtom).params.bgRemoval);
export const profileAtom = atom((get) => get(liveParamsAtom).params.profile);
export const treatmentAtom = atom((get) => get(liveParamsAtom).params.treatment);

/* ------------------------------------------------------------- engine side */

export const histogramAtom = atom<HistogramPayload | null>(null);
export const engineStatsAtom = atom<EngineStats | null>(null);
export const engineOkAtom = atom<boolean>(false);
export const engineErrorAtom = atom<string | null>(null);
export const renderingAtom = atom<boolean>(false);
export const lastRenderMsAtom = atom<number>(0);

/** AI mattes keyed by `${photoId}:${kind}`. */
export const mattesAtom = atom<Record<string, MattePayload>>({});
export const setMatteAtom = atom(null, (get, set, m: MattePayload) => {
  set(mattesAtom, { ...get(mattesAtom), [m.id]: m });
});

/* ------------------------------------------------------------------ tools */

export type ToolId =
  | 'move'
  | 'crop'
  | 'straighten'
  | 'brush'
  | 'linear'
  | 'radial'
  | 'rangeColor'
  | 'rangeLuma'
  | 'rangeDepth'
  | 'subject'
  | 'sky'
  | 'background'
  | 'people'
  | 'object'
  | 'heal'
  | 'clone'
  | 'inpaint'
  | 'redEye'
  | 'wire'
  | 'eyedropper'
  | 'spot'
  | 'guides'
  | 'text';

export interface ToolState {
  tool: ToolId;
  brush: { size: number; feather: number; flow: number; density: number; autoMask: boolean; erase: boolean };
  /** mask being painted, if any */
  activeMaskId: string | null;
  activeLayerId: string | null;
  /** healing source mode */
  healSource: 'auto' | 'manual';
  healSourcePoint: { x: number; y: number } | null;
  spotMode: boolean;
  guidesMode: 'off' | 'thirds' | 'grid' | 'golden' | 'diagonal' | 'triangle' | 'spiral';
}

export const toolAtom = atom<ToolState>({
  tool: 'move',
  brush: { size: 0.08, feather: 0.5, flow: 1, density: 1, autoMask: false, erase: false },
  activeMaskId: null,
  activeLayerId: null,
  healSource: 'auto',
  healSourcePoint: null,
  spotMode: false,
  guidesMode: 'off',
});

export const patchToolAtom = atom(null, (get, set, patch: Partial<ToolState>) => {
  set(toolAtom, { ...get(toolAtom), ...patch });
});

export const patchBrushAtom = atom(null, (get, set, patch: Partial<ToolState['brush']>) => {
  const cur = get(toolAtom);
  set(toolAtom, { ...cur, brush: { ...cur.brush, ...patch } });
});

/* ------------------------------------------------------------ stage state */

export interface StageState {
  /** normalised cursor position in image space, or null */
  cursor: { x: number; y: number } | null;
  /** pixel readout under the cursor (display-referred 0..255) */
  readout: { r: number; g: number; b: number; l: number } | null;
  dragging: boolean;
  painting: boolean;
  /** strokes accumulated during the current paint gesture */
  strokePoints: { x: number; y: number; r: number }[];
}

export const stageAtom = atom<StageState>({
  cursor: null,
  readout: null,
  dragging: false,
  painting: false,
  strokePoints: [],
});

export const patchStageAtom = atom(null, (get, set, patch: Partial<StageState>) => {
  set(stageAtom, { ...get(stageAtom), ...patch });
});

/* ------------------------------------------------------------- view maths */

/**
 * Published by `useEngineStage` every time the stage lays out (zoom, pan,
 * resize, crop change). Overlays — detection boxes, mask pins, guides — read
 * this to place themselves in canvas space without re-rendering per frame
 * during a drag.
 */
export const viewMathAtom = atom<ViewMath | null>(null);

/* ------------------------------------------------------------------ helper */

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cur = out[k];
      out[k] =
        cur && typeof cur === 'object' && !Array.isArray(cur)
          ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
          : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}
