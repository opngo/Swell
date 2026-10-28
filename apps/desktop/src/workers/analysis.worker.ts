/**
 * Analysis worker (§8.1, §8.2).
 *
 * Everything here runs off the main thread: decode → features → palette →
 * perceptual hashes → concept vector → (optionally) a subject matte.
 * Pixels never leave the worker as JSON — only the small numeric summary does.
 *
 * The heuristic detectors in `@swell/shared` are the placeholder for the ONNX
 * models in `packages/models`; the message protocol is already the one the
 * model runtime will use, so swapping BiRefNet/SAM in only changes this file.
 */

import {
  analyzeImage,
  computeSubjectMatte,
  photoVector,
  resizeImageData,
  CONCEPT_BY_ID,
  type ImageFeatures,
} from '@swell/shared';
import type { MattePayload, PhotoFeatures } from '@swell/schema';

export type AnalysisIn =
  | { type: 'analyze'; photoId: string; src: string; longEdge?: number }
  | { type: 'matte'; photoId: string; src: string; size?: number; feather?: number; edgeShift?: number; centrePrior?: number }
  | { type: 'thumb'; photoId: string; src: string; longEdge: number };

export type AnalysisOut =
  | { type: 'features'; photoId: string; features: PhotoFeatures; concepts: { id: string; label: string; score: number }[]; durationMs: number }
  | { type: 'matte'; photoId: string; matte: MattePayload; durationMs: number }
  | { type: 'thumb'; photoId: string; bitmap: ImageBitmap; durationMs: number }
  | { type: 'error'; photoId: string; message: string };

const MODEL_VER = 'heuristic-1';

async function decode(src: string, longEdge: number): Promise<ImageData> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${src} → ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, longEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  let small = bmp;
  if (scale < 1) {
    small = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    bmp.close();
  }
  const canvas = new OffscreenCanvas(small.width, small.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context in worker');
  ctx.drawImage(small, 0, 0);
  const data = ctx.getImageData(0, 0, small.width, small.height);
  small.close();
  return data;
}

function toPhotoFeatures(photoId: string, f: ImageFeatures): PhotoFeatures {
  return {
    photoId,
    modelVer: MODEL_VER,
    meanLuma: f.meanLuma,
    stdLuma: f.stdLuma,
    contrast: f.contrast,
    sharpness: f.sharpness,
    blurScore: f.blurScore,
    exposureScore: f.exposureScore,
    clippedHighlights: f.clippedHighlights,
    clippedShadows: f.clippedShadows,
    skinRatio: f.skinRatio,
    skyRatio: f.skyRatio,
    greenRatio: f.greenRatio,
    warmCool: f.warmCool,
    horizonTilt: f.horizonTilt,
    edgeDensity: f.edgeDensity,
    saturationMean: f.saturationMean,
    isMonochrome: f.isMonochrome,
    palette: f.palette.map((c) => ({
      css: c.css,
      weight: c.weight,
      h: c.oklch.h,
      c: c.oklch.c,
      l: c.oklch.l,
    })),
    dhash: f.dhash,
    ahash: f.ahash,
    concepts: [],
    computedAt: Date.now(),
  };
}

self.onmessage = async (e: MessageEvent<AnalysisIn>) => {
  const msg = e.data;
  const t0 = performance.now();
  try {
    if (msg.type === 'analyze') {
      const img = await decode(msg.src, msg.longEdge ?? 640);
      const f = analyzeImage(img);
      const vec = photoVector(f, []);
      const concepts = vec.top
        .filter((c) => c.score > 0.18)
        .map((c) => ({ id: c.id, label: CONCEPT_BY_ID.get(c.id)?.label ?? c.id, score: c.score }));
      const features = toPhotoFeatures(msg.photoId, f);
      features.concepts = vec.top.map((c) => ({ id: c.id, score: c.score }));
      const out: AnalysisOut = {
        type: 'features',
        photoId: msg.photoId,
        features,
        concepts,
        durationMs: performance.now() - t0,
      };
      (self as unknown as Worker).postMessage(out);
      return;
    }

    if (msg.type === 'matte') {
      const img = await decode(msg.src, 512);
      const small = img.width > 384 ? resizeImageData(img, Math.round(img.width * (384 / img.width)), Math.round(img.height * (384 / img.width))) : img;
      const m = computeSubjectMatte(small, {
        size: msg.size ?? 256,
        feather: msg.feather ?? 0.4,
        edgeShift: msg.edgeShift ?? 0,
        centrePrior: msg.centrePrior ?? 0.72,
      });
      const alpha = new Uint8Array(m.alpha.length);
      alpha.set(m.alpha);
      const out: AnalysisOut = {
        type: 'matte',
        photoId: msg.photoId,
        matte: { id: `${msg.photoId}:subject`, width: m.width, height: m.height, alpha },
        durationMs: performance.now() - t0,
      };
      (self as unknown as Worker).postMessage(out, [alpha.buffer]);
      return;
    }

    if (msg.type === 'thumb') {
      const res = await fetch(msg.src);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, msg.longEdge / Math.max(bmp.width, bmp.height));
      const out =
        scale < 1
          ? await createImageBitmap(blob, {
              resizeWidth: Math.round(bmp.width * scale),
              resizeHeight: Math.round(bmp.height * scale),
              resizeQuality: 'high',
            })
          : bmp;
      if (out !== bmp) bmp.close();
      const message: AnalysisOut = { type: 'thumb', photoId: msg.photoId, bitmap: out, durationMs: performance.now() - t0 };
      (self as unknown as Worker).postMessage(message, [out]);
    }
  } catch (err) {
    const out: AnalysisOut = {
      type: 'error',
      photoId: 'photoId' in msg ? msg.photoId : '',
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(out);
  }
};
