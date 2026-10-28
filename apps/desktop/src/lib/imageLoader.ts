/**
 * Preview tiers + decoded-image cache (§5.3, §6).
 *
 * Tiers:  thumb 256 · standard 1440–2048 · smart 2560 · 1:1 (native) · edit
 * proxy 2048. Every cached bitmap is byte-accounted in an `LruPool`, so the
 * Memory HUD shows real numbers and pressure relief has something to evict.
 *
 * The grid renders straight from `<img src>` (the HTTP cache does that job);
 * this loader feeds the engine, the analysis worker and the exporter.
 */

import { LruPool, MB, PRIORITY, type PoolStats, type Priority } from '@swell/shared';
import type { Photo } from '@swell/schema';

export type PreviewTier = 'thumb' | 'proxy' | 'standard' | 'smart' | 'native';

export const TIER_LONG_EDGE: Record<PreviewTier, number> = {
  thumb: 256,
  proxy: 2048,
  standard: 1600,
  smart: 2560,
  native: Number.MAX_SAFE_INTEGER,
};

const POOL_FOR: Record<PreviewTier, 'thumbs' | 'standard' | 'decoded'> = {
  thumb: 'thumbs',
  proxy: 'standard',
  standard: 'standard',
  smart: 'standard',
  native: 'decoded',
};

const key = (src: string, tier: PreviewTier) => `${src}@${tier}`;

class ImageLoader {
  private pools = {
    thumbs: new LruPool<ImageBitmap>('thumbs', 256 * MB, (b) => b.close()),
    standard: new LruPool<ImageBitmap>('standard', 768 * MB, (b) => b.close()),
    decoded: new LruPool<ImageBitmap>('decoded', 512 * MB, (b) => b.close()),
  };
  private blobs = new Map<string, Blob>();
  private inflight = new Map<string, Promise<ImageBitmap>>();
  private dims = new Map<string, { width: number; height: number }>();

  /** Fetch (once) and remember the file bytes. */
  private async blobFor(src: string): Promise<Blob> {
    const hit = this.blobs.get(src);
    if (hit) return hit;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to load ${src}: ${res.status}`);
    const blob = await res.blob();
    if (this.blobs.size > 64) {
      const oldest = this.blobs.keys().next().value;
      if (oldest) this.blobs.delete(oldest);
    }
    this.blobs.set(src, blob);
    return blob;
  }

  private async nativeSize(src: string): Promise<{ width: number; height: number }> {
    const cached = this.dims.get(src);
    if (cached) return cached;
    const blob = await this.blobFor(src);
    const bmp = await createImageBitmap(blob);
    const d = { width: bmp.width, height: bmp.height };
    bmp.close();
    this.dims.set(src, d);
    return d;
  }

  /**
   * Get a bitmap at the requested tier. Cache hit → synchronous-ish resolve.
   * `priority` decides eviction order: the visible photo is `current`, its
   * neighbours are `neighbour`, background work is `background`.
   */
  async load(src: string, tier: PreviewTier, priority: Priority = PRIORITY.background): Promise<ImageBitmap> {
    const k = key(src, tier);
    const pool = this.pools[POOL_FOR[tier]];
    const hit = pool.get(k);
    if (hit) {
      pool.setPriority(k, priority);
      return hit;
    }
    const running = this.inflight.get(k);
    if (running) return running;

    const p = (async () => {
      const blob = await this.blobFor(src);
      const maxEdge = TIER_LONG_EDGE[tier];
      let bmp: ImageBitmap;
      if (maxEdge === Number.MAX_SAFE_INTEGER) {
        bmp = await createImageBitmap(blob);
      } else {
        const { width, height } = await this.nativeSize(src);
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        bmp =
          scale < 1
            ? await createImageBitmap(blob, {
                resizeWidth: Math.max(1, Math.round(width * scale)),
                resizeHeight: Math.max(1, Math.round(height * scale)),
                resizeQuality: 'high',
              })
            : await createImageBitmap(blob);
      }
      pool.set(k, bmp, bmp.width * bmp.height * 4, priority);
      this.inflight.delete(k);
      return bmp;
    })();

    this.inflight.set(k, p);
    return p;
  }

  /** Convenience: load by photo record. */
  loadPhoto(photo: Photo, tier: PreviewTier, priority?: Priority): Promise<ImageBitmap> {
    return this.load(photo.src, tier, priority);
  }

  /** CPU-side pixels (analysis, inpainting, matte work). */
  async imageData(src: string, longEdge = 512): Promise<ImageData> {
    const { width, height } = await this.nativeSize(src);
    const scale = Math.min(1, longEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const blob = await this.blobFor(src);
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      throw new Error('2D context unavailable');
    }
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    bmp.close();
    return data;
  }

  /** Prefetch ±N neighbours so arrow-key navigation never stalls (§6.3). */
  async prefetch(sources: string[], tier: PreviewTier, priority: Priority = PRIORITY.neighbour): Promise<void> {
    await Promise.all(sources.map((s) => this.load(s, tier, priority).catch(() => undefined)));
  }

  stats(): PoolStats[] {
    return [this.pools.thumbs.stats(), this.pools.standard.stats(), this.pools.decoded.stats()];
  }

  setBudgets(mb: { thumbs?: number; standard?: number; decoded?: number }): void {
    if (mb.thumbs) this.pools.thumbs.budget = mb.thumbs * MB;
    if (mb.standard) this.pools.standard.budget = mb.standard * MB;
    if (mb.decoded) this.pools.decoded.budget = mb.decoded * MB;
  }

  clear(): void {
    for (const p of Object.values(this.pools)) p.clear();
    this.blobs.clear();
  }

  totalBytes(): number {
    return this.pools.thumbs.bytes + this.pools.standard.bytes + this.pools.decoded.bytes;
  }
}

export const imageLoader = new ImageLoader();
export default imageLoader;
