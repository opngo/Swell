import { useState } from 'react';
import { useAtomValue } from 'jotai';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { IconButton, Badge } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl } from '@/ui/Controls.tsx';
import { Stage } from './Stage.tsx';
import { editorStore, histogramAtom, patchToolAtom, toolAtom, type ToolId } from '@/state/atoms.ts';
import { useUi, ROUTE_META, type RouteId } from '@/state/ui.ts';
import { useCatalog } from '@/state/catalog.ts';
import { Histogram, HistogramStats } from '@/ui/Histogram.tsx';
import { formatShutter, formatAperture, formatFocal } from '@swell/shared';
import type { HistogramPayload } from '@swell/schema';

/**
 * Pages 4–7 share this shell (§4): a tool bar, the stage, and the inspector on
 * the right (rendered by Shell). The filmstrip sits below, in Shell.
 */
export function EditorShell({ route }: { route: RouteId }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar route={route} />
      <div className="flex min-h-0 flex-1">
        <Stage />
        <SideHistogram />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ toolbars */

const TOOLS: Record<'develop' | 'curves' | 'layers' | 'retouch', { id: ToolId; icon: IconName; label: string; key?: string }[]> = {
  develop: [
    { id: 'move', icon: 'menu', label: 'Pan / zoom', key: 'V' },
    { id: 'crop', icon: 'crop', label: 'Crop & straighten', key: 'R' },
    { id: 'straighten', icon: 'angle', label: 'Draw a straighten line', key: '⇧R' },
    { id: 'eyedropper', icon: 'eyedropper', label: 'White balance eyedropper', key: 'W' },
    { id: 'guides', icon: 'grid', label: 'Composition guides', key: 'O' },
  ],
  curves: [
    { id: 'move', icon: 'menu', label: 'Pan / zoom', key: 'V' },
    { id: 'eyedropper', icon: 'eyedropper', label: 'Sample a point on the curve', key: 'W' },
    { id: 'guides', icon: 'curvePoints', label: 'Targeted adjustment (drag on photo)', key: '⌘' },
  ],
  layers: [
    { id: 'brush', icon: 'brush', label: 'Brush mask', key: 'K' },
    { id: 'linear', icon: 'wave', label: 'Linear gradient', key: 'M' },
    { id: 'radial', icon: 'target', label: 'Radial gradient', key: '⇧M' },
    { id: 'rangeColor', icon: 'colourWheel', label: 'Colour range' },
    { id: 'rangeLuma', icon: 'contrast', label: 'Luminance range' },
    { id: 'subject', icon: 'spark', label: 'Select subject' },
    { id: 'sky', icon: 'sun', label: 'Select sky' },
    { id: 'background', icon: 'mask', label: 'Select background' },
    { id: 'people', icon: 'people', label: 'Select people' },
    { id: 'object', icon: 'scan', label: 'Select objects' },
  ],
  retouch: [
    { id: 'heal', icon: 'heal', label: 'Heal', key: 'Q' },
    { id: 'clone', icon: 'copy', label: 'Clone', key: 'S' },
    { id: 'inpaint', icon: 'magic', label: 'Remove (content-aware)', key: '⇧R' },
    { id: 'spot', icon: 'target', label: 'Spot visualisation', key: 'A' },
    { id: 'redEye', icon: 'redEye', label: 'Red / pet eye' },
    { id: 'wire', icon: 'cut', label: 'Wire removal' },
  ],
};

export function EditorToolbar({ route }: { route: RouteId }) {
  const tool = useAtomValue(toolAtom);
  const patchOverlays = useUi((s) => s.patchOverlays);
  const overlays = useUi((s) => s.overlays);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const key = (route === 'develop' ? 'develop' : route === 'curves' ? 'curves' : route === 'layers' ? 'layers' : 'retouch') as keyof typeof TOOLS;

  return (
    <div className="relative z-20 flex h-11 shrink-0 items-center gap-2 bg-s1 px-2">
      {/* tools */}
      <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] bg-s2 p-0.5">
        {TOOLS[key].map((t) => (
          <Tooltip key={t.id} label={t.label} shortcut={t.key} placement="bottom">
            <span>
              <IconButton
                name={t.icon}
                label={t.label}
                size={17}
                box="sm"
                pressed={tool.tool === t.id}
                onClick={() => {
                  editorStore.set(patchToolAtom, { tool: t.id });
                  if (t.id === 'spot') patchOverlays({ spotVisualize: overlays.spotVisualize > 0 ? 0 : 0.5 });
                  if (t.id === 'guides') patchOverlays({ cropGuides: overlays.cropGuides === 'off' ? 'thirds' : 'off' });
                }}
              />
            </span>
          </Tooltip>
        ))}
      </div>

      {/* photo identity + EXIF */}
      {photo && (
        <div className="ml-1 flex min-w-0 items-baseline gap-2">
          <span className="numeric truncate text-xs text-t1">{photo.filename}</span>
          <span className="numeric hidden shrink-0 text-2xs text-t3 lg:inline">
            {photo.camera} · {formatFocal(photo.focalMm)} · {formatAperture(photo.aperture)} ·{' '}
            {formatShutter(photo.shutter)} · ISO {photo.iso}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {/* zoom */}
        <SegmentedControl
          size="sm"
          ariaLabel="Zoom"
          value={view.zoom === 1 ? 'fit' : view.zoom >= 0.99 && view.zoom <= 1.01 ? '100' : 'custom'}
          onChange={(v) => setView({ zoom: v === 'fit' ? 1 : v === '100' ? 1 : view.zoom, panX: 0, panY: 0, mode: v === 'fit' ? 'fit' : '100' })}
          segments={[
            { value: 'fit', icon: 'panoramaOut', title: 'Fit (0)' },
            { value: '100', icon: 'panoramaIn', title: '1:1 (1)' },
            { value: 'custom', label: `${Math.round(view.zoom * 100)}%`, title: 'Custom zoom' },
          ]}
        />

        <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}

        {/* overlays */}
        <Tooltip label="Clipping warning" placement="bottom" shortcut="J">
          <span>
            <IconButton
              name="contrast"
              label="Clipping warning"
              box="sm"
              pressed={overlays.clipping !== 'off'}
              onClick={() =>
                patchOverlays({ clipping: overlays.clipping === 'off' ? 'both' : 'off' })
              }
            />
          </span>
        </Tooltip>
        <Tooltip label="Composition guides" placement="bottom" shortcut="O">
          <span>
            <IconButton
              name="grid"
              label="Composition guides"
              box="sm"
              pressed={overlays.cropGuides !== 'off'}
              onClick={() => patchOverlays({ cropGuides: overlays.cropGuides === 'off' ? 'thirds' : 'off' })}
            />
          </span>
        </Tooltip>
        <Tooltip label="Detections" placement="bottom" shortcut="⇧D">
          <span>
            <IconButton
              name="scan"
              label="Detection overlays"
              box="sm"
              pressed={overlays.detectionBoxes}
              onClick={() => patchOverlays({ detectionBoxes: !overlays.detectionBoxes })}
            />
          </span>
        </Tooltip>
        <Tooltip label="Spot visualisation" placement="bottom" shortcut="A">
          <span>
            <IconButton
              name="target"
              label="Spot visualisation"
              box="sm"
              pressed={overlays.spotVisualize > 0}
              onClick={() => patchOverlays({ spotVisualize: overlays.spotVisualize > 0 ? 0 : 0.5 })}
            />
          </span>
        </Tooltip>
        <Tooltip label="Soft proof" placement="bottom" shortcut="S">
          <span>
            <IconButton
              name="colourFilter"
              label="Soft proof"
              box="sm"
              pressed={useUi.getState().softProof.enabled}
              onClick={() => {
                const sp = useUi.getState().softProof;
                useUi.getState().patchSoftProof({ enabled: !sp.enabled });
              }}
            />
          </span>
        </Tooltip>
        <Tooltip label="Before / after" placement="bottom" shortcut="\">
          <span>
            <IconButton
              name="split"
              label="Before / after split"
              box="sm"
              pressed={useUi.getState().beforeAfter.mode !== 'off'}
              onClick={() => {
                const ba = useUi.getState().beforeAfter;
                useUi.getState().patchBeforeAfter({ mode: ba.mode === 'off' ? 'split' : 'off' });
              }}
            />
          </span>
        </Tooltip>

        <Badge tone="muted" className="ml-1 hidden xl:inline-flex">
          {ROUTE_META[route].num}. {ROUTE_META[route].label}
        </Badge>
      </div>
    </div>
  );
}

/* -------------------------------------------------- floating histogram card */

function SideHistogram() {
  const histogram = useAtomValue(histogramAtom);
  const [expanded, setExpanded] = useState(true);
  const [log, setLog] = useState(true);

  return (
    <aside className={cx('hidden w-56 shrink-0 flex-col gap-2 overflow-y-auto bg-s1 p-2 2xl:flex')}>
      <div className="flex items-center gap-1">
        <SwIcon name="histogram" size={15} className="text-t3" />
        <span className="text-2xs font-medium text-t2">Histogram</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton name="wave" label="Log scale" size={13} box="sm" pressed={log} onClick={() => setLog(!log)} />
          <IconButton
            name={expanded ? 'chevronUp' : 'chevronDown'}
            label={expanded ? 'Collapse' : 'Expand'}
            size={13}
            box="sm"
            onClick={() => setExpanded(!expanded)}
          />
        </span>
      </div>
      {expanded && (
        <>
          <Histogram data={histogram} log={log} height={104} />
          <HistogramStats data={histogram} />
        </>
      )}
      <ToneRegions histogram={histogram} />
    </aside>
  );
}

function ToneRegions({ histogram }: { histogram: HistogramPayload | null }) {
  if (!histogram) return null;
  const zones = [
    { label: 'Blacks', from: 0, to: 0.1 },
    { label: 'Shadows', from: 0.1, to: 0.32 },
    { label: 'Midtones', from: 0.32, to: 0.68 },
    { label: 'Highlights', from: 0.68, to: 0.9 },
    { label: 'Whites', from: 0.9, to: 1 },
  ];
  const mass = (from: number, to: number) => {
    let sum = 0;
    const bins = histogram.luma.length;
    for (let i = Math.floor(from * bins); i < Math.min(bins, Math.ceil(to * bins)); i++) sum += histogram.luma[i] ?? 0;
    return sum;
  };
  const total = mass(0, 1) || 1;
  return (
    <div className="rounded-[var(--radius-md)] bg-s2 p-2">
      <div className="mb-1.5 text-2xs text-t3">Tonal mass</div>
      {zones.map((z) => {
        const v = mass(z.from, z.to) / total;
        return (
          <div key={z.label} className="mb-1 last:mb-0">
            <div className="flex items-baseline justify-between text-2xs">
              <span className="text-t3">{z.label}</span>
              <span className="numeric text-t2">{Math.round(v * 100)}%</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-s3">
              <div className="h-full rounded-full bg-[var(--color-accent)]/70" style={{ width: `${Math.min(100, v * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
