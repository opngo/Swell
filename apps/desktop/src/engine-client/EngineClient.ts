/**
 * EngineClient — the only thing the UI talks to (§5).
 *
 * In the browser build the engine lives on the main thread behind this class;
 * in the Electron build the exact same message protocol (`EngineCommand` /
 * `EngineEvent` from `@swell/schema`) crosses to a hidden renderer process or a
 * dedicated Worker with an OffscreenCanvas. Nothing above this line knows
 * which one it is, and **pixel data never travels as JSON** — sources and
 * mattes move as `ImageBitmap` / typed arrays.
 *
 * Responsibilities here:
 *   · coalesce param changes into at most one render per frame
 *   · rebuild curve LUTs only when the curve signature changes
 *   · publish histograms at ≤15 Hz and engine stats for the Memory HUD
 *   · fail loudly but safely: `ok === false` → the stage falls back to an
 *     unedited <img> and a toast explains why
 */

import {
  buildCurveLuts,
  lutsSignature,
  parseCube,
} from '@swell/shaders';
import type {
  CurveLuts,
  DevelopParams,
  EngineEvent,
  EngineStats,
  HistogramPayload,
  MattePayload,
  RenderRequest,
} from '@swell/schema';
import { RenderEngine } from '@engine/engine.ts';

type Listener = (e: EngineEvent) => void;

export interface EngineClientOptions {
  canvas: HTMLCanvasElement;
  proxyLongEdge?: number;
  fullLongEdge?: number;
  histogramHz?: number;
}

export class EngineClient {
  private engine: RenderEngine | null = null;
  private listeners = new Set<Listener>();
  private pending: RenderRequest | null = null;
  private raf = 0;
  private lastLutSignature = '';
  private luts: CurveLuts | null = null;
  private cubes = new Map<string, { size: number; data: Uint8Array }>();
  private sources = new Map<string, ImageBitmap>();
  private _ok = false;
  private _error: string | null = null;
  private frameBudgetMs = 16.7;
  private consecutiveSlow = 0;

  constructor(private opts: EngineClientOptions) {}

  get ok(): boolean {
    return this._ok;
  }
  get error(): string | null {
    return this._error;
  }
  get renderer(): string {
    return this.engine?.stats().renderer ?? 'none';
  }

