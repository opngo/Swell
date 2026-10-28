/**
 * RenderEngine — the WebGL2 image pipeline (§5).
 *
 *   source(sRGB8) → linearise(Rec.2020 f16) → removals → blur pyramid
 *                 → mask atlas → develop → output(display) → canvas
 *                                                      ↘ stats FBO → histogram
 *
 * Design rules honoured here:
 *   • one render per animation frame, latest-wins (see engine-client)
 *   • textures/framebuffers come from a size-classed pool and are destroy()ed
 *   • removals are cached by hash because they are evaluated on the source
 *   • masks are cached by hash and re-rendered into an atlas tile
 *   • the histogram is read back at ≤ 15 Hz from a downsampled target
 */

import type {
  BackgroundState,
  BeforeAfterState,
  CurveLuts,
  DevelopParams,
  HistogramPayload,
  MattePayload,
  OverlayState,
  RenderRequest,
  SoftProofState,
  EngineStats,
} from '@swell/schema';
import {
  BLUR_FRAG,
  DEVELOP_FRAG,
  LINEARIZE_FRAG,
  MASK_FRAG,
  MASK_TILES,
  MASK_TILE_W,
  OUTPUT_FRAG,
  QUAD_VERT,
  REMOVAL_FRAG,
  parseCube,
} from '@swell/shaders';
import { fnv1a } from '@swell/shared';
import {
  GpuTexture,
  TexturePool,
  bind,
  createProgram,
  createTexture3D,
  setUniforms,
  supportsHalfFloatRender,
  type GL,
  type Program,
} from './gl.ts';
import {
  BG_KIND,
  BEFORE_AFTER_MODE,
  CLIPPING_MODE,
  calibrationMatrix,
  geometryMatrix,
  packLayers,
  proofMatrices,
  strokeCircles,
  toDisplayRgb,
  wbGain,
  type MaskDraw,
} from './uniforms.ts';

export type EngineOptions = {
  proxyLongEdge?: number;
  fullLongEdge?: number;
  histogramHz?: number;
  maskTileHeight?: number;
  onHistogram?: (h: HistogramPayload) => void;
  onError?: (message: string) => void;
};

const DEFAULTS: Required<Pick<EngineOptions, 'proxyLongEdge' | 'fullLongEdge' | 'histogramHz'>> = {
  proxyLongEdge: 2048,
  fullLongEdge: 4096,
  histogramHz: 15,
};

type RemovalOpUniforms = {
  mode: number;
  offset: [number, number];
  strength: number;
  maskDraw: MaskDraw;
  iterations: number;
};

export class RenderEngine {
  readonly gl: GL;
  private programs: Record<string, Program> = {};
  private pool: TexturePool;
  private halfFloat: boolean;

  private srcTex: GpuTexture | null = null;
  private srcId = '';
  private srcW = 0;
  private srcH = 0;

  private lutTexLuma: GpuTexture | null = null;
  private lutTexRgb: GpuTexture | null = null;
  private lutTexHue: GpuTexture | null = null;
  private lutTexHue2: GpuTexture | null = null;
  private lutSignature = '';
  private lut3dTex: WebGLTexture | null = null;
  private lut3dId = '';

  private mattes = new Map<string, GpuTexture>();
  private imageTextures = new Map<string, { tex: GpuTexture; bitmap: ImageBitmap }>();
  private bgImageTex: GpuTexture | null = null;
  private bgImageSrc = '';

  private maskAtlas: GpuTexture | null = null;
  private maskHash = '';
  private removalCache: { hash: string; tex: GpuTexture } | null = null;

