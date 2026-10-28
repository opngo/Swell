/**
 * useEngineStage — binds the editor state to the render engine (§5.2).
 *
 * Everything here is imperative on purpose. A slider drag fires ~60 updates a
 * second; if each one walked the React tree we would lose frames. Instead the
 * hook subscribes to the stores directly, coalesces to one render per animation
 * frame (inside EngineClient) and only publishes *summaries* — histogram, stats
 * — back into atoms that a handful of components read.
 *
 * Quality policy (§5.3): while scrubbing we render the proxy tier with
 * `fast = true` (no AI masks, fewer inpaint iterations). After 120 ms of idle
 * we re-render once at full quality and hard-swap.
 */

import { useEffect, useRef } from 'react';
import { editorStore, histogramAtom, engineOkAtom, engineErrorAtom, engineStatsAtom, liveParamsAtom, mattesAtom, viewMathAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import { useDevelop } from '@/state/develop.ts';
import { EngineClient } from '@/engine-client/EngineClient.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { analysisClient } from '@/lib/analysisClient.ts';
import { setEngine } from '@/lib/engineSingleton.ts';
import { makeViewMath, type ViewMath } from './coords.ts';
import { toast } from '@/state/toasts.ts';
import { PRIORITY, formatBytes } from '@swell/shared';
import type { BackgroundState, DevelopParams, Photo, RenderRequest, WatermarkState } from '@swell/schema';

const SCRUB_IDLE_MS = 120;
const STATS_INTERVAL_MS = 500;

export interface StageHandles {
  client: EngineClient | null;
  viewMath: ViewMath | null;
  /** force a re-render (used after a matte arrives or the canvas is resized) */
  invalidate: (full?: boolean) => void;
}

export function useEngineStage(
  containerRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled = true,
): React.RefObject<StageHandles> {
  const handles = useRef<StageHandles>({ client: null, viewMath: null, invalidate: () => {} });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !enabled) return;

    const client = new EngineClient({ canvas });
    handles.current.client = client;
    setEngine(client);
    const ok = client.init();
    editorStore.set(engineOkAtom, ok);
    editorStore.set(engineErrorAtom, client.error);
    if (!ok) {
      toast.error(
        'GPU renderer unavailable',
        `${client.error ?? 'WebGL2 could not start'}. Swell is showing the unedited preview — your edits are safe and will apply on export.`,
      );
      return () => {
        client.dispose();
        handles.current.client = null;
        setEngine(null);
      };
    }

    /* ------------------------------------------------------------ state */
    let photoId = '';
    let photo: Photo | null = null;
    let viewMath: ViewMath | null = null;
    let loadedBitmap: ImageBitmap | null = null;
    let quality: 'proxy' | 'full' = 'proxy';
    let fast = true;
    let idleTimer = 0;
    let disposed = false;
    const pendingMattes = new Set<string>();
    let requestSeq = 0;

    const dpr = () => Math.min(2, window.devicePixelRatio || 1);

    /* ------------------------------------------------------- request build */

    const backgroundFrom = (p: DevelopParams): BackgroundState => {
      const bg = p.bgRemoval;
      if (!bg || !bg.enabled) {
        return { kind: 'transparent', color: '#ffffff', color2: '#cfcfcf', angle: 135, blurRadius: 40, opacity: 1 };
      }
      return {
        kind: bg.output.kind === 'image' ? 'image' : bg.output.kind,
        color: bg.output.color,
        color2: bg.output.color2,
        angle: bg.output.angle,
        blurRadius: bg.output.blurRadius,
        opacity: 1,
      };
    };

    const watermark: WatermarkState = {
      enabled: false,
      kind: 'text',
      text: '',
      position: 'bottom-right',
      inset: 4,
      opacity: 0.8,
      size: 3,
    };

    const buildRequest = (): RenderRequest | null => {
      if (!photo || !viewMath || !loadedBitmap) return null;
      const ui = useUi.getState();
      const live = editorStore.get(liveParamsAtom);
      const params = live.photoId === photo.id ? live.params : (useDevelop.getState().params[photo.id] ?? live.params);
      const features = useCatalog.getState().features[photo.id];
      const settings = useSettings.getState().settings;

      return {
        photoId: photo.id,
        requestId: ++requestSeq,
        params,
        source: loadedBitmap,
        sourceWidth: loadedBitmap.width,
        sourceHeight: loadedBitmap.height,
        before: ui.beforeAfter,
        view: viewMath.view,
        zoom: viewMath.zoom,
        target: { width: viewMath.bufferW, height: viewMath.bufferH, dpr: viewMath.dpr },
        overlays: {
          ...ui.overlays,
          mask: ui.overlays.mask?.layerId
            ? { ...ui.overlays.mask, opacity: ui.overlays.mask.opacity ?? 0.6 }
            : ui.overlays.mask,
        },
        softProof: ui.softProof,
        background: backgroundFrom(params),
        watermark,
        luts: EMPTY_LUTS, // EngineClient fills this from the curve signature
        quality,
        fast,
        horizonTilt: features?.horizonTilt ?? 0,
        backdrop: settings.appearance.canvasBackdrop,
      };
    };

    /* ------------------------------------------------------------- render */

    const render = (opts?: { full?: boolean }) => {
      if (disposed || !client.ok) return;
      if (opts?.full) {
        quality = 'full';
        fast = false;
      }
      const req = buildRequest();
      if (!req) return;
      client.schedule(req);
      // after a scrub settles, refine once
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (disposed) return;
        quality = 'full';
        fast = false;
        const full = buildRequest();
        if (full) client.schedule(full);
        // next interaction starts on the proxy again
        idleTimer = window.setTimeout(() => {
          quality = 'proxy';
          fast = true;
        }, 400);
      }, SCRUB_IDLE_MS);
    };

    const layout = () => {
      if (disposed) return;
      const rect = container.getBoundingClientRect();
      const ui = useUi.getState();
      const p = photo ?? useCatalog.getState().photos[useCatalog.getState().activeId() ?? ''];
      if (!p) return;
      const params = editorStore.get(liveParamsAtom).photoId === p.id
        ? editorStore.get(liveParamsAtom).params
        : (useDevelop.getState().params[p.id] ?? null);
      const crop = params?.geometry.crop;
      const aspectSetting = (params?.geometry.aspect ?? 100) / 100;
      viewMath = makeViewMath(
        rect.width,
        rect.height,
        p.width || 1536,
        (p.height || 1024) * aspectSetting,
        {
          x: crop?.x ?? 0,
          y: crop?.y ?? 0,
          w: crop?.w ?? 1,
          h: crop?.h ?? 1,
          angle: crop?.angle ?? 0,
          flipH: crop?.flipH ?? false,
          flipV: crop?.flipV ?? false,
        },
        ui.view.zoom,
        ui.view.panX,
        ui.view.panY,
        dpr(),
      );
      handles.current.viewMath = viewMath;
      editorStore.set(viewMathAtom, viewMath);
      canvas.style.width = `${viewMath.canvasW}px`;
      canvas.style.height = `${viewMath.canvasH}px`;
      if (canvas.width !== viewMath.bufferW || canvas.height !== viewMath.bufferH) {
        canvas.width = viewMath.bufferW;
        canvas.height = viewMath.bufferH;
      }
      render();
    };

    handles.current.invalidate = (full) => (full ? render({ full: true }) : layout());

    /* ------------------------------------------------------- photo loading */

    const loadPhoto = async (id: string) => {
      const cat = useCatalog.getState();
      const p = cat.photos[id];
      if (!p) return;
      photoId = id;
      photo = p;
      editorStore.set(liveParamsAtom, {
        photoId: id,
        params: useDevelop.getState().params[id] ?? editorStore.get(liveParamsAtom).params,
        dirty: false,
      });

      try {
        const bmp = await imageLoader.loadPhoto(p, 'proxy', PRIORITY.current);
        if (disposed || photoId !== id) {
          bmp.close();
          return;
        }
        loadedBitmap?.close();
        loadedBitmap = bmp;
        client.setSource(id, bmp);
        layout();
        void ensureMattes(p);
        void prefetchNeighbours(id);
      } catch (err) {
        toast.warn('Preview could not be decoded', err instanceof Error ? err.message : String(err));
      }
    };

    const prefetchNeighbours = (id: string) => {
      const cat = useCatalog.getState();
      const list = cat.order;
      const i = list.indexOf(id);
      if (i < 0) return;
      const around = list.slice(Math.max(0, i - 2), i).concat(list.slice(i + 1, i + 3));
      void imageLoader.prefetch(
        around.map((x) => cat.photos[x]?.src).filter((s): s is string => !!s),
        'proxy',
      );
    };

    /** Subject/sky/background mattes come from the analysis worker (async). */
    const ensureMattes = async (p: Photo) => {
      const params = useDevelop.getState().params[p.id];
      const wants: string[] = [];
      if (params?.bgRemoval?.enabled) wants.push('subject');
      for (const l of params?.layers ?? []) {
        for (const m of l.masks) {
          if (m.kind === 'subject' || m.kind === 'sky' || m.kind === 'background') wants.push(m.kind);
        }
      }
      if (!wants.length) return;
      const have = editorStore.get(mattesAtom);
      for (const kind of new Set(wants)) {
        const key = `${p.id}:${kind}`;
        if (have[key] || pendingMattes.has(key)) continue;
        pendingMattes.add(key);
        try {
          const matte = await analysisClient.matte(p.id, p.src);
          const keyed = { ...matte, id: key };
          editorStore.set(mattesAtom, { ...editorStore.get(mattesAtom), [key]: keyed });
          client.setMatte(keyed);
          render();
        } catch (err) {
          toast.warn('Mask could not be computed', err instanceof Error ? err.message : String(err));
        } finally {
          pendingMattes.delete(key);
        }
      }
    };

    /* ------------------------------------------------------- subscriptions */

    const unsubCatalog = useCatalog.subscribe((state, prev) => {
      const id = state.activeId();
      if (id && id !== photoId) {
        quality = 'proxy';
        fast = true;
        void loadPhoto(id);
        return;
      }
      // features arriving (horizon tilt) can change upright results
      if (id && state.features[id] !== prev.features[id]) render();
    });

    const unsubUi = useUi.subscribe((state, prev) => {
      if (
        state.view !== prev.view ||
        state.overlays !== prev.overlays ||
        state.beforeAfter !== prev.beforeAfter ||
        state.softProof !== prev.softProof
      ) {
        layout();
      }
    });

    const unsubSettings = useSettings.subscribe((state, prev) => {
      if (state.settings.appearance.canvasBackdrop !== prev.settings.appearance.canvasBackdrop) render();
    });

    const unsubParams = editorStore.sub(liveParamsAtom, () => {
      if (!photo) return;
      // crop/aspect changes need a re-layout, everything else just a re-render
      const p = editorStore.get(liveParamsAtom).params;
      const before = useDevelop.getState().params[photo.id];
      const geomChanged =
        JSON.stringify(p.geometry.crop) !== JSON.stringify(before?.geometry.crop) ||
        p.geometry.aspect !== before?.geometry.aspect;
      if (geomChanged) layout();
      else render();
      void ensureMattes(photo);
    });

    const unsubDevelop = useDevelop.subscribe((state, prev) => {
      if (photoId && state.params[photoId] !== prev.params[photoId]) {
        editorStore.set(liveParamsAtom, { photoId, params: state.params[photoId]!, dirty: false });
        layout();
      }
    });

    /* ------------------------------------------------------------- events */

    const unsubEngine = client.on((e) => {
      if (e.type === 'histogram') editorStore.set(histogramAtom, e.histogram);
      if (e.type === 'error' && e.message !== 'slow-frames') {
        editorStore.set(engineErrorAtom, e.message);
      }
    });

    const statsTimer = window.setInterval(() => {
      if (!disposed) editorStore.set(engineStatsAtom, client.stats());
    }, STATS_INTERVAL_MS);

    const ro = new ResizeObserver(() => layout());
    ro.observe(container);
    window.addEventListener('resize', layout);

    /* ---------------------------------------------------------- first paint */

    const initialId = useCatalog.getState().activeId();
    if (initialId) void loadPhoto(initialId);
    layout();

    // Free caches when the tab is hidden (§6.6)
    const onVisibility = () => {
      if (document.hidden) {
        const freed = client.trim();
        if (freed > 0 && import.meta.env.DEV) console.info(`[swell] trimmed ${formatBytes(freed)} of GPU cache`);
      } else {
        render({ full: true });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(idleTimer);
      window.clearInterval(statsTimer);
      ro.disconnect();
      window.removeEventListener('resize', layout);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubCatalog();
      unsubUi();
      unsubSettings();
      unsubParams();
      unsubDevelop();
      unsubEngine();
      loadedBitmap?.close();
      loadedBitmap = null;
      client.dispose();
      handles.current.client = null;
      setEngine(null);
      editorStore.set(engineOkAtom, false);
    };
  }, [containerRef, canvasRef, enabled]);

  return handles;
}

const EMPTY_LUTS = {
  luma: new Float32Array(0),
  rgb: new Float32Array(0),
  hue: new Float32Array(0),
  hue2: new Float32Array(0),
  hueSize: 0,
  size: 0,
  cube: null,
  cubeAmount: 1,
};