  /** Returns false when WebGL2 is unavailable or a shader failed to compile. */
  init(): boolean {
    if (this._ok) return true;
    try {
      this.engine = new RenderEngine(this.opts.canvas, {
        proxyLongEdge: this.opts.proxyLongEdge ?? 2048,
        fullLongEdge: this.opts.fullLongEdge ?? 4096,
        histogramHz: this.opts.histogramHz ?? 15,
        onHistogram: (h) => this.emit({ type: 'histogram', photoId: this.pending?.photoId ?? '', histogram: h }),
        onError: (message) => {
          this._error = message;
          this.emit({ type: 'error', message });
        },
      });
      this._ok = true;
      this._error = null;
      this.emit({ type: 'ready', stats: this.stats() });
      return true;
    } catch (err) {
      this._ok = false;
      this._error = err instanceof Error ? err.message : String(err);
      this.engine = null;
      this.emit({ type: 'error', message: this._error });
      return false;
    }
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* a broken listener must not break the render loop */
      }
    }
  }

  /* ------------------------------------------------------------- sources */

  setSource(photoId: string, bitmap: ImageBitmap): void {
    this.sources.set(photoId, bitmap);
    this.engine?.setSource(photoId, bitmap);
  }

  hasSource(photoId: string): boolean {
    return this.sources.has(photoId);
  }

  setMatte(m: MattePayload): void {
    this.engine?.setMatte(m);
  }

  setImageLayer(layerId: string, bitmap: ImageBitmap): void {
    this.engine?.setImageLayer(layerId, bitmap);
  }

  setBackgroundImage(src: string, bitmap: ImageBitmap): void {
    this.engine?.setBackgroundImage(src, bitmap);
  }

  /** Import a .cube / .3dl profile; returns its grid size. */
  importCube(id: string, text: string): { size: number; title: string } | null {
    const parsed = parseCube(text);
    if (!parsed || parsed.size < 2) return null;
    this.cubes.set(id, { size: parsed.size, data: parsed.data });
    const info = this.engine?.loadCube(id, text) ?? { size: parsed.size, title: parsed.title || id };
    this.lastLutSignature = '';
    return info;
  }

  /* -------------------------------------------------------------- render */

  /**
   * Queue a render. Multiple calls inside one frame collapse to the last one —
   * that is the "one param diff per frame" rule from §5.2.
   */
  schedule(req: RenderRequest): void {
    if (!this._ok) return;
    this.pending = req;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  /** Render synchronously (used by capture + the first frame of a photo). */
  flush(): { ms: number } | null {
    const req = this.pending;
    if (!req || !this.engine || !this._ok) return null;
    this.pending = null;

    // rebuild LUTs only when curves/profiles actually changed
    const sig = this.signatureOf(req.params);
    if (sig !== this.lastLutSignature || !this.luts) {
      this.luts = this.buildLuts(req.params);
      this.lastLutSignature = sig;
    }
    req.luts = this.luts;

    const t0 = performance.now();
    try {
      const res = this.engine.render(req);
      const ms = performance.now() - t0;
      // adaptive quality: three slow frames in a row → stay on the proxy tier
      if (ms > this.frameBudgetMs * 2.2) {
        this.consecutiveSlow++;
        if (this.consecutiveSlow >= 3 && req.quality === 'full') this.emit({ type: 'error', message: 'slow-frames' });
      } else {
        this.consecutiveSlow = 0;
      }
      this.emit({ type: 'rendered', requestId: res.requestId, ms });
      return { ms };
    } catch (err) {
      this._ok = false;
      this._error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: this._error });
      return null;
    }
  }

  /**
   * Read one display-referred pixel back from the canvas (eyedropper, WB
   * sampling). Cheap: a 1×1 readPixels on the default framebuffer.
   */
  pickColor(cssX: number, cssY: number, canvas: HTMLCanvasElement): { r: number; g: number; b: number; l: number } | null {
    const engine = this.engine;
    if (!engine || !this._ok) return null;
    const gl = engine.gl;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const x = Math.floor(cssX * dpr);
    const y = Math.floor(canvas.height - cssY * dpr);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    const px = new Uint8Array(4);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } catch {
      return null;
    }
    const [r, g, b] = [px[0]! / 255, px[1]! / 255, px[2]! / 255];
    return { r: px[0]!, g: px[1]!, b: px[2]!, l: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  }

  /** Full-resolution pixels for export. Returns an ImageData the caller encodes. */
  capture(req: RenderRequest, width: number, height: number): ImageData | null {
    if (!this.engine || !this._ok) return null;
    const luts = this.buildLuts(req.params);
    try {
      return this.engine.capture({ ...req, luts, quality: 'full', fast: false }, width, height);
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  stats(): EngineStats {
    return (
      this.engine?.stats() ?? {
        backend: 'none',
        renderer: 'unavailable',
        textures: 0,
        textureBytes: 0,
        framebuffers: 0,
        lastRenderMs: 0,
        avgRenderMs: 0,
        fps: 0,
        passes: 0,
        droppedFrames: 0,
        workSize: { w: 0, h: 0 },
      }
    );
  }

  reportDrop(): void {
    this.engine?.reportDrop();
  }

  /** Free cached textures (called on memory pressure and when hiding the editor). */
  trim(): number {
    return this.engine?.trimCaches() ?? 0;
  }

  /** Curve + profile signature: what actually invalidates the uploaded LUTs. */
  private signatureOf(params: DevelopParams): string {
    return `${lutsSignature(params)}|${params.profile.lutId ?? ''}|${params.profile.lutAmount}`;
  }

  private buildLuts(params: DevelopParams): CurveLuts {
    const luts = buildCurveLuts(params);
    const cube = params.profile.lutId ? this.cubes.get(params.profile.lutId) ?? null : null;
    luts.cube = cube;
    luts.cubeAmount = params.profile.lutAmount / 100;
    return luts;
  }

  histogramNow(): HistogramPayload | null {
    return null; // histograms arrive through the `histogram` event
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pending = null;
    this.engine?.dispose();
    this.engine = null;
    this.sources.clear();
    this.cubes.clear();
    this.listeners.clear();
    this._ok = false;
  }
}

/** Build a render request from editor state (kept here so pages stay thin). */
export function makeRequest(
  base: Omit<RenderRequest, 'luts'>,
  params: DevelopParams,
  luts: CurveLuts | null,
): RenderRequest {
  return { ...base, params, luts: luts ?? EMPTY_LUTS } as RenderRequest;
}

const EMPTY_LUTS: CurveLuts = {
  luma: new Float32Array(0),
  rgb: new Float32Array(0),
  hue: new Float32Array(0),
  hue2: new Float32Array(0),
  hueSize: 0,
  size: 0,
  cube: null,
  cubeAmount: 1,
};

export type { EngineEvent, EngineStats };
