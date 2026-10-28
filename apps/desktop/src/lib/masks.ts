/**
 * Mask helpers shared by the stage tools and the Layers/Mask inspectors.
 *
 * Masks are **vector parameters** (§6.4): strokes, gradient handles and range
 * definitions live in DevelopParams and are rasterised by the engine on every
 * render. Only AI mattes exist as bitmaps, and those are computed on demand by
 * the analysis worker, cached in `mattesAtom` and uploaded once.
 */

import { maskSchema, layerSchema, type Layer, type Mask } from '@swell/schema';
import { uid } from '@swell/shared';
import { editorStore, liveParamsAtom, patchLiveAtom, setLiveAtom, commitGestureAtom, mattesAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { analysisClient } from '@/lib/analysisClient.ts';
import { toast } from '@/state/toasts.ts';

export function emptyMask(kind: Mask['kind'], name?: string): Mask {
  return maskSchema.parse({
    kind,
    name: name ?? `${kind[0].toUpperCase()}${kind.slice(1)} mask`,
    invert: kind === 'background',
  });
}

export function emptyLayer(kind: Layer['kind'] = 'adjustment', name?: string): Layer {
  return layerSchema.parse({
    kind,
    name: name ?? (kind === 'adjustment' ? 'Adjustment' : kind === 'fill' ? 'Fill' : kind === 'image' ? 'Image' : 'Layer'),
  });
}

export const MASK_LABEL: Record<Mask['kind'], string> = {
  brush: 'Brush',
  linear: 'Linear gradient',
  radial: 'Radial gradient',
  luminance: 'Luminance range',
  color: 'Colour range',
  depth: 'Depth range',
  subject: 'Subject (AI)',
  sky: 'Sky (AI)',
  background: 'Background (AI)',
  people: 'People (AI)',
  object: 'Object (AI)',
};

export const AI_MASK_KINDS = ['subject', 'sky', 'background', 'people', 'object'] as const;

/** Add a layer to the live doc (top of the stack). */
export function addLayer(kind: Layer['kind'] = 'adjustment', name?: string): Layer {
  const live = editorStore.get(liveParamsAtom);
  const layer = { ...emptyLayer(kind, name), id: uid('layer') };
  editorStore.set(patchLiveAtom, { layers: [...live.params.layers, layer] });
  editorStore.set(commitGestureAtom, `Add ${kind} layer`);
  return layer;
}

export function removeLayer(layerId: string) {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(patchLiveAtom, { layers: live.params.layers.filter((l) => l.id !== layerId) });
  editorStore.set(commitGestureAtom, 'Delete layer');
}

export function updateLayer(layerId: string, patch: Partial<Layer>, label?: string) {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(patchLiveAtom, {
    layers: live.params.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
  });
  if (label) editorStore.set(commitGestureAtom, label);
}

/** Replace a layer's local adjustments without touching its masks. */
export function updateLayerAdjust(layerId: string, patch: Partial<Layer['adjust']>) {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(patchLiveAtom, {
    layers: live.params.layers.map((l) => (l.id === layerId ? { ...l, adjust: { ...l.adjust, ...patch } } : l)),
  });
}

export function reorderLayer(layerId: string, delta: number) {
  const live = editorStore.get(liveParamsAtom);
  const layers = [...live.params.layers];
  const i = layers.findIndex((l) => l.id === layerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  editorStore.set(setLiveAtom, { ...live.params, layers });
  editorStore.set(commitGestureAtom, 'Reorder layer');
}

export function mergeDown(layerId: string) {
  const live = editorStore.get(liveParamsAtom);
  const layers = [...live.params.layers];
  const i = layers.findIndex((l) => l.id === layerId);
  if (i <= 0) return;
  const top = layers[i]!;
  const below = layers[i - 1]!;
  const merged: Layer = {
    ...below,
    name: below.name,
    opacity: Math.round((below.opacity / 100) * (top.opacity / 100) * 100),
    masks: [...below.masks, ...top.masks],
    adjust: {
      ...below.adjust,
      exposure: below.adjust.exposure + top.adjust.exposure,
      contrast: below.adjust.contrast + top.adjust.contrast,
      highlights: below.adjust.highlights + top.adjust.highlights,
      shadows: below.adjust.shadows + top.adjust.shadows,
      vibrance: below.adjust.vibrance + top.adjust.vibrance,
      saturation: below.adjust.saturation + top.adjust.saturation,
    },
  };
  layers.splice(i - 1, 2, merged);
  editorStore.set(setLiveAtom, { ...live.params, layers });
  editorStore.set(commitGestureAtom, 'Merge down');
}

export function flattenLayers() {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(setLiveAtom, { ...live.params, layers: [] });
  editorStore.set(commitGestureAtom, 'Flatten (layers discarded)');
}

/* ------------------------------------------------------------------ masks */

export function addMask(layerId: string, kind: Mask['kind']): Mask {
  const live = editorStore.get(liveParamsAtom);
  const mask = { ...emptyMask(kind), id: uid('mask') };
  editorStore.set(patchLiveAtom, {
    layers: live.params.layers.map((l) => (l.id === layerId ? { ...l, masks: [...l.masks, mask] } : l)),
  });
  editorStore.set(commitGestureAtom, `Add ${MASK_LABEL[kind] ?? kind}`);
  return mask;
}

export function removeMask(layerId: string, maskId: string) {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(patchLiveAtom, {
    layers: live.params.layers.map((l) =>
      l.id === layerId ? { ...l, masks: l.masks.filter((m) => m.id !== maskId) } : l,
    ),
  });
  editorStore.set(commitGestureAtom, 'Delete mask');
}

export function updateMask(layerId: string, maskId: string, patch: Partial<Mask>, label?: string) {
  const live = editorStore.get(liveParamsAtom);
  editorStore.set(patchLiveAtom, {
    layers: live.params.layers.map((l) =>
      l.id === layerId ? { ...l, masks: l.masks.map((m) => (m.id === maskId ? { ...m, ...patch } : m)) } : l,
    ),
  });
  if (label) editorStore.set(commitGestureAtom, label);
}

/**
 * Ask the worker for a matte. Returns quickly when it is already cached; the
 * engine re-renders when the matte lands (useEngineStage watches mattesAtom).
 */
export async function requestMatte(photoId: string, kind: 'subject' | 'sky' | 'background' = 'subject') {
  const key = `${photoId}:${kind}`;
  const have = editorStore.get(mattesAtom)[key];
  if (have) return have;
  const photo = useCatalog.getState().photos[photoId];
  if (!photo) return null;
  try {
    const matte = await analysisClient.matte(photoId, photo.src);
    const keyed = { ...matte, id: key };
    editorStore.set(mattesAtom, { ...editorStore.get(mattesAtom), [key]: keyed });
    return keyed;
  } catch (err) {
    toast.warn('Mask could not be computed', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** One-click AI mask on a (new if needed) adjustment layer. */
export async function addAiMask(kind: (typeof AI_MASK_KINDS)[number], layerId?: string) {
  const live = editorStore.get(liveParamsAtom);
  const photoId = live.photoId || useCatalog.getState().activeId() || '';
  let target = layerId;
  if (!target) {
    const layer = addLayer('adjustment', `${MASK_LABEL[kind]} adjustment`);
    target = layer.id;
  }
  addMask(target, kind);
  if (kind === 'subject' || kind === 'sky' || kind === 'background') {
    toast.info(`Selecting ${kind}`, 'On-device segmentation — nothing leaves this machine.');
    await requestMatte(photoId, kind === 'sky' ? 'subject' : kind === 'background' ? 'subject' : 'subject');
  }
  return target;
}
