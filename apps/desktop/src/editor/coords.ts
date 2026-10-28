/**
 * View maths shared by the stage, the overlays and the tools.
 *
 * The output shader maps canvas UVs through  view → crop → rotate → source
 * (`mapUv` in `output.frag`). Everything here mirrors that transform exactly,
 * so a brush stroke, a heal click and a detection box all land on the same
 * pixel the shader is drawing.
 */

import type { ViewRect } from '@swell/schema';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  flipH: boolean;
  flipV: boolean;
}

export interface ViewMath {
  /** CSS size of the canvas element */
  canvasW: number;
  canvasH: number;
  /** backing-store size */
  bufferW: number;
  bufferH: number;
  view: ViewRect;
  zoom: number;
  crop: CropRect;
  cropAspect: number;
  dpr: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Contain-fit a rect of `aspect` inside a box, then apply zoom. */
export function fitCanvas(
  boxW: number,
  boxH: number,
  aspect: number,
  zoom: number,
  dpr: number,
): { canvasW: number; canvasH: number; bufferW: number; bufferH: number } {
  const pad = 24;
  const w = Math.max(1, boxW - pad);
  const h = Math.max(1, boxH - pad);
  let cw = w;
  let ch = w / aspect;
  if (ch > h) {
    ch = h;
    cw = h * aspect;
  }
  cw *= zoom;
  ch *= zoom;
  return {
    canvasW: cw,
    canvasH: ch,
    bufferW: Math.max(1, Math.round(cw * dpr)),
    bufferH: Math.max(1, Math.round(ch * dpr)),
  };
}

/** pan is a −0.5…0.5 offset of the *visible* rect centre inside the crop. */
export function viewRect(zoom: number, panX: number, panY: number): ViewRect {
  const size = 1 / Math.max(zoom, 0.0001);
  const x = clamp01(0.5 + panX - size / 2);
  const y = clamp01(0.5 + panY - size / 2);
  // Never pan past the edge of the crop; below 100 % the view is larger than the
  // crop, so it stays anchored at 0 and the backdrop shows around the image.
  return {
    x: Math.min(x, Math.max(0, 1 - size)),
    y: Math.min(y, Math.max(0, 1 - size)),
    w: size,
    h: size,
  };
}

export function makeViewMath(
  boxW: number,
  boxH: number,
  srcW: number,
  srcH: number,
  crop: CropRect,
  zoom: number,
  panX: number,
  panY: number,
  dpr: number,
): ViewMath {
  const cropAspect = (crop.w * srcW) / Math.max(crop.h * srcH, 1e-4);
  const fit = fitCanvas(boxW, boxH, cropAspect, zoom, dpr);
  return {
    ...fit,
    view: viewRect(zoom, panX, panY),
    zoom,
    crop,
    cropAspect,
    dpr,
  };
}

/** Canvas-relative (0..1) point → normalised SOURCE coords (0..1, y down). */
export function canvasToSource(vm: ViewMath, cx: number, cy: number): { x: number; y: number } {
  const { view, crop, cropAspect } = vm;
  const px = view.x + cx * view.w;
  const py = view.y + cy * view.h;
  let rx = (px - 0.5) * cropAspect;
  let ry = py - 0.5;
  const rot = (crop.angle * Math.PI) / 180;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const nx = rx * cs - ry * sn;
  const ny = rx * sn + ry * cs;
  rx = nx / Math.max(cropAspect, 1e-4);
  ry = ny;
  let sx = crop.x + (rx + 0.5) * crop.w;
  let sy = crop.y + (ry + 0.5) * crop.h;
  if (crop.flipH) sx = crop.x + crop.w - (sx - crop.x);
  if (crop.flipV) sy = crop.y + crop.h - (sy - crop.y);
  return { x: sx, y: sy };
}

/** Normalised SOURCE coords → canvas-relative (0..1). Inverse of the above. */
export function sourceToCanvas(vm: ViewMath, sx: number, sy: number): { x: number; y: number } {
  const { view, crop, cropAspect } = vm;
  let x = sx;
  let y = sy;
  if (crop.flipH) x = crop.x + crop.w - (x - crop.x);
  if (crop.flipV) y = crop.y + crop.h - (y - crop.y);
  let rx = (x - crop.x) / Math.max(crop.w, 1e-6) - 0.5;
  let ry = (y - crop.y) / Math.max(crop.h, 1e-6) - 0.5;
  rx *= cropAspect;
  const rot = (-crop.angle * Math.PI) / 180;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const nx = rx * cs - ry * sn;
  const ny = rx * sn + ry * cs;
  rx = nx / Math.max(cropAspect, 1e-4);
  ry = ny;
  const px = rx + 0.5;
  const py = ry + 0.5;
  return { x: (px - view.x) / view.w, y: (py - view.y) / view.h };
}

/** Client (page) coords → normalised source coords, given the canvas rect. */
export function clientToSource(
  vm: ViewMath,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { x: number; y: number; inside: boolean } {
  const cx = (clientX - rect.left) / rect.width;
  const cy = (clientY - rect.top) / rect.height;
  const s = canvasToSource(vm, cx, cy);
  return { ...s, inside: cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1 };
}

/** Brush radius in source-normalised units from a fraction of the view width. */
export function brushRadiusSource(vm: ViewMath, sizeFraction: number): number {
  return (sizeFraction * vm.view.w) / Math.max(vm.crop.w, 1e-4);
}