  private statsTex: GpuTexture | null = null;
  private lastHistogram = 0;
  private frameTimes: number[] = [];
  private passes = 0;
  private dropped = 0;
  private rendererName = 'unknown';
  private vao: WebGLVertexArrayObject | null = null;

  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private opts: EngineOptions = {},
  ) {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    }) as GL | null;
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.halfFloat = supportsHalfFloatRender(gl);
    this.pool = new TexturePool(gl, this.halfFloat);

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      this.rendererName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? 'unknown');
    }

    this.programs.linearize = createProgram(gl, QUAD_VERT, LINEARIZE_FRAG, 'linearize');
    this.programs.blur = createProgram(gl, QUAD_VERT, BLUR_FRAG, 'blur');
    this.programs.mask = createProgram(gl, QUAD_VERT, MASK_FRAG, 'mask');
    this.programs.removal = createProgram(gl, QUAD_VERT, REMOVAL_FRAG, 'removal');
    this.programs.develop = createProgram(gl, QUAD_VERT, DEVELOP_FRAG, 'develop');
    this.programs.output = createProgram(gl, QUAD_VERT, OUTPUT_FRAG, 'output');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  /* -------------------------------------------------------------- sources */

  setSource(photoId: string, bitmap: ImageBitmap): void {
    const { gl } = this;
    if (this.srcId === photoId && this.srcTex) return;
    this.srcTex?.destroy();
    this.srcTex = new GpuTexture(gl, {
      w: bitmap.width,
      h: bitmap.height,
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    this.srcTex.upload(bitmap);
    this.srcId = photoId;
    this.srcW = bitmap.width;
    this.srcH = bitmap.height;
    this.maskHash = '';
    this.removalCache?.tex.destroy();
    this.removalCache = null;
  }

  setMatte(m: MattePayload): void {
    const { gl } = this;
    const existing = this.mattes.get(m.id);
    if (existing && existing.width === m.width && existing.height === m.height) {
      gl.bindTexture(gl.TEXTURE_2D, existing.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.width, m.height, gl.RED, gl.UNSIGNED_BYTE, m.alpha);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      return;
    }
    existing?.destroy();
    const tex = new GpuTexture(gl, {
      w: m.width,
      h: m.height,
      internal: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    tex.upload(m.alpha, { alignment: 1 });
    this.mattes.set(m.id, tex);
  }

  setImageLayer(layerId: string, bitmap: ImageBitmap): void {
    const { gl } = this;
    const prev = this.imageTextures.get(layerId);
    if (prev) {
      prev.tex.destroy();
      prev.bitmap.close();
    }
    const tex = new GpuTexture(gl, {
      w: bitmap.width,
      h: bitmap.height,
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    tex.upload(bitmap);
    this.imageTextures.set(layerId, { tex, bitmap });
  }

  setBackgroundImage(src: string, bitmap: ImageBitmap): void {
    const { gl } = this;
    if (this.bgImageSrc === src && this.bgImageTex) return;
    this.bgImageTex?.destroy();
    this.bgImageTex = new GpuTexture(gl, {
      w: bitmap.width,
      h: bitmap.height,
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    this.bgImageTex.upload(bitmap);
    this.bgImageSrc = src;
  }

  setLuts(luts: CurveLuts, signature: string): void {
    if (signature === this.lutSignature && this.lutTexLuma) return;
    const { gl } = this;
    const mk = (w: number, h: number) =>
      new GpuTexture(gl, {
        w,
        h,
        internal: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
      });

    // Luma curve is stored in the *green* channel of an RGBA8 texture so we can
    // keep a single 8-bit path (no half-float extension needed for sampling).
    if (!this.lutTexLuma || this.lutTexLuma.width !== luts.size) {
      this.lutTexLuma?.destroy();
      this.lutTexLuma = mk(luts.size, 1);
    }
    const luma8 = new Uint8Array(luts.size * 4);
    for (let i = 0; i < luts.size; i++) {
      const v = Math.round(clamp01(luts.luma[i] ?? 0) * 255);
      luma8[i * 4] = v;
      luma8[i * 4 + 1] = v;
      luma8[i * 4 + 2] = v;
      luma8[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexLuma.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, luts.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, luma8);

    if (!this.lutTexRgb || this.lutTexRgb.width !== luts.size) {
      this.lutTexRgb?.destroy();
      this.lutTexRgb = mk(luts.size, 1);
    }
    const rgb8 = new Uint8Array(luts.size * 4);
    for (let i = 0; i < luts.size; i++) {
      rgb8[i * 4] = Math.round(clamp01(luts.rgb[i * 3] ?? 0) * 255);
      rgb8[i * 4 + 1] = Math.round(clamp01(luts.rgb[i * 3 + 1] ?? 0) * 255);
      rgb8[i * 4 + 2] = Math.round(clamp01(luts.rgb[i * 3 + 2] ?? 0) * 255);
      rgb8[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexRgb.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, luts.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgb8);

    if (!this.lutTexHue || this.lutTexHue.width !== luts.hueSize) {
      this.lutTexHue?.destroy();
      this.lutTexHue = mk(luts.hueSize, 1);
      this.lutTexHue2?.destroy();
      this.lutTexHue2 = mk(luts.hueSize, 1);
    }
    // Hue deltas are signed and small: encode as (v * 0.5 + 0.5) over ±1.
    const hue8 = new Uint8Array(luts.hueSize * 4);
    const hue2 = new Uint8Array(luts.hueSize * 4);
    for (let i = 0; i < luts.hueSize; i++) {
      hue8[i * 4] = Math.round(clamp01((luts.hue[i * 4] ?? 0) * 0.5 + 0.5) * 255);
      hue8[i * 4 + 1] = Math.round(clamp01((luts.hue[i * 4 + 1] ?? 0) * 0.5 + 0.5) * 255);
      hue8[i * 4 + 2] = Math.round(clamp01((luts.hue[i * 4 + 2] ?? 0) * 0.5 + 0.5) * 255);
      hue8[i * 4 + 3] = Math.round(clamp01((luts.hue[i * 4 + 3] ?? 0) * 0.5 + 0.5) * 255);
      const s = Math.round(clamp01((luts.hue2?.[i] ?? 0) * 0.5 + 0.5) * 255);
      hue2[i * 4] = s;
      hue2[i * 4 + 1] = s;
      hue2[i * 4 + 2] = s;
      hue2[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexHue.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, luts.hueSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, hue8);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexHue2!.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, luts.hueSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, hue2);

    this.lutSignature = signature;

    if (luts.cube && luts.cube.data.length) {
      if (this.lut3dTex) this.gl.deleteTexture(this.lut3dTex);
      this.lut3dTex = createTexture3D(gl, luts.cube.size, luts.cube.data);
      this.lut3dId = `cube:${luts.cube.size}`;
    }
  }

  loadCube(id: string, text: string): { size: number; title: string } {
    const cube = parseCube(text);
    if (this.lut3dTex) this.gl.deleteTexture(this.lut3dTex);
    this.lut3dTex = createTexture3D(this.gl, cube.size, cube.data);
    this.lut3dId = id;
    return { size: cube.size, title: cube.title };
  }

  /* ---------------------------------------------------------------- render */

  render(req: RenderRequest): { ms: number; requestId: number } {
    const t0 = performance.now();
    const gl = this.gl;
    if (!this.srcTex) return { ms: 0, requestId: req.requestId };
    this.passes = 0;

    const srcAspect = this.srcW / this.srcH;
    const cap =
      req.quality === 'full'
        ? (this.opts.fullLongEdge ?? DEFAULTS.fullLongEdge)
        : (this.opts.proxyLongEdge ?? DEFAULTS.proxyLongEdge);
    const longEdge = Math.max(256, Math.min(Math.max(this.srcW, this.srcH), cap));
    const workW = this.srcW >= this.srcH ? longEdge : Math.round(longEdge / srcAspect);
    const workH = this.srcW >= this.srcH ? Math.round(longEdge * (this.srcH / this.srcW)) : longEdge;

    /* 1 — linearise into the working space */
    const linTex = this.pool.acquire(this.workSpec(workW, workH));
    this.blit(this.programs.linearize!, linTex, workW, workH, () => {
      bind(gl, 0, this.srcTex!.texture);
      setUniforms(gl, this.programs.linearize!, { uTex: 0 });
    });

    /* 2 — removals (cached: they only depend on source + op list) */
    const cleanTex = this.applyRemovals(req, linTex, workW, workH);
    this.lastClean = cleanTex;

    /* 3 — blur pyramid for clarity / texture / dehaze / sharpen / NR */
    const smallW = Math.max(2, workW >> 1),
      smallH = Math.max(2, workH >> 1);
    const blurSmall = this.gaussian(cleanTex, smallW, smallH, 1.4);
    const blurLarge = this.gaussian(blurSmall, Math.max(2, smallW >> 1), Math.max(2, smallH >> 1), 3.2);

    /* 4 — masks */
    const packed = packLayers(req.params, srcAspect);
    this.renderMasks(packed.maskDraws, cleanTex, workW, workH, req);

    /* 5 — develop */
    const workTex = this.pool.acquire(this.workSpec(workW, workH));
    const showBefore = !!req.before && req.before.mode !== 'off';
    const beforeTex =
      showBefore && req.before!.mode !== 'toggle' && req.before!.params
        ? this.pool.acquire(this.workSpec(workW, workH))
        : null;

    this.runDevelop(req, cleanTex, blurSmall, blurLarge, packed, workTex, workW, workH);
    if (beforeTex && req.before?.params) {
      const beforeReq: RenderRequest = { ...req, params: req.before.params };
      const beforePacked = packLayers(beforeReq.params, srcAspect);
      this.runDevelop(beforeReq, cleanTex, blurSmall, blurLarge, beforePacked, beforeTex, workW, workH);
    }

    /* 6 — output to canvas */
    this.resizeCanvas(req);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.runOutput(req, workTex, beforeTex, null, this.canvas.width, this.canvas.height);
    this.passes++;

    /* 7 — histogram (throttled) */
    const hz = this.opts.histogramHz ?? DEFAULTS.histogramHz;
    if (hz > 0 && t0 - this.lastHistogram > 1000 / hz) {
      this.lastHistogram = t0;
      this.computeHistogram(req, workTex, beforeTex);
    }

    // release temporaries (kept: caches)
    if (linTex !== (this.removalCache?.tex ?? null)) this.pool.release(linTex);
    this.pool.release(blurSmall);
    this.pool.release(blurLarge);
    this.pool.release(workTex);
    if (beforeTex) this.pool.release(beforeTex);

    const ms = performance.now() - t0;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    return { ms, requestId: req.requestId };
  }

  /* ------------------------------------------------------------ internals */

  private workSpec(w: number, h: number) {
    const gl = this.gl;
    return {
      w,
      h,
      internal: this.halfFloat ? gl.RGBA16F : gl.RGBA8,
      format: gl.RGBA,
      type: this.halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    };
  }

  private blit(
    prog: Program,
    target: GpuTexture | null,
    w: number,
    h: number,
    setup: () => void,
  ): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.attachFbo());
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    prog.use();
    setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.passes++;
  }

  private gaussian(src: GpuTexture, w: number, h: number, radius: number): GpuTexture {
    const gl = this.gl;
    const a = this.pool.acquire(this.workSpec(w, h));
    const b = this.pool.acquire(this.workSpec(w, h));
    const prog = this.programs.blur!;
    const tx = 1 / w,
      ty = 1 / h;
    this.blit(prog, a, w, h, () => {
      bind(gl, 0, src.texture);
      setUniforms(gl, prog, { uTex: 0, uDir: new Float32Array([tx * radius, 0]) });
    });
    this.blit(prog, b, w, h, () => {
      bind(gl, 0, a.texture);
      setUniforms(gl, prog, { uTex: 0, uDir: new Float32Array([0, ty * radius]) });
    });
    this.pool.release(a);
    return b;
  }

  private applyRemovals(req: RenderRequest, linTex: GpuTexture, w: number, h: number): GpuTexture {
    const ops = req.params.removals.filter((r) => r.strokes.length > 0);
    if (!ops.length) return linTex;
    const hash = fnv1a(
      `${this.srcId}|${JSON.stringify(ops)}|${w}x${h}|${req.params.bgRemoval?.enabled ? 1 : 0}`,
    );
    if (this.removalCache && this.removalCache.hash === hash) return this.removalCache.tex;

    const gl = this.gl;
    this.removalCache?.tex.destroy();
    const tileH = this.maskTileHeight(w, h);
    const maskTex = this.pool.acquire({
      w: MASK_TILE_W,
      h: tileH,
      internal: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });

    let cur = linTex;
    let owned: GpuTexture[] = [];
    const prog = this.programs.removal!;

    for (const op of ops) {
      const draw = this.opMaskDraw(op, w, h);
      this.blit(this.programs.mask!, maskTex, MASK_TILE_W, tileH, () =>
        this.setMaskUniforms(draw, cur, null, w, h),
      );
      const mode = op.kind === 'heal' ? 0 : op.kind === 'clone' ? 1 : op.kind === 'redEye' ? 3 : 2;
      const iterations = mode === 2 ? (req.fast ? 3 : 10) : 1;
      const offset: [number, number] = [op.source.dx, op.source.dy];
      for (let i = 0; i < iterations; i++) {
        const next = this.pool.acquire(this.workSpec(w, h));
        this.blit(prog, next, w, h, () => {
          bind(gl, 0, cur.texture);
          bind(gl, 1, linTex.texture);
          bind(gl, 2, maskTex.texture);
          setUniforms(gl, prog, {
            uTex: 0,
            uOriginal: 1,
            uMask: 2,
            uTexel: new Float32Array([1 / w, 1 / h]),
            uOffset: new Float32Array(offset),
            uMode: mode,
            uStrength: op.strength / 100,
            uIter: iterations > 1 ? i / (iterations - 1) : 1,
          });
        });
        owned.push(next);
        cur = next;
      }
      // free intermediates except the latest
      for (let i = 0; i < owned.length - 1; i++) this.pool.release(owned[i]!);
      owned = [owned[owned.length - 1]!];
    }

    this.pool.release(maskTex);
    const result = owned[0]!;
    this.removalCache = { hash, tex: result };
    return result;
  }

  private opMaskDraw(op: DevelopParams['removals'][number], w: number, h: number): MaskDraw {
    const { add, addCount, sub, subCount } = strokeCircles(
      [
        {
          id: op.id,
          kind: 'brush',
          name: 'op',
          op: 'replace',
          invert: false,
          amount: 100,
          feather: op.feather,
          strokes: op.strokes,
          brush: {
            size: 20,
            feather: op.feather,
            flow: 100,
            density: 100,
            autoMask: false,
            erase: false,
            smoothing: 0,
          },
          refine: { shift: 0, smooth: 0, decontaminate: false },
          overlay: { visible: false, mode: 'color', color: '#ff3b6b', opacity: 55 },
        },
      ],
    );
    void w;
    void h;
    return {
      slot: 0,
      kind: 6,
      maskA: new Float32Array(4),
      maskB: new Float32Array([0, 0, 1, 0]),
      maskC: new Float32Array(4),
      range: new Float32Array(4),
      matteMode: 0,
      needsMatte: false,
      add,
      addCount,
      sub,
      subCount,
      flow: 1,
    };
  }

  private maskTileHeight(w: number, h: number): number {
    const fixed = this.opts.maskTileHeight;
    if (fixed) return fixed;
    return Math.max(16, Math.min(512, Math.round((MASK_TILE_W * h) / Math.max(1, w))));
  }

  private renderMasks(
    draws: MaskDraw[],
    srcLin: GpuTexture,
    w: number,
    h: number,
    req: RenderRequest,
  ): void {
    if (!draws.length && !this.maskAtlas) return;
    const gl = this.gl;
    const tileH = this.maskTileHeight(w, h);
    if (
      !this.maskAtlas ||
      this.maskAtlas.width !== MASK_TILE_W * MASK_TILES ||
      this.maskAtlas.height !== tileH
    ) {
      this.maskAtlas?.destroy();
      this.maskAtlas = new GpuTexture(gl, {
        w: MASK_TILE_W * MASK_TILES,
        h: tileH,
        internal: gl.R8,
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
      });
      this.maskHash = '';
    }
    const hash = fnv1a(draws.map((d) => JSON.stringify([d.slot, d.kind, d.maskA, d.maskB, d.maskC, d.range, d.addCount, d.subCount, d.flow, d.add, d.sub])).join(';') + `|${tileH}|${this.srcId}`);
    if (hash === this.maskHash) return;
    this.maskHash = hash;

    const fbo = this.maskAtlas.attachFbo();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    // clear every tile to zero so unused layers read 0 mask (not garbage)
    gl.viewport(0, 0, this.maskAtlas.width, tileH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = w / h;
    const prog = this.programs.mask!;
    prog.use();
    for (const d of draws) {
      // one tile per layer: scissor the viewport to the tile and draw
      gl.viewport(d.slot * MASK_TILE_W, 0, MASK_TILE_W, tileH);
      this.setMaskUniforms(d, srcLin, this.pickMatte(req, d), w, h, aspect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.passes++;
    }
    gl.viewport(0, 0, w, h);
  }

  private pickMatte(req: RenderRequest, d: MaskDraw): GpuTexture | null {
    if (!d.needsMatte) return null;
    const bg = req.params.bgRemoval;
    if (bg?.matteId && this.mattes.has(bg.matteId)) return this.mattes.get(bg.matteId)!;
    return this.mattes.values().next().value ?? null;
  }

  private setMaskUniforms(
    d: MaskDraw,
    srcLin: GpuTexture,
    matte: GpuTexture | null,
    w: number,
    h: number,
    aspect?: number,
  ): void {
    const gl = this.gl;
    const prog = this.programs.mask!;
    bind(gl, 0, srcLin.texture);
    bind(gl, 1, matte?.texture ?? srcLin.texture);
    setUniforms(gl, prog, {
      uKind: d.kind,
      uMaskA: d.maskA,
      uMaskB: d.maskB,
      uMaskC: d.maskC,
      uRange: d.range,
      uAspect: new Float32Array([aspect ?? w / h, 1]),
      uSrcLin: 0,
      uMatte: 1,
      uMatteMode: d.matteMode,
      uMatteRefine: new Float32Array([0, 0, 0, matte && d.needsMatte ? 1 : 0]),
      uAddCount: d.addCount,
      uSubCount: d.subCount,
      uAdd: d.add,
      uSub: d.sub,
      uFlow: d.flow,
    });
  }

  private runDevelop(
    req: RenderRequest,
    src: GpuTexture,
    blurSmall: GpuTexture,
    blurLarge: GpuTexture,
    packed: ReturnType<typeof packLayers>,
    target: GpuTexture,
    w: number,
    h: number,
  ): void {
    const gl = this.gl;
    const prog = this.programs.develop!;
    const p = req.params;
    const ctx = { horizonTilt: req.horizonTilt ?? 0 };
    const proof = proofMatrices(req.softProof.enabled ? proofSpaceOf(req.softProof) : undefined, req.softProof.enabled);
    const cutout = this.currentCutout(p);

    const imageLayers = packed.imageSlots.filter(Boolean) as NonNullable<
      ReturnType<typeof packLayers>['imageSlots']
    >[number][];
    const img0 = imageLayers[0] ? this.imageTextures.get(imageLayers[0].id) : null;
    const img1 = imageLayers[1] ? this.imageTextures.get(imageLayers[1].id) : null;

    this.blit(prog, target, w, h, () => {
      bind(gl, 0, src.texture);
      bind(gl, 1, blurSmall.texture);
      bind(gl, 2, blurLarge.texture);
      bind(gl, 3, this.maskAtlas?.texture ?? blurSmall.texture);
      bind(gl, 4, this.lutTexLuma?.texture ?? blurSmall.texture);
      bind(gl, 5, this.lutTexRgb?.texture ?? blurSmall.texture);
      bind(gl, 6, this.lutTexHue?.texture ?? blurSmall.texture);
      bind(gl, 7, this.lutTexHue2?.texture ?? blurSmall.texture);
      bind(gl, 8, this.lut3dTex, gl.TEXTURE_3D);
      bind(gl, 9, img0?.tex.texture ?? src.texture);
      bind(gl, 10, img1?.tex.texture ?? src.texture);
      bind(gl, 11, cutout?.texture ?? blurSmall.texture);

      setUniforms(gl, prog, {
        uSrc: 0,
        uBlurSmall: 1,
        uBlurLarge: 2,
        uMaskAtlas: 3,
        uLutLuma: 4,
        uLutRgb: 5,
        uLutHue: 6,
        uLutHue2: 7,
        uLut3d: 8,
        uImage0: 9,
        uImage1: 10,
        uCutout: 11,
        uHasLut3d: this.lut3dTex ? 1 : 0,
        uHasImage0: img0 ? 1 : 0,
        uHasImage1: img1 ? 1 : 0,
        uLutSize: this.lutTexLuma?.width ?? 4096,
        uHueLutSize: this.lutTexHue?.width ?? 1024,
        uMaxTiles: MASK_TILES,
        uWbGain: wbGain(p.wb.temp, p.wb.tint),
        uCalibration: calibrationMatrix(p.calibration),
        uProfileAmount: clamp01(p.profile.amount / 100),
        uExposure: p.tone.exposure,
        uContrast: p.tone.contrast,
        uHighlights: p.tone.highlights,
        uShadows: p.tone.shadows,
        uWhites: p.tone.whites,
        uBlacks: p.tone.blacks,
        uTexture: p.presence.texture,
        uClarity: p.presence.clarity,
        uDehaze: p.presence.dehaze,
        uVibrance: p.presence.vibrance,
        uSaturation: p.presence.saturation,
        uTreatment: p.treatment === 'bw' ? 1 : 0,
        uCurveAmount: p.curves.amount,
        uLockLuminosity: p.curves.lockLuminosity ? 1 : 0,
        uHasRgbCurve: p.curves.r.length > 1 || p.curves.g.length > 1 || p.curves.b.length > 1 ? 1 : 0,
        uHasHueCurve:
          p.curves.hueCurves.hh.length > 1 ||
          p.curves.hueCurves.hs.length > 1 ||
          p.curves.hueCurves.hl.length > 1 ||
          p.curves.hueCurves.ls.length > 1 ||
          p.curves.hueCurves.ss.length > 1
            ? 1
            : 0,
        uMixerH: new Float32Array(MIXER_ORDER.map((c) => p.mixer[c]?.h ?? 0)),
        uMixerS: new Float32Array(MIXER_ORDER.map((c) => p.mixer[c]?.s ?? 0)),
        uMixerL: new Float32Array(MIXER_ORDER.map((c) => p.mixer[c]?.l ?? 0)),
        uMixerAmount: 1,
        uPointCount: Math.min(4, p.pointColor.length),
        uPointA: pointArray(p, 0),
        uPointB: pointArray(p, 1),
        uPointC: pointArray(p, 2),
        uGradeShadow: gradeVec(p.grading.shadows, 1),
        uGradeMid: gradeVec(p.grading.mids, 1),
        uGradeHigh: gradeVec(p.grading.highs, 1),
        uGradeGlobal: gradeVec(p.grading.global, 1),
        uGradeBlend: new Float32Array([p.grading.blend / 100, p.grading.balance / 100]),
        uSharpen: new Float32Array([
          p.detail.sharpen.amount,
          p.detail.sharpen.radius,
          p.detail.sharpen.detail,
          p.detail.sharpen.masking,
        ]),
        uNoise: new Float32Array([
          p.detail.nr.luminance,
          p.detail.nr.detail,
          p.detail.nr.contrast,
          p.detail.nr.color,
        ]),
        uLens: new Float32Array([
          ((p.lens.distortion - 100) / 100) * (p.lens.enabled ? 1 : 0),
          p.lens.removeCA ? (p.lens.caAmount / 100) * (p.lens.enabled ? 1 : 0) : 0,
          p.lens.vignetting / 100,
          p.lens.defringeAmount / 100,
        ]),
        uLensEnabled: p.lens.enabled ? 1 : 0,
        uGeometry: geometryMatrix(p.geometry, ctx),
        uVignette: new Float32Array([
          p.effects.vignette.amount,
          p.effects.vignette.midpoint,
          p.effects.vignette.roundness,
          p.effects.vignette.feather,
        ]),
        uVignette2: new Float32Array([
          p.effects.vignette.style === 'highlightPriority' ? 1 : p.effects.vignette.style === 'colorPriority' ? 2 : 0,
          p.effects.vignette.highlights,
        ]),
        uGrain: new Float32Array([
          p.effects.grain.amount,
          p.effects.grain.size,
          p.effects.grain.roughness,
        ]),
        uLayerCount: packed.count,
        uLayerOp: packed.op,
        uLayerAdjA: packed.adjA,
        uLayerAdjB: packed.adjB,
        uLayerAdjC: packed.adjC,
        uLayerAdjD: packed.adjD,
        uFillLayer: packed.fill,
        uFillLayer2: packed.fill2,
        uLayerImg: packed.img,
        uLayerImg2: packed.img2,
        uCutoutEnabled: cutout && p.bgRemoval?.enabled ? 1 : 0,
        uCutoutInvert: p.bgRemoval?.output.kind === 'transparent' ? 0 : 0,
        uProofEnabled: req.softProof.enabled ? 1 : 0,
        uProofMatrix: proof.proof,
        uProofPaper: req.softProof.simulatePaper ? 0.6 : 0,
      });
    });
  }

  private currentCutout(p: DevelopParams): GpuTexture | null {
    if (!p.bgRemoval?.enabled) return null;
    const id = p.bgRemoval.matteId;
    if (id && this.mattes.has(id)) return this.mattes.get(id)!;
    return this.mattes.values().next().value ?? null;
  }

  private resizeCanvas(req: RenderRequest): void {
    const w = Math.max(1, Math.round(req.target.width * req.target.dpr));
    const h = Math.max(1, Math.round(req.target.height * req.target.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private runOutput(
    req: RenderRequest,
    workTex: GpuTexture,
    beforeTex: GpuTexture | null,
    target: GpuTexture | null,
    w: number,
    h: number,
  ): void {
    const gl = this.gl;
    const prog = this.programs.output!;
    const p = req.params;
    const crop = p.geometry.crop;
    const bg = req.background;
    const ov = req.overlays;
    const proof = proofMatrices(req.softProof.enabled ? proofSpaceOf(req.softProof) : undefined, req.softProof.enabled);
    const maskLayer = ov.mask?.layerId ?? null;
    const maskTile = maskLayer !== null ? this.maskTileTexture(maskLayer, req, workTex.width, workTex.height) : null;

    this.blit(prog, target, w, h, () => {
      bind(gl, 0, workTex.texture);
      bind(gl, 1, (beforeTex ?? workTex).texture);
      bind(gl, 2, this.bgImageTex?.texture ?? workTex.texture);
      bind(gl, 3, (maskTile ?? workTex).texture);
      setUniforms(gl, prog, {
        uTex: 0,
        uBefore: 1,
        uBgImage: 2,
        uMaskTile: 3,
        uDisplayMatrix: proof.display,
        uCrop: new Float32Array([crop.x, crop.y, crop.w, crop.h]),
        uView: new Float32Array([req.view.x, req.view.y]),
        uViewSize: new Float32Array([req.view.w, req.view.h]),
        uCropAspect: (crop.w * this.srcW) / Math.max(crop.h * this.srcH, 1e-4),
        uRotate: (crop.angle * Math.PI) / 180,
        uFlipH: crop.flipH ? 1 : 0,
        uFlipV: crop.flipV ? 1 : 0,
        uBeforeAfterMode: BEFORE_AFTER_MODE[req.before?.mode ?? 'off'] ?? 0,
        uSplit: req.before?.split ?? 0.5,
        uUseBeforeBuffer: beforeTex ? 1 : 0,
        uDstSize: new Float32Array([w, h]),
        uBackdrop: new Float32Array(backdropOf(req)),
        uTransparent: bg.kind === 'checker' || bg.kind === 'transparent' ? 1 : 0,
        uBg: new Float32Array([BG_KIND[bg.kind] ?? 0, 0, 0, 0]),
        uBgColor: new Float32Array(toDisplayRgb(bg.color)),
        uBgColor2: new Float32Array(toDisplayRgb(bg.color2)),
        uBgAngle: bg.angle,
        uBgBlur: bg.blurRadius,
        uClippingMode: CLIPPING_MODE[ov.clipping] ?? 0,
        uGamutWarn: ov.gamutWarning && req.softProof.enabled ? 1 : 0,
        uSharpnessHeat: ov.sharpnessHeatmap ? 1 : 0,
        uMaskOverlay: maskTile ? 1 : 0,
        uMaskColor: new Float32Array(toDisplayRgb(ov.mask?.color ?? '#ff3b6b')),
        uMaskMode: ov.mask?.mode === 'bw' ? 1 : ov.mask?.mode === 'onBlack' ? 2 : ov.mask?.mode === 'onWhite' ? 3 : 0,
      });
    });
  }

  /** Render one layer's mask tile into a standalone texture for the overlay. */
  private maskTileTexture(layerId: string, req: RenderRequest, w: number, h: number): GpuTexture | null {
    const gl = this.gl;
    const packed = packLayers(req.params, this.srcW / this.srcH);
    const idx = packed.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return null;
    const draw = packed.maskDraws.find((d) => d.slot === idx);
    const tileH = this.maskTileHeight(w, h);
    if (!this.overlayTile || this.overlayTile.height !== tileH) {
      this.overlayTile?.destroy();
      this.overlayTile = new GpuTexture(gl, {
        w: MASK_TILE_W,
        h: tileH,
        internal: gl.R8,
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
      });
    }
    if (!draw) {
      // no mask → full-strength tile
      this.blit(this.programs.mask!, this.overlayTile, MASK_TILE_W, tileH, () => {
        bind(gl, 0, this.lastClean?.texture ?? this.srcTex!.texture);
        bind(gl, 1, this.srcTex!.texture);
        setUniforms(gl, this.programs.mask!, {
          uKind: 0,
          uMaskA: new Float32Array(4),
          uMaskB: new Float32Array([0, 0, 1, 0]),
          uMaskC: new Float32Array(4),
          uRange: new Float32Array(4),
          uAspect: new Float32Array([this.srcW / this.srcH, 1]),
          uSrcLin: 0,
          uMatte: 1,
          uMatteMode: 0,
          uMatteRefine: new Float32Array(4),
          uAddCount: 0,
          uSubCount: 0,
          uAdd: new Float32Array(192),
          uSub: new Float32Array(64),
          uFlow: 1,
        });
      });
      return this.overlayTile;
    }
    this.blit(this.programs.mask!, this.overlayTile, MASK_TILE_W, tileH, () =>
      this.setMaskUniforms(draw, this.lastClean!, this.pickMatte(req, draw), w, h),
    );
    return this.overlayTile;
  }

  private overlayTile: GpuTexture | null = null;
  private lastClean: GpuTexture | null = null;

  private computeHistogram(req: RenderRequest, workTex: GpuTexture, beforeTex: GpuTexture | null): void {
    const gl = this.gl;
    const SW = 176,
      SH = 132;
    if (!this.statsTex || this.statsTex.width !== SW) {
      this.statsTex?.destroy();
      this.statsTex = new GpuTexture(gl, {
        w: SW,
        h: SH,
        internal: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
      });
    }
    const ov: OverlayState = { ...req.overlays, clipping: 'off', gamutWarning: false, mask: null, sharpnessHeatmap: false };
    this.runOutput({ ...req, overlays: ov }, workTex, beforeTex, this.statsTex, SW, SH);

    const pixels = new Uint8Array(SW * SH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statsTex.fbo);
    gl.readPixels(0, 0, SW, SH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const luma = new Float32Array(256),
      r = new Float32Array(256),
      g = new Float32Array(256),
      b = new Float32Array(256);
    let sum = 0,
      clipHi = 0,
      clipLo = 0;
    const n = SW * SH;
    for (let i = 0; i < n; i++) {
      const R = pixels[i * 4]!,
        G = pixels[i * 4 + 1]!,
        B = pixels[i * 4 + 2]!;
      const y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
      luma[y]++;
      r[R]++;
      g[G]++;
      b[B]++;
      sum += y;
      if (R >= 253 && G >= 253 && B >= 253) clipHi++;
      if (R <= 2 && G <= 2 && B <= 2) clipLo++;
    }
    let peak = 1;
    for (let i = 0; i < 256; i++) peak = Math.max(peak, luma[i]!, r[i]!, g[i]!, b[i]!);
    const norm = (arr: Float32Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / peak;
      return arr;
    };
    const payload: HistogramPayload = {
      luma: norm(luma),
      r: norm(r),
      g: norm(g),
      b: norm(b),
      peak,
      clippedHighlights: clipHi / n,
      clippedShadows: clipLo / n,
      meanLuma: sum / n / 255,
      ts: performance.now(),
    };
    this.opts.onHistogram?.(payload);
  }

  /* ------------------------------------------------------------- capture */

  /** Render at an arbitrary size and return pixels (export path, §10.5). */
  capture(req: RenderRequest, width: number, height: number): ImageData {
    const gl = this.gl;
    if (!this.srcTex) throw new Error('No source loaded');
    const srcAspect = this.srcW / this.srcH;
    const longEdge = Math.min(Math.max(width, height), this.opts.fullLongEdge ?? DEFAULTS.fullLongEdge);
    const workW = this.srcW >= this.srcH ? longEdge : Math.round(longEdge / srcAspect);
    const workH = this.srcW >= this.srcH ? Math.round(longEdge * (this.srcH / this.srcW)) : longEdge;

    const linTex = this.pool.acquire(this.workSpec(workW, workH));
    this.blit(this.programs.linearize!, linTex, workW, workH, () => {
      bind(gl, 0, this.srcTex!.texture);
      setUniforms(gl, this.programs.linearize!, { uTex: 0 });
    });
    const cleanTex = this.applyRemovals({ ...req, fast: false }, linTex, workW, workH);
    const blurSmall = this.gaussian(cleanTex, Math.max(2, workW >> 1), Math.max(2, workH >> 1), 1.4);
    const blurLarge = this.gaussian(blurSmall, Math.max(2, workW >> 2), Math.max(2, workH >> 2), 3.2);
    const packed = packLayers(req.params, srcAspect);
    this.renderMasks(packed.maskDraws, cleanTex, workW, workH, req);
    const workTex = this.pool.acquire(this.workSpec(workW, workH));
    this.runDevelop(req, cleanTex, blurSmall, blurLarge, packed, workTex, workW, workH);

    const out = this.pool.acquire({
      w: width,
      h: height,
      internal: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    this.runOutput(req, workTex, null, out, width, height);

    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // readPixels is bottom-up → flip into ImageData order
    const data = new Uint8ClampedArray(width * height * 4);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    }
    this.pool.release(out);
    this.pool.release(workTex);
    this.pool.release(blurSmall);
    this.pool.release(blurLarge);
    if (cleanTex !== linTex && cleanTex !== this.removalCache?.tex) this.pool.release(cleanTex);
    this.pool.release(linTex);
    return new ImageData(data, width, height);
  }

  /* --------------------------------------------------------------- stats */

  stats(): EngineStats {
    const s = this.pool.stats();
    const avg = this.frameTimes.length
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      : 0;
    return {
      backend: 'webgl2',
      renderer: this.rendererName,
      textures: s.live + s.pooled + this.mattes.size + this.imageTextures.size,
      textureBytes: s.liveBytes + s.pooledBytes + [...this.mattes.values()].reduce((a, t) => a + t.bytes, 0),
      framebuffers: s.live,
      lastRenderMs: this.frameTimes[this.frameTimes.length - 1] ?? 0,
      avgRenderMs: avg,
      fps: avg > 0 ? Math.min(120, 1000 / Math.max(avg, 1)) : 0,
      passes: this.passes,
      droppedFrames: this.dropped,
      workSize: { w: this.srcW, h: this.srcH },
    };
  }

  reportDrop(): void {
    this.dropped++;
  }

  /** Free everything except the source (called on memory pressure, §6.2). */
  trimCaches(): number {
    const freed = this.pool.evict();
    return freed;
  }

  dispose(): void {
    this.pool.evict();
    this.srcTex?.destroy();
    this.lutTexLuma?.destroy();
    this.lutTexRgb?.destroy();
    this.lutTexHue?.destroy();
    this.lutTexHue2?.destroy();
    this.maskAtlas?.destroy();
    this.overlayTile?.destroy();
    this.statsTex?.destroy();
    this.bgImageTex?.destroy();
    this.removalCache?.tex.destroy();
    for (const m of this.mattes.values()) m.destroy();
    for (const i of this.imageTextures.values()) {
      i.tex.destroy();
      i.bitmap.close();
    }
    if (this.lut3dTex) this.gl.deleteTexture(this.lut3dTex);
    for (const p of Object.values(this.programs)) this.gl.deleteProgram(p.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    const lose = this.gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}

/* --------------------------------------------------------------- helpers */

const MIXER_ORDER = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;

function pointArray(p: DevelopParams, slot: number): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const pc = p.pointColor[i];
    if (!pc) continue;
    if (slot === 0) out.set([pc.l, pc.c, pc.h, pc.hueRange / 180], i * 4);
    else if (slot === 1) out.set([pc.hueShift, pc.sat, pc.lum, pc.satRange], i * 4);
    else out.set([pc.lumRange, 0, 0, 0], i * 4);
  }
  return out;
}

function gradeVec(g: { hue: number; sat: number; lum: number }, weight: number): Float32Array {
  return new Float32Array([g.hue / 360, g.sat / 100, g.lum, weight]);
}

function proofSpaceOf(sp: SoftProofState): 'srgb' | 'adobergb' | 'displayP3' | 'prophoto' {
  switch (sp.profile) {
    case 'adobergb':
      return 'adobergb';
    case 'displayP3':
      return 'displayP3';
    case 'prophoto':
      return 'prophoto';
    default:
      return 'srgb';
  }
}

const BACKDROPS: Record<string, [number, number, number]> = {
  'neutral-dark': [0.105, 0.11, 0.118],
  'mid-gray': [0.32, 0.32, 0.32],
  black: [0, 0, 0],
  white: [1, 1, 1],
  'match-theme': [0.13, 0.135, 0.145],
};

function backdropOf(req: RenderRequest): [number, number, number] {
  return BACKDROPS[req.backdrop ?? 'neutral-dark'] ?? BACKDROPS['neutral-dark']!;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export type { BackgroundState, BeforeAfterState, OverlayState };
