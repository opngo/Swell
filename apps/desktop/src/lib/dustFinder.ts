/**
 * Dust / spot finder — the catalog-wide dust map (§4.7). Sensor dust shows up as small, low-contrast,
 * roughly circular blobs that sit *below* their local surround — the opposite
 * of an edge. We score exactly that on a downscaled frame.
 *
 * Cheap enough to run on demand (512 px ≈ 4 ms) when Spot Visualization is
 * toggled with `A`; the real implementation would run in the analysis worker
 * against the 1:1 preview.
 */

export interface Spot {
  /** normalised source coords */
  x: number;
  y: number;
  /** normalised radius */
  r: number;
  /** 0..1 confidence */
  score: number;
}

export function findDust(img: ImageData, sensitivity = 0.5): Spot[] {
  const { width: w, height: h, data } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    gray[i] = (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
  }

  // local mean over a 9×9 box (separable)
  const radius = 4;
  const tmp = new Float32Array(w * h);
  const mean = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += gray[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (radius * 2 + 1);
      const add = gray[y * w + Math.min(w - 1, x + radius + 1)]!;
      const sub = gray[y * w + Math.max(0, x - radius)]!;
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      mean[y * w + x] = acc / (radius * 2 + 1);
      acc += tmp[Math.min(h - 1, y + radius + 1) * w + x]! - tmp[Math.max(0, y - radius) * w + x]!;
    }
  }

  const threshold = 0.055 - sensitivity * 0.04;
  const candidates: { x: number; y: number; deficit: number }[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const deficit = mean[i]! - gray[i]!;
      if (deficit < threshold) continue;
      // must be a local minimum of the deficit field (blob centre)
      let isPeak = true;
      for (let dy = -2; dy <= 2 && isPeak; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const j = (y + dy) * w + (x + dx);
          if (j < 0 || j >= w * h) continue;
          if (mean[j]! - gray[j]! > deficit) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) candidates.push({ x, y, deficit });
    }
  }

  // non-maximum suppression: keep the strongest within a 2 % radius
  candidates.sort((a, b) => b.deficit - a.deficit);
  const kept: Spot[] = [];
  const minDist = Math.max(4, Math.round(Math.min(w, h) * 0.02));
  for (const c of candidates) {
    if (kept.some((k) => Math.hypot(k.x * w - c.x, k.y * h - c.y) < minDist)) continue;
    kept.push({
      x: c.x / w,
      y: c.y / h,
      r: (minDist / 2 / w) * (0.8 + Math.min(1, c.deficit * 6)),
      score: Math.min(1, c.deficit / (threshold * 3)),
    });
    if (kept.length >= 64) break;
  }
  return kept;
}
