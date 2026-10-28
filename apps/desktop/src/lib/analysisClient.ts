/**
 * Analysis client — owns the worker pool and the index queue (§8.2, §8.6).
 *
 * Concurrency follows §6.5: `cores − 2`, clamped to at least 1. Results land
 * straight in the catalog store; the activity centre shows queue progress.
 */

import { hammingDistance, cosine, photoVector, type ImageFeatures } from '@swell/shared';
import type { Detection, Photo, PhotoFeatures } from '@swell/schema';
import { useCatalog } from '@/state/catalog.ts';
import type { AnalysisIn, AnalysisOut } from '@/workers/analysis.worker.ts';

type Job = { photoId: string; src: string; kind: 'analyze' | 'matte'; resolve: (v: unknown) => void; reject: (e: Error) => void };

export class AnalysisClient {
  private workers: Worker[] = [];
  private free: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<Worker, Job>();
  private matteWaiters = new Map<string, (m: PhotoFeatures | null) => void>();
  readonly concurrency: number;
  private taskId = 'task-index';

  constructor() {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.concurrency = Math.max(1, Math.min(4, cores - 2));
  }

  private ensureWorkers() {
    if (this.workers.length) return;
    for (let i = 0; i < this.concurrency; i++) {
      const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<AnalysisOut>) => this.onMessage(w, e.data);
      w.onerror = (e) => {
        const job = this.pending.get(w);
        this.pending.delete(w);
        job?.reject(new Error(e.message || 'analysis worker crashed'));
        this.free.push(w);
        this.drain();
      };
      this.workers.push(w);
      this.free.push(w);
    }
  }

  private onMessage(w: Worker, msg: AnalysisOut) {
    const job = this.pending.get(w);
    this.pending.delete(w);
    this.free.push(w);

    if (msg.type === 'features') {
      const cat = useCatalog.getState();
      cat.setFeatures(msg.photoId, msg.features);
      // concept hits become searchable detections, alongside the seeded ones
      const extra: Detection[] = msg.concepts
        .filter((c) => c.score > 0.3)
        .map((c, i) => ({
          id: `det-c-${msg.photoId}-${i}`,
          photoId: msg.photoId,
          kind: 'attribute' as const,
          label: c.label,
          score: c.score,
          modelVer: msg.features.modelVer,
          provider: 'heuristic' as const,
        }));
      const existing = (cat.detections[msg.photoId] ?? []).filter((d) => !d.id.startsWith('det-c-'));
      cat.setDetections(msg.photoId, [...existing, ...extra]);
      job?.resolve(msg.features);
    } else if (msg.type === 'matte') {
      job?.resolve(msg.matte);
    } else if (msg.type === 'thumb') {
      job?.resolve(msg.bitmap);
    } else {
      job?.reject(new Error(msg.message));
    }
    this.drain();
  }

  private drain() {
    while (this.free.length && this.queue.length) {
      const w = this.free.shift()!;
      const job = this.queue.shift()!;
      this.pending.set(w, job);
      const msg: AnalysisIn =
        job.kind === 'analyze'
          ? { type: 'analyze', photoId: job.photoId, src: job.src }
          : { type: 'matte', photoId: job.photoId, src: job.src };
      w.postMessage(msg);
    }
  }

  private submit(job: Omit<Job, 'resolve' | 'reject'>): Promise<unknown> {
    this.ensureWorkers();
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      this.drain();
    });
  }

  /** Queue one photo for indexing. Resolves with its PhotoFeatures. */
  analyze(photoId: string, src: string): Promise<PhotoFeatures> {
    return this.submit({ photoId, src, kind: 'analyze' }) as Promise<PhotoFeatures>;
  }

  /** Compute a subject matte (Remove Background, subject mask). */
  matte(photoId: string, src: string): Promise<import('@swell/schema').MattePayload> {
    return this.submit({ photoId, src, kind: 'matte' }) as Promise<import('@swell/schema').MattePayload>;
  }

  /** Index the whole catalog (or a subset), reporting progress to the activity centre. */
  async indexAll(photos: Photo[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const cat = useCatalog.getState();
    cat.addTask({
      id: this.taskId,
      kind: 'index',
      label: `Indexing ${photos.length} photo${photos.length === 1 ? '' : 's'}`,
      state: 'running',
      total: photos.length,
      done: 0,
      startedAt: Date.now(),
      memoryHint: `${this.concurrency} worker${this.concurrency > 1 ? 's' : ''}`,
    });
    let done = 0;
    await Promise.all(
      photos.map((p) =>
        this.analyze(p.id, p.src)
          .catch(() => undefined)
          .then(() => {
            done++;
            onProgress?.(done, photos.length);
            cat.updateTask(this.taskId, { done });
          }),
      ),
    );
    cat.updateTask(this.taskId, { state: 'done', done: photos.length, finishedAt: Date.now() });
  }

  /** Re-index everything after a model version bump (§8.6). */
  reindexAll(photos: Photo[]): Promise<void> {
    return this.indexAll(photos);
  }

  stop() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.free = [];
    this.queue = [];
    this.pending.clear();
  }
}

