/**
 * Stage ↔ source coordinate maths (§4.4, Appendix A).
 *
 * Every tool — brush, heal, gradient handles, detection boxes, the eyedropper —
 * goes through these functions, and the shader walks the same chain
 * (view → crop → rotate → source). If these disagree with `mapUv` in
 * `output.frag`, a stroke lands on the wrong pixel, so the round-trip is the
 * property that matters most.
 */

import { describe, expect, it } from 'vitest';
import {
  brushRadiusSource,
  canvasToSource,
  clientToSource,
  fitCanvas,
  makeViewMath,
  sourceToCanvas,
  viewRect,
  type CropRect,
  type ViewMath,
} from '@/editor/coords.ts';

const crop = (over: Partial<CropRect> = {}): CropRect => ({
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  angle: 0,
  flipH: false,
  flipV: false,
  ...over,
});

/** A 3:2 frame filling the stage, no crop, no rotation. */
const vm = (over: Partial<CropRect> = {}, zoom = 1, panX = 0, panY = 0, box = [900, 600] as const): ViewMath =>
  makeViewMath(box[0], box[1], 6000, 4000, crop(over), zoom, panX, panY, 2);

describe('fitCanvas', () => {
  it('contain-fits a wide image inside a square box', () => {
    const f = fitCanvas(500, 500, 1.5, 1, 1);
    expect(f.canvasW).toBeCloseTo(476, 0); // 500 − 24 padding
    expect(f.canvasH).toBeCloseTo(476 / 1.5, 4);
  });

  it('contain-fits a tall image by height instead', () => {
    const f = fitCanvas(500, 500, 0.5, 1, 1);
    expect(f.canvasH).toBeCloseTo(476, 0);
    expect(f.canvasW).toBeCloseTo(238, 0);
  });

  it('zoom scales the element, dpr scales the backing store', () => {
    const one = fitCanvas(800, 600, 1.5, 1, 2);
    const two = fitCanvas(800, 600, 1.5, 2, 2);
    expect(two.canvasW).toBeCloseTo(one.canvasW * 2, 6);
    expect(two.canvasH).toBeCloseTo(one.canvasH * 2, 6);
    expect(one.bufferW).toBe(Math.round(one.canvasW * 2));
    expect(one.bufferH).toBe(Math.round(one.canvasH * 2));
  });

  it('keeps at least one pixel however small the box', () => {
    const f = fitCanvas(4, 4, 1.5, 0.01, 1);
    expect(f.canvasW).toBeGreaterThan(0);
    expect(f.bufferW).toBeGreaterThanOrEqual(1);
    expect(f.bufferH).toBeGreaterThanOrEqual(1);
  });

  it('never changes the aspect ratio', () => {
    for (const zoom of [0.25, 1, 3.7]) {
      const f = fitCanvas(1200, 700, 6000 / 4000, zoom, 2);
      expect(f.canvasW / f.canvasH).toBeCloseTo(1.5, 5);
    }
  });
});

