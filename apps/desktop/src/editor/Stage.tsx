import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { editorStore, liveParamsAtom, patchLiveAtom, commitGestureAtom, stageAtom, toolAtom, patchToolAtom, viewMathAtom, engineOkAtom, mattesAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { useEngineStage } from './useEngine.ts';
import { clientToSource, sourceToCanvas, type ViewMath } from './coords.ts';
import { findDust, type Spot } from '@/lib/dustFinder.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { emptyLayer, emptyMask } from '@/lib/masks.ts';
import { toast } from '@/state/toasts.ts';
import { uid } from '@swell/shared';
import type { Detection } from '@swell/schema';

/* -------------------------------------------------------------------------- */
/*  Stage — the photo surface (§4.4–4.7)                                       */
/*                                                                             */
/*  The canvas is painted by the engine; React only draws *vector* overlays on  */
/*  top of it (crop guides, detection fills, brush cursor, spot map). Nothing   */
/*  here re-renders during a slider drag.                                      */
/* -------------------------------------------------------------------------- */

export function Stage({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handles = useEngineStage(containerRef, canvasRef);

  const ok = useAtomValue(engineOkAtom);
  const vm = useAtomValue(viewMathAtom);
  const tool = useAtomValue(toolAtom);
  const stage = useAtomValue(stageAtom);
  const overlays = useUi((s) => s.overlays);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const beforeAfter = useUi((s) => s.beforeAfter);
  const softProof = useUi((s) => s.softProof);
  const patchBeforeAfter = useUi((s) => s.patchBeforeAfter);
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const detections = useCatalog((s) => (photo ? s.detections[photo.id] : undefined));

  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [dragCrop, setDragCrop] = useState<null | { mode: string; start: { x: number; y: number }; crop: { x: number; y: number; w: number; h: number } }>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  /* ------------------------------------------------------------ keyboard */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* --------------------------------------------------- spot visualisation */
  useEffect(() => {
    if (!overlays.spotVisualize || !photo) {
      setSpots([]);
      return;
    }
    let cancelled = false;
    void imageLoader
      .imageData(photo.src, 512)
      .then((img) => {
        if (!cancelled) setSpots(findDust(img, overlays.spotVisualize));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [overlays.spotVisualize, photo?.src, photo]);

  /* -------------------------------------------------------- wheel = zoom */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = canvasRef.current;
      const cur = handles.current.viewMath;
      if (!el || !cur) return;
      const rect = el.getBoundingClientRect();
      const cxp = (e.clientX - rect.left) / rect.width;
      const cyp = (e.clientY - rect.top) / rect.height;

      const factor = Math.exp(-e.deltaY * 0.0016);
      const nextZoom = Math.min(16, Math.max(0.1, view.zoom * factor));
      if (nextZoom === view.zoom) return;

      // keep the point under the cursor fixed
      const srcBefore = clientToSource(cur, rect, e.clientX, e.clientY);
      setView({ zoom: nextZoom, mode: nextZoom === 1 ? 'fit' : 'custom' });
      requestAnimationFrame(() => {
        const next = handles.current.viewMath;
        if (!next) return;
        const rect2 = el.getBoundingClientRect();
        const now = clientToSource(next, rect2, rect2.left + cxp * rect2.width, rect2.top + cyp * rect2.height);
        const dx = srcBefore.x - now.x;
        const dy = srcBefore.y - now.y;
        setView({ panX: view.panX + dx, panY: view.panY + dy });
      });
    },
    [handles, setView, view.zoom, view.panX, view.panY],
  );

  /* --------------------------------------------------------- pointer down */
  const onPointerDown = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    const cur = handles.current.viewMath;
    if (!el || !cur) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const src = clientToSource(cur, rect, e.clientX, e.clientY);
    lastPointer.current = { x: e.clientX, y: e.clientY };

    const wantsPan = space || e.button === 1 || tool.tool === 'move';
    if (wantsPan) {
      setPanning(true);
      editorStore.set(stageAtom, { ...editorStore.get(stageAtom), dragging: true });
      return;
    }

    if (tool.tool === 'crop') {
      const live = editorStore.get(liveParamsAtom).params;
      setDragCrop({ mode: 'move', start: src, crop: { ...live.geometry.crop } });
      return;
    }

    if (tool.tool === 'eyedropper') {
      const px = handles.current.client?.pickColor(e.clientX - rect.left, e.clientY - rect.top, el);
      if (px) {
        editorStore.set(stageAtom, { ...editorStore.get(stageAtom), readout: px });
        // sample white balance from the clicked neutral
        const live = editorStore.get(liveParamsAtom).params;
        const r = px.r / 255;
        const g = px.g / 255;
        const b = px.b / 255;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1e-4;
        const tempShift = Math.round(((r - b) / lum) * -900);
        const tintShift = Math.round(((g - (r + b) / 2) / lum) * -420);
        editorStore.set(patchLiveAtom, {
          wb: {
            temp: Math.min(50000, Math.max(2000, live.wb.temp + tempShift)),
            tint: Math.min(150, Math.max(-150, live.wb.tint + tintShift)),
            mode: 'custom',
          },
        });
        editorStore.set(commitGestureAtom, 'White balance from point');
        toast.info('White balance sampled', `${Math.round(editorStore.get(liveParamsAtom).params.wb.temp)} K · tint ${Math.round(editorStore.get(liveParamsAtom).params.wb.tint)}`);
      }
      return;
    }

    if (tool.tool === 'brush' || tool.tool === 'linear' || tool.tool === 'radial') {
      editorStore.set(stageAtom, { ...editorStore.get(stageAtom), painting: true, strokePoints: [] });
      if (tool.tool === 'brush') addBrushStrokePoint(src.x, src.y, cur);
      return;
    }

    if (['heal', 'clone', 'inpaint', 'redEye', 'wire'].includes(tool.tool)) {
      addRemoval(tool.tool as 'heal' | 'clone' | 'inpaint' | 'redEye' | 'wire', src.x, src.y, cur);
      editorStore.set(stageAtom, { ...editorStore.get(stageAtom), painting: true, strokePoints: [] });
      return;
    }

    if (['subject', 'sky', 'background', 'people', 'object'].includes(tool.tool)) {
      void createAiMask(tool.tool as 'subject' | 'sky' | 'background' | 'people' | 'object');
      return;
    }

    if (tool.tool === 'straighten') {
      editorStore.set(stageAtom, { ...editorStore.get(stageAtom), painting: true, strokePoints: [{ x: src.x, y: src.y, r: 0 }] });
    }
  };

  /* --------------------------------------------------------- pointer move */
  const onPointerMove = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    const cur = handles.current.viewMath;
    if (!el || !cur) return;
    const rect = el.getBoundingClientRect();
    const src = clientToSource(cur, rect, e.clientX, e.clientY);
    editorStore.set(stageAtom, { ...editorStore.get(stageAtom), cursor: { x: src.x, y: src.y } });

    if (panning) {
      const dx = (e.clientX - lastPointer.current.x) / rect.width;
      const dy = (e.clientY - lastPointer.current.y) / rect.height;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      const scale = cur.view.w;
      setView({ panX: clamp(view.panX - dx * scale, -0.5, 0.5), panY: clamp(view.panY - dy * scale, -0.5, 0.5) });
      return;
    }

    if (dragCrop) {
      const live = editorStore.get(liveParamsAtom).params;
      const dx = src.x - dragCrop.start.x;
      const dy = src.y - dragCrop.start.y;
      let { x, y, w, h } = dragCrop.crop;
      if (dragCrop.mode === 'move') {
        x = clamp(dragCrop.crop.x + dx, 0, 1 - w);
        y = clamp(dragCrop.crop.y + dy, 0, 1 - h);
      } else {
        const right = clamp(dragCrop.crop.x + dragCrop.crop.w + dx, 0.05, 1);
        const bottom = clamp(dragCrop.crop.y + dragCrop.crop.h + dy, 0.05, 1);
        x = dragCrop.mode.startsWith('w') ? clamp(dragCrop.crop.x + dx, 0, right - 0.05) : dragCrop.crop.x;
        y = dragCrop.mode.startsWith('n') ? clamp(dragCrop.crop.y + dy, 0, bottom - 0.05) : dragCrop.crop.y;
        w = right - x;
        h = bottom - y;
      }
      editorStore.set(patchLiveAtom, { geometry: { ...live.geometry, crop: { ...live.geometry.crop, x, y, w, h } } });
      return;
    }

    if (stage.painting && tool.tool === 'brush') {
      addBrushStrokePoint(src.x, src.y, cur);
      return;
    }

    if (stage.painting && tool.tool === 'straighten') {
      const pts = editorStore.get(stageAtom).strokePoints;
      editorStore.set(stageAtom, {
        ...editorStore.get(stageAtom),
        strokePoints: [...pts.slice(0, 1), { x: src.x, y: src.y, r: 0 }],
      });
    }
  };

  /* ----------------------------------------------------------- pointer up */
  const onPointerUp = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    setPanning(false);
    editorStore.set(stageAtom, { ...editorStore.get(stageAtom), dragging: false, painting: false });

    if (dragCrop) {
      setDragCrop(null);
      editorStore.set(commitGestureAtom, 'Crop');
      return;
    }

    if (tool.tool === 'brush' && editorStore.get(liveParamsAtom).dirty) {
      editorStore.set(commitGestureAtom, tool.brush.erase ? 'Erase mask' : 'Brush mask');
      return;
    }

    if (tool.tool === 'straighten') {
      const pts = editorStore.get(stageAtom).strokePoints;
      if (pts.length === 2) {
        const angle = (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI;
        const live = editorStore.get(liveParamsAtom).params;
        editorStore.set(patchLiveAtom, {
          geometry: { ...live.geometry, crop: { ...live.geometry.crop, angle: clamp(-angle, -45, 45) } },
        });
        editorStore.set(commitGestureAtom, 'Straighten');
        toast.info('Straightened', `${(-angle).toFixed(1)}°`);
      }
      editorStore.set(stageAtom, { ...editorStore.get(stageAtom), strokePoints: [] });
    }

    if (['linear', 'radial'].includes(tool.tool)) {
      // the gradient mask is created on pointer-down by the tool palette;
      // here we just finalise the gesture
      if (editorStore.get(liveParamsAtom).dirty) editorStore.set(commitGestureAtom, `${tool.tool} gradient mask`);
    }
  };

  /* ------------------------------------------------------- tool actions */

  const addBrushStrokePoint = (x: number, y: number, cur: ViewMath) => {
    const live = editorStore.get(liveParamsAtom);
    const layerId = tool.activeLayerId ?? live.params.layers[0]?.id;
    if (!layerId) {
      toast.warn('No layer selected', 'Create an adjustment layer first (⌥⌘N).');
      return;
    }
    const layers = live.params.layers.map((l) => {
      if (l.id !== layerId) return l;
      let masks = l.masks;
      const activeId = tool.activeMaskId;
      let mask = masks.find((m) => m.id === activeId);
      if (!mask) {
        mask = {
          ...emptyMask('brush'),
          id: uid('mask'),
          name: tool.brush.erase ? 'Erase' : 'Brush mask',
        };
        masks = [...masks, mask];
      }
      const r = (tool.brush.size * cur.view.w) / Math.max(cur.crop.w, 1e-4);
      masks = masks.map((m) =>
        m.id === mask!.id
          ? {
              ...m,
              // schema units are percentages (1..100), tool state is 0..1
              brush: {
                ...m.brush,
                size: Math.round(tool.brush.size * 100),
                feather: Math.round(tool.brush.feather * 100),
                flow: Math.round(tool.brush.flow * 100),
                density: Math.round(tool.brush.density * 100),
                autoMask: tool.brush.autoMask,
                erase: tool.brush.erase,
              },
              strokes: [
                ...m.strokes,
                { x, y, r, feather: tool.brush.feather, flow: tool.brush.flow, erase: tool.brush.erase, path: [] },
              ],
            }
          : m,
      );
      editorStore.set(patchToolAtom, { activeLayerId: layerId, activeMaskId: mask.id });
      return { ...l, masks };
    });
    editorStore.set(patchLiveAtom, { layers });
  };

  const addRemoval = (kind: 'heal' | 'clone' | 'inpaint' | 'redEye' | 'wire', x: number, y: number, cur: ViewMath) => {
    const live = editorStore.get(liveParamsAtom);
    const r = Math.max(0.006, (tool.brush.size * cur.view.w) / Math.max(cur.crop.w, 1e-4) / 2);
    const removals = [
      ...live.params.removals,
      {
        id: uid('rem'),
        kind,
        strokes: [{ x, y, r, feather: 0.4, flow: 1, erase: false, path: [] }],
        source: { dx: 0.08, dy: -0.06 },
        strength: 100,
        feather: 40,
        autoSource: true,
        variant: 0,
      },
    ];
    editorStore.set(patchLiveAtom, { removals });
    editorStore.set(commitGestureAtom, `${kind[0].toUpperCase()}${kind.slice(1)} spot`);
  };

  const createAiMask = async (kind: 'subject' | 'sky' | 'background' | 'people' | 'object') => {
    const live = editorStore.get(liveParamsAtom);
    const id = live.photoId || (useCatalog.getState().activeId() ?? '');
    let layerId = tool.activeLayerId;
    let layers = live.params.layers;
    if (!layerId) {
      layerId = uid('layer');
      layers = [
        ...layers,
        {
          ...emptyLayer('adjustment'),
          id: layerId,
          name: `${kind[0].toUpperCase()}${kind.slice(1)} adjustment`,
        },
      ];
    }
    const maskId = uid('mask');
    layers = layers.map((l) =>
      l.id === layerId
        ? {
            ...l,
            masks: [
              ...l.masks,
              {
                ...emptyMask(kind),
                id: maskId,
                name: `${kind[0].toUpperCase()}${kind.slice(1)} mask`,
              },
            ],
          }
        : l,
    );
    editorStore.set(patchLiveAtom, { layers });
    editorStore.set(patchToolAtom, { activeLayerId: layerId, activeMaskId: maskId });
    editorStore.set(commitGestureAtom, `Add ${kind} mask`);

    const mattes = editorStore.get(mattesAtom);
    if (!mattes[`${id}:subject`]) {
      toast.info('Computing mask', 'On-device segmentation — nothing leaves this machine.');
      handles.current.invalidate?.();
    }
  };

  /* -------------------------------------------------------------- render */
  const showGuides = overlays.cropGuides !== 'off' || tool.tool === 'crop' || overlays.straighten;

  return (
    <div
      ref={containerRef}
      className={cx('canvas-bg relative min-h-0 flex-1 overflow-hidden', className)}
      onDoubleClick={() => setView({ zoom: view.zoom === 1 ? 2 : 1, panX: 0, panY: 0, mode: view.zoom === 1 ? 'custom' : 'fit' })}
    >
      {/* the photo */}
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="relative"
          style={{ width: vm?.canvasW ?? 0, height: vm?.canvasH ?? 0 }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => editorStore.set(stageAtom, { ...editorStore.get(stageAtom), cursor: null })}
        >
          <canvas
            ref={canvasRef}
            className={cx(
              'absolute inset-0 size-full rounded-[2px] shadow-[var(--e2)]',
              space || tool.tool === 'move' ? 'cursor-grab' : cursorFor(tool.tool),
              panning && 'cursor-grabbing',
              !ok && 'opacity-0',
            )}
            aria-label={photo ? `${photo.title || photo.filename} — edited preview` : 'Photo preview'}
            role="img"
          />

          {/* Fallback when the GPU renderer is unavailable: the unedited file. */}
          {!ok && photo && (
            <img
              src={photo.src}
              alt={`${photo.title || photo.filename} (unedited fallback)`}
              className="absolute inset-0 size-full rounded-[2px] object-fill shadow-[var(--e2)]"
              draggable={false}
            />
          )}

          {vm && (
            <>
              {overlays.detectionBoxes && detections && <DetectionOverlay detections={detections} vm={vm} />}
              {overlays.spotVisualize > 0 && <SpotOverlay spots={spots} vm={vm} />}
              {showGuides && <CropGuides mode={overlays.cropGuides === 'off' ? 'thirds' : overlays.cropGuides} vm={vm} />}
              {tool.tool === 'crop' && <CropFrame vm={vm} onHandle={(mode, start) => setDragCrop({ mode, start, crop: { x: 0, y: 0, w: 1, h: 1 } })} />}
              {beforeAfter.mode === 'split' && (
                <SplitHandle value={beforeAfter.split} onChange={(v) => patchBeforeAfter({ split: v })} />
              )}
              {tool.tool === 'brush' && stage.cursor && <BrushCursor vm={vm} cursor={stage.cursor} size={tool.brush.size} erase={tool.brush.erase} />}
              {tool.tool === 'straighten' && stage.strokePoints.length === 2 && <StraightenLine vm={vm} pts={stage.strokePoints} />}
            </>
          )}
        </div>
      </div>

      {/* corner HUD */}
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
        <AnimatePresence>
          {overlays.clipping !== 'off' && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Badge tone="warn">Clipping {overlays.clipping}</Badge>
            </motion.div>
          )}
        </AnimatePresence>
        {softProof.enabled && <Badge tone="accent">Proofing {softProof.profile}</Badge>}
        {!ok && <Badge tone="danger">GPU off — unedited preview</Badge>}
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-2">
        {stage.cursor && stage.readout && (
          <span className="glass numeric rounded-[var(--radius-pill)] px-2 py-1 text-2xs text-t2 shadow-[var(--e1)]">
            R {stage.readout.r} · G {stage.readout.g} · B {stage.readout.b}
          </span>
        )}
        <Tooltip label="Zoom" placement="top">
          <span className="glass numeric pointer-events-auto flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-1 text-2xs text-t2 shadow-[var(--e1)]">
            <SwIcon name="zoomIn" size={12} />
            {Math.round(view.zoom * 100)}%
          </span>
        </Tooltip>
      </div>

      {!photo && (
        <div className="absolute inset-0 grid place-items-center text-t3">
          <div className="flex flex-col items-center gap-2">
            <SwIcon name="photos" size={28} />
            <span className="text-xs">Select a photo to start editing</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ overlays */

function cursorFor(tool: string) {
  switch (tool) {
    case 'brush':
    case 'heal':
    case 'clone':
    case 'inpaint':
      return 'cursor-crosshair';
    case 'eyedropper':
      return 'cursor-cell';
    case 'crop':
    case 'straighten':
      return 'cursor-crosshair';
    default:
      return 'cursor-default';
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Detections are translucent FILLS — never stroked rectangles (§8.3). */
function DetectionOverlay({ detections, vm }: { detections: Detection[]; vm: ViewMath }) {
  const boxes = detections.filter((d) => d.bbox);
  if (!boxes.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boxes.map((d) => {
        const [x, y, w, h] = d.bbox!;
        const a = sourceToCanvas(vm, x, y);
        const b = sourceToCanvas(vm, x + w, y + h);
        const left = Math.min(a.x, b.x) * 100;
        const top = Math.min(a.y, b.y) * 100;
        const width = Math.abs(b.x - a.x) * 100;
        const height = Math.abs(b.y - a.y) * 100;
        return (
          <div
            key={d.id}
            className="absolute rounded-[var(--radius-sm)]"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
              background: `linear-gradient(160deg, oklch(0.78 0.12 200 / ${0.1 + d.score * 0.14}), oklch(0.78 0.12 200 / 0.04))`,
              boxShadow: 'inset 0 0 24px oklch(0.78 0.12 200 / 0.14)',
            }}
          >
            <span className="glass absolute -top-5 left-0 rounded-[6px] px-1.5 py-0.5 text-[10px] whitespace-nowrap text-t2">
              {d.label} <span className="numeric opacity-60">{Math.round(d.score * 100)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The one place a 1 px line is allowed: a toggleable photo-content guide. */
function CropGuides({ mode, vm }: { mode: string; vm: ViewMath }) {
  const lines = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    if (mode === 'thirds' || mode === 'grid') {
      for (const t of mode === 'grid' ? [0.2, 0.4, 0.6, 0.8] : [1 / 3, 2 / 3]) {
        out.push({ x1: t, y1: 0, x2: t, y2: 1 });
        out.push({ x1: 0, y1: t, x2: 1, y2: t });
      }
    }
    if (mode === 'diagonal') {
      out.push({ x1: 0, y1: 0, x2: 1, y2: 1 });
      out.push({ x1: 1, y1: 0, x2: 0, y2: 1 });
    }
    if (mode === 'triangle') {
      out.push({ x1: 0, y1: 1, x2: 1, y2: 0 });
      out.push({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
    }
    if (mode === 'golden') {
      for (const t of [0.382, 0.618]) {
        out.push({ x1: t, y1: 0, x2: t, y2: 1 });
        out.push({ x1: 0, y1: t, x2: 1, y2: t });
      }
    }
    return out;
  }, [mode]);

  void vm;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      {lines.map((l, i) => (
        <line
          key={i}
          x1={`${l.x1 * 100}%`}
          y1={`${l.y1 * 100}%`}
          x2={`${l.x2 * 100}%`}
          y2={`${l.y2 * 100}%`}
          stroke="rgba(255,255,255,0.34)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {mode === 'spiral' && (
        <path
          d="M50,50 m-40,0 a40,40 0 1,1 40,40 a30,30 0 1,1 -30,-30 a20,20 0 1,1 20,20 a12,12 0 1,1 -12,-12"
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          transform="scale(1,1)"
          style={{ transformOrigin: 'center' }}
        />
      )}
    </svg>
  );
}

function CropFrame({ vm, onHandle }: { vm: ViewMath; onHandle: (mode: string, start: { x: number; y: number }) => void }) {
  const live = useAtomValue(liveParamsAtom);
  const crop = live.params.geometry.crop;
  const a = sourceToCanvas(vm, crop.x, crop.y);
  const b = sourceToCanvas(vm, crop.x + crop.w, crop.y + crop.h);
  const left = Math.min(a.x, b.x) * 100;
  const top = Math.min(a.y, b.y) * 100;
  const width = Math.abs(b.x - a.x) * 100;
  const height = Math.abs(b.y - a.y) * 100;
  void onHandle;

  const handles = [
    { mode: 'nw', cls: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
    { mode: 'ne', cls: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
    { mode: 'sw', cls: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
    { mode: 'se', cls: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  ];

  return (
    <div
      className="pointer-events-none absolute rounded-[3px]"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        boxShadow: '0 0 0 9999px oklch(0.1 0.008 250 / 0.55)',
      }}
    >
      {handles.map((h) => (
        <span key={h.mode} className={cx('pointer-events-auto absolute size-3 rounded-full bg-t1/90 shadow-[var(--e2)]', h.cls)} />
      ))}
    </div>
  );
}

function SpotOverlay({ spots, vm }: { spots: Spot[]; vm: ViewMath }) {
  if (!spots.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {spots.map((s, i) => {
        const c = sourceToCanvas(vm, s.x, s.y);
        const r = Math.max(6, (s.r / Math.max(vm.crop.w, 1e-4)) * vm.canvasW);
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              width: r * 2,
              height: r * 2,
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(circle, oklch(0.82 0.14 80 / ${0.18 + s.score * 0.3}) 0%, transparent 70%)`,
            }}
          />
        );
      })}
    </div>
  );
}

function BrushCursor({ vm, cursor, size, erase }: { vm: ViewMath; cursor: { x: number; y: number }; size: number; erase: boolean }) {
  const c = sourceToCanvas(vm, cursor.x, cursor.y);
  const r = (size * vm.view.w * vm.canvasW) / 2;
  return (
    <span
      aria-hidden
      className={cx(
        'pointer-events-none absolute rounded-full transition-[width,height] duration-[80ms]',
        erase ? 'bg-[oklch(0.68_0.19_25/0.14)]' : 'bg-[oklch(1_0_0/0.12)]',
      )}
      style={{
        left: `${c.x * 100}%`,
        top: `${c.y * 100}%`,
        width: r * 2,
        height: r * 2,
        transform: 'translate(-50%,-50%)',
        boxShadow: erase
          ? '0 0 0 1px oklch(0.68 0.19 25 / 0.55), inset 0 0 12px oklch(0.68 0.19 25 / 0.3)'
          : '0 0 0 1px oklch(1 0 0 / 0.5), inset 0 0 12px oklch(1 0 0 / 0.16)',
      }}
    />
  );
}

function StraightenLine({ vm, pts }: { vm: ViewMath; pts: { x: number; y: number }[] }) {
  const a = sourceToCanvas(vm, pts[0].x, pts[0].y);
  const b = sourceToCanvas(vm, pts[1].x, pts[1].y);
  const angle = (Math.atan2((b.y - a.y) * vm.canvasH, (b.x - a.x) * vm.canvasW) * 180) / Math.PI;
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="size-full" aria-hidden>
        <line
          x1={`${a.x * 100}%`}
          y1={`${a.y * 100}%`}
          x2={`${b.x * 100}%`}
          y2={`${b.y * 100}%`}
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="glass numeric absolute top-2 left-1/2 -translate-x-1/2 rounded-[var(--radius-pill)] px-2 py-1 text-2xs">
        {(-angle).toFixed(2)}°
      </span>
    </div>
  );
}

function SplitHandle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const el = ref.current?.parentElement;
      if (!el) return;
      const r = el.getBoundingClientRect();
      onChange(clamp((e.clientX - r.left) / r.width, 0.02, 0.98));
    };
    const up = () => setDrag(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, onChange]);

  return (
    <div
      ref={ref}
      className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize"
      style={{ left: `${value * 100}%` }}
      onPointerDown={() => setDrag(true)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Before/after split"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-t1/70 shadow-[0_0_12px_oklch(0_0_0/0.5)]" />
      <span className="glass absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-t1 shadow-[var(--e2)]">
        <SwIcon name="split" size={13} />
      </span>
      <span className="glass absolute top-2 left-1/2 -translate-x-[130%] rounded-[6px] px-1.5 py-0.5 text-[10px] text-t3">
        Before
      </span>
      <span className="glass absolute top-2 left-1/2 translate-x-[30%] rounded-[6px] px-1.5 py-0.5 text-[10px] text-t3">
        After
      </span>
    </div>
  );
}