export const analysisClient = new AnalysisClient();

/* -------------------------------------------------------------- similarity */

export interface DuplicateGroup {
  a: string;
  b: string;
  distance: number;
  similarity: number;
}

/** Perceptual duplicate finder (dHash, Hamming ≤ 10 ⇒ near duplicate). */
export function findDuplicates(features: Record<string, PhotoFeatures>, threshold = 10): DuplicateGroup[] {
  const ids = Object.keys(features);
  const out: DuplicateGroup[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const fa = features[ids[i]!]!;
      const fb = features[ids[j]!]!;
      let d = 99;
      try {
        d = hammingDistance(BigInt(`0x${fa.dhash}`), BigInt(`0x${fb.dhash}`));
      } catch {
        continue;
      }
      if (d <= threshold) {
        out.push({ a: ids[i]!, b: ids[j]!, distance: d, similarity: 1 - d / 64 });
      }
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}

function featuresToImage(f: PhotoFeatures): ImageFeatures {
  return {
    width: 0,
    height: 0,
    meanLuma: f.meanLuma,
    stdLuma: f.stdLuma,
    clippedHighlights: f.clippedHighlights,
    clippedShadows: f.clippedShadows,
    contrast: f.contrast,
    sharpness: f.sharpness,
    blurScore: f.blurScore,
    skinRatio: f.skinRatio,
    skyRatio: f.skyRatio,
    greenRatio: f.greenRatio,
    warmCool: f.warmCool,
    horizonTilt: f.horizonTilt,
    edgeDensity: f.edgeDensity,
    saturationMean: f.saturationMean,
    isMonochrome: f.isMonochrome,
    exposureScore: f.exposureScore,
    palette: f.palette.map((c) => ({ oklch: { l: c.l, c: c.c, h: c.h }, css: c.css, weight: c.weight })),
    lumaHistogram: new Float32Array(256),
    rgbHistogram: new Float32Array(768),
    dhash: f.dhash,
    ahash: f.ahash,
    ruleOfThirds: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    provider: 'heuristic',
  };
}

export interface SimilarHit {
  id: string;
  score: number;
  why: { label: string; score: number }[];
}

/**
 * "Similar to this" / "search by example": cosine distance between concept
 * vectors built from the analysed features, with human-readable reasons.
 */
export function findSimilar(
  targetId: string,
  features: Record<string, PhotoFeatures>,
  detections: Record<string, Detection[]>,
  limit = 12,
): SimilarHit[] {
  const target = features[targetId];
  if (!target) return [];
  const tagsOf = (id: string) => (detections[id] ?? []).map((d) => d.label.toLowerCase());
  const tv = photoVector(featuresToImage(target), tagsOf(targetId));
  const out: SimilarHit[] = [];
  for (const [id, f] of Object.entries(features)) {
    if (id === targetId) continue;
    const v = photoVector(featuresToImage(f), tagsOf(id));
    const score = cosine(tv.values, v.values);
    const why = v.top
      .filter((c) => c.score > 0.25 && tv.top.some((t) => t.id === c.id && t.score > 0.25))
      .slice(0, 3)
      .map((c) => ({ label: c.id, score: c.score }));
    out.push({ id, score, why });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Search by dominant colour (OKLCH target from the colour picker). */
export function searchByColor(
  target: { h: number; c: number; l: number },
  features: Record<string, PhotoFeatures>,
  limit = 24,
): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const [id, f] of Object.entries(features)) {
    let best = 0;
    for (const sw of f.palette) {
      const dh = Math.abs(((sw.h - target.h + 540) % 360) - 180) / 180;
      const dc = Math.abs(sw.c - target.c) / 0.3;
      const dl = Math.abs(sw.l - target.l);
      const d = Math.sqrt(dh * dh * 0.9 + dc * dc * 0.5 + dl * dl * 1.2);
      best = Math.max(best, Math.max(0, 1 - d) * sw.weight);
    }
    if (best > 0.08) out.push({ id, score: best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