describe('viewRect', () => {
  it('shows the whole crop at 100 %', () => {
    expect(viewRect(1, 0, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('halves the visible rect at 200 % and keeps it inside the crop', () => {
    const v = viewRect(2, 0, 0);
    expect(v.w).toBeCloseTo(0.5);
    expect(v.h).toBeCloseTo(0.5);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x).toBeLessThanOrEqual(0.5);
  });

  it('panning moves the rect but never past the edge', () => {
    const left = viewRect(4, -0.5, 0);
    const centre = viewRect(4, 0, 0);
    const right = viewRect(4, 0.5, 0);
    expect(left.x).toBeLessThan(centre.x);
    expect(centre.x).toBeLessThan(right.x);
    for (const v of [left, centre, right, viewRect(4, -50, 50)]) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y + v.h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('below 100 % the view is larger than the crop and stays anchored', () => {
    const v = viewRect(0.5, 0.2, -0.3);
    expect(v.w).toBeCloseTo(2);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('survives absurd zoom values', () => {
    expect(viewRect(0, 0, 0).w).toBeLessThanOrEqual(10001);
    expect(viewRect(1e6, 0, 0).w).toBeGreaterThan(0);
    expect(Number.isFinite(viewRect(1e6, 0, 0).x)).toBe(true);
  });
});

describe('makeViewMath', () => {
  it('derives the crop aspect from crop size and source size', () => {
    // A 4000×3000 source cropped to half width and a quarter height:
    // (0.5·4000) / (0.25·3000) = 2000/750
    const m = makeViewMath(900, 600, 4000, 3000, crop({ w: 0.5, h: 0.25 }), 1, 0, 0, 2);
    expect(m.cropAspect).toBeCloseTo(2000 / 750, 6);
    expect(m.zoom).toBe(1);
    expect(m.dpr).toBe(2);
    expect(m.view).toEqual(viewRect(1, 0, 0));
    expect(m.canvasW / m.canvasH).toBeCloseTo(m.cropAspect, 5);
  });

  it('a square crop of a 3:2 source is square on screen', () => {
    const m = makeViewMath(900, 600, 6000, 4000, crop({ x: 0.25, y: 0.1, w: 0.2, h: 0.3 }), 1, 0, 0, 1);
    expect(m.cropAspect).toBeCloseTo(1, 6);
    expect(m.canvasW).toBeCloseTo(m.canvasH, 6);
  });

  it('exposes the crop it was given', () => {
    const c = crop({ angle: 12, flipH: true });
    expect(makeViewMath(400, 300, 1000, 1000, c, 1, 0, 0, 1).crop).toBe(c);
  });
});

describe('canvasToSource / sourceToCanvas', () => {
  it('maps the corners and the centre for an uncropped frame', () => {
    const m = vm();
    expect(canvasToSource(m, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(canvasToSource(m, 1, 1)).toEqual({ x: 1, y: 1 });
    const c = canvasToSource(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });

  it('maps into the crop rectangle, not the whole file', () => {
    const m = vm({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    const tl = canvasToSource(m, 0, 0);
    const br = canvasToSource(m, 1, 1);
    expect(tl.x).toBeCloseTo(0.25, 6);
    expect(tl.y).toBeCloseTo(0.25, 6);
    expect(br.x).toBeCloseTo(0.75, 6);
    expect(br.y).toBeCloseTo(0.75, 6);
  });

  it('zooming in maps the canvas corner to a point inside the crop', () => {
    const m = vm({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2);
    const tl = canvasToSource(m, 0, 0);
    expect(tl.x).toBeGreaterThan(0.25);
    expect(tl.x).toBeLessThan(0.5);
    // The centre of the canvas is still the centre of the crop.
    const c = canvasToSource(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });

  it('rotation keeps the centre fixed and swings the corners', () => {
    const level = vm();
    const tilted = vm({ angle: 30 });
    for (const m of [level, tilted]) {
      const c = canvasToSource(m, 0.5, 0.5);
      expect(c.x).toBeCloseTo(0.5, 6);
      expect(c.y).toBeCloseTo(0.5, 6);
    }
    const a = canvasToSource(level, 1, 0.5);
    const b = canvasToSource(tilted, 1, 0.5);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.05);
  });

  it('flips mirror inside the crop, not the whole file', () => {
    const m = vm({ x: 0.2, y: 0.1, w: 0.6, h: 0.8, flipH: true });
    const left = canvasToSource(m, 0, 0.5);
    expect(left.x).toBeCloseTo(0.8, 6); // crop.x + crop.w
    const both = vm({ x: 0.2, y: 0.1, w: 0.6, h: 0.8, flipH: true, flipV: true });
    const corner = canvasToSource(both, 0, 0);
    expect(corner.x).toBeCloseTo(0.8, 6);
    expect(corner.y).toBeCloseTo(0.9, 6);
  });

  it('round-trips for every combination of crop, rotation, flip and zoom', () => {
    const cases: { over: Partial<CropRect>; zoom: number; pan: [number, number] }[] = [
      { over: {}, zoom: 1, pan: [0, 0] },
      { over: { x: 0.1, y: 0.2, w: 0.7, h: 0.5 }, zoom: 1, pan: [0, 0] },
      { over: { angle: 45 }, zoom: 2, pan: [0.1, -0.2] },
      { over: { angle: -17 }, zoom: 0.5, pan: [0, 0] },
      { over: { flipH: true }, zoom: 3, pan: [-0.25, 0.25] },
      { over: { flipV: true, angle: 90, x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, zoom: 1.5, pan: [0.05, 0.05] },
    ];
    for (const c of cases) {
      const m = vm(c.over, c.zoom, c.pan[0], c.pan[1]);
      for (const [cx, cy] of [
        [0, 0],
        [1, 1],
        [0.5, 0.5],
        [0.13, 0.77],
        [0.94, 0.06],
      ] as const) {
        const s = canvasToSource(m, cx, cy);
        const back = sourceToCanvas(m, s.x, s.y);
        expect(back.x, `${JSON.stringify(c.over)} @${cx},${cy}`).toBeCloseTo(cx, 6);
        expect(back.y, `${JSON.stringify(c.over)} @${cx},${cy}`).toBeCloseTo(cy, 6);
      }
    }
  });

  it('sourceToCanvas inverts a mask point back to the stage', () => {
    const m = vm({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, angle: 8 }, 2, 0.05, -0.05);
    const c = sourceToCanvas(m, 0.42, 0.63);
    expect(c.x).toBeGreaterThanOrEqual(-0.2);
    expect(c.x).toBeLessThanOrEqual(1.2);
    const s = canvasToSource(m, c.x, c.y);
    expect(s.x).toBeCloseTo(0.42, 6);
    expect(s.y).toBeCloseTo(0.63, 6);
  });
});

describe('clientToSource', () => {
  const rect = { left: 120, top: 80, width: 600, height: 400, right: 720, bottom: 480, x: 120, y: 80 } as DOMRect;

  it('agrees with canvasToSource for the same relative point', () => {
    const m = vm({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 1.5);
    const viaClient = clientToSource(m, rect, 120 + 0.3 * 600, 80 + 0.7 * 400);
    const viaCanvas = canvasToSource(m, 0.3, 0.7);
    expect(viaClient.x).toBeCloseTo(viaCanvas.x, 9);
    expect(viaClient.y).toBeCloseTo(viaCanvas.y, 9);
  });

  it('reports whether the pointer is over the canvas', () => {
    const m = vm();
    expect(clientToSource(m, rect, 420, 280).inside).toBe(true);
    expect(clientToSource(m, rect, 120, 80).inside).toBe(true); // exactly on the corner
    expect(clientToSource(m, rect, 720, 480).inside).toBe(true);
    expect(clientToSource(m, rect, 119, 280).inside).toBe(false);
    expect(clientToSource(m, rect, 420, 900).inside).toBe(false);
  });
});

describe('brushRadiusSource', () => {
  it('is the on-screen fraction at 100 % with no crop', () => {
    expect(brushRadiusSource(vm({}, 1), 0.1)).toBeCloseTo(0.1, 6);
  });

  it('shrinks in source units as you zoom in (the brush follows the cursor)', () => {
    const wide = brushRadiusSource(vm({}, 1), 0.2);
    const zoomed = brushRadiusSource(vm({}, 4), 0.2);
    expect(zoomed).toBeCloseTo(wide / 4, 6);
  });

  it('grows when the crop is smaller than the frame', () => {
    // Same screen size, but the crop covers only half the file: the brush has to
    // cover twice as much of the source to look the same size.
    const full = brushRadiusSource(vm({}, 1), 0.2);
    const cropped = brushRadiusSource(vm({ w: 0.5, h: 0.5 }, 1), 0.2);
    expect(cropped).toBeCloseTo(full * 2, 6);
  });

  it('stays finite and positive for a degenerate crop', () => {
    const r = brushRadiusSource(vm({ w: 0, h: 0 }, 1), 0.2);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0);
  });
});
