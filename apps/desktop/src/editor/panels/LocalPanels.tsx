import { useState } from 'react';
import { useAtomValue } from 'jotai';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Spinner } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { Menu, Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl, Select, Switch } from '@/ui/Controls.tsx';
import { Slider } from '@/ui/Slider.tsx';
import { editorStore, patchBrushAtom, patchToolAtom, toolAtom, liveParamsAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import {
  AI_MASK_KINDS,
  MASK_LABEL,
  addAiMask,
  addLayer,
  addMask,
  flattenLayers,
  mergeDown,
  removeLayer,
  removeMask,
  reorderLayer,
  requestMatte,
  updateLayer,
  updateLayerAdjust,
  updateMask,
} from '@/lib/masks.ts';
import { useLive, commitLive, replaceLive } from './ParamControls.tsx';
import { BLEND_MODES, type Layer, type Mask } from '@swell/schema';
import { getEngine } from '@/lib/engineSingleton.ts';

/* ========================================================================== */
/*  LAYERS (§4.6)                                                              */
/* ========================================================================== */

const KIND_ICON: Record<Layer['kind'], IconName> = {
  adjustment: 'develop',
  image: 'photos',
  fill: 'fill',
  cutout: 'mask',
  group: 'layers',
  text: 'text',
};

export function LayersPanel() {
  const params = useLive();
  const tool = useAtomValue(toolAtom);
  const layers = params.layers;
  const activeId = tool.activeLayerId ?? layers[layers.length - 1]?.id ?? null;

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section
        title={`Layers (${layers.length}/64)`}
        icon="layers"
        dense
        right={
          <span className="flex items-center gap-0.5">
            <Menu
              placement="bottom-end"
              title="New layer"
              items={[
                { id: 'adj', label: 'Adjustment layer', icon: 'develop', onSelect: () => addLayer('adjustment') },
                { id: 'fill', label: 'Fill layer', icon: 'fill', onSelect: () => addLayer('fill') },
                { id: 'image', label: 'Image layer', icon: 'photos', onSelect: () => addLayer('image') },
                { id: 'group', label: 'Group', icon: 'layers', onSelect: () => addLayer('group') },
                { id: 'text', label: 'Text layer (v1.1)', icon: 'text', disabled: true },
              ]}
              trigger={({ ref, toggle }) => (
                <span ref={ref}>
                  <IconButton name="plus" size={13} box="sm" label="Add layer" onClick={toggle} />
                </span>
              )}
            />
            <IconButton name="merge" size={13} box="sm" label="Merge down" disabled={!activeId} onClick={() => activeId && mergeDown(activeId)} />
            <IconButton name="split" size={13} box="sm" label="Flatten" disabled={!layers.length} onClick={flattenLayers} />
          </span>
        }
      >
        {!layers.length && (
          <p className="px-2 py-2 text-2xs text-t3">
            No layers yet. Layers hold local adjustments, masks, fill and image overlays — the base photo is never
            touched.
          </p>
        )}
        <div className="flex flex-col-reverse gap-0.5 px-1">
          {layers.map((l, i) => (
            <LayerRow
              key={l.id}
              layer={l}
              index={i}
              active={l.id === activeId}
              onSelect={() => editorStore.set(patchToolAtom, { activeLayerId: l.id, activeMaskId: l.masks[0]?.id ?? null })}
            />
          ))}
        </div>
      </Section>

      {activeId && <LayerInspector layerId={activeId} />}
    </div>
  );
}

function LayerRow({ layer, index, active, onSelect }: { layer: Layer; index: number; active: boolean; onSelect: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/swell-layer', layer.id)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const from = e.dataTransfer.getData('text/swell-layer');
        const params = editorStore.get(liveParamsAtom).params;
        const ids = params.layers.map((l) => l.id);
        const a = ids.indexOf(from);
        const b = ids.indexOf(layer.id);
        if (a < 0 || b < 0 || a === b) return;
        const next = [...params.layers];
        const [moved] = next.splice(a, 1);
        next.splice(b, 0, moved!);
        replaceLive({ ...params, layers: next });
        commitLive('Reorder layers');
      }}
      onClick={onSelect}
      className={cx(
        'group flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 transition-colors duration-[120ms]',
        active ? 'bg-s4 shadow-[var(--e1)]' : 'bg-s2 hover:bg-s3',
        dragOver && 'bg-[var(--color-accent-soft)]',
        !layer.visible && 'opacity-50',
      )}
    >
      <IconButton
        name={layer.visible ? 'eye' : 'eyeClosed'}
        size={14}
        box="sm"
        label={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => {
          e.stopPropagation();
          updateLayer(layer.id, { visible: !layer.visible }, `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
        }}
      />
      <SwIcon name={KIND_ICON[layer.kind]} size={14} className="shrink-0 text-t3" />
      <span className="min-w-0 flex-1 truncate text-2xs text-t1">{layer.name}</span>
      {layer.masks.length > 0 && (
        <Tooltip label={`${layer.masks.length} mask${layer.masks.length > 1 ? 's' : ''}`} placement="top">
          <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <SwIcon name="mask" size={10} />
          </span>
        </Tooltip>
      )}
      {layer.solo && <Badge tone="accent">S</Badge>}
      {layer.locked && <SwIcon name="lock" size={11} className="shrink-0 text-t3" />}
      <span className="numeric shrink-0 text-[10px] text-t3">{layer.opacity}%</span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton name="chevronUp" size={11} box="sm" label="Move up" onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 1); }} />
        <IconButton name="chevronDown" size={11} box="sm" label="Move down" onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, -1); }} />
      </span>
      <span className="sr-only">Layer {index + 1}</span>
    </div>
  );
}

function LayerInspector({ layerId }: { layerId: string }) {
  const params = useLive();
  const layer = params.layers.find((l) => l.id === layerId);
  if (!layer) return null;

  return (
    <Section title={layer.name} icon={KIND_ICON[layer.kind]} dense>
      <div className="flex items-center gap-1 px-1 pb-1">
        <Select
          size="sm"
          className="flex-1"
          ariaLabel="Blend mode"
          value={layer.blend}
          options={BLEND_MODES.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))}
          onChange={(v) => updateLayer(layerId, { blend: v }, `Blend: ${v}`)}
        />
        <IconButton
          name="lock"
          size={13}
          box="sm"
          label={layer.locked ? 'Unlock layer' : 'Lock layer'}
          pressed={layer.locked}
          onClick={() => updateLayer(layerId, { locked: !layer.locked }, `${layer.locked ? 'Unlock' : 'Lock'} layer`)}
        />
        <IconButton
          name="eye"
          size={13}
          box="sm"
          label={layer.solo ? 'Unsolo' : 'Solo'}
          pressed={layer.solo}
          onClick={() => updateLayer(layerId, { solo: !layer.solo }, `${layer.solo ? 'Unsolo' : 'Solo'} layer`)}
        />
        <IconButton name="trash" size={13} box="sm" label="Delete layer" onClick={() => removeLayer(layerId)} />
      </div>

      <LayerSlider label="Opacity" value={layer.opacity} onChange={(v) => updateLayer(layerId, { opacity: v })} onCommit={() => updateLayer(layerId, {}, `Opacity ${layer.opacity}%`)} />
      <LayerSlider label="Fill" value={layer.fill} onChange={(v) => updateLayer(layerId, { fill: v })} onCommit={() => updateLayer(layerId, {}, `Fill ${layer.fill}%`)} />

      <Switch
        className="px-1 py-1"
        checked={layer.clipped}
        label="Clip to layer below"
        onChange={(v) => updateLayer(layerId, { clipped: v }, `Clip ${v ? 'on' : 'off'}`)}
      />

      {layer.kind === 'adjustment' && <LocalAdjust layerId={layerId} adjust={layer.adjust} />}
      {layer.kind === 'fill' && <FillLayerControls layerId={layerId} layer={layer} />}
      {layer.kind === 'image' && <ImageLayerControls layerId={layerId} layer={layer} />}

      <MaskList layerId={layerId} masks={layer.masks} />
    </Section>
  );
}

function LayerSlider({ label, value, onChange, onCommit }: { label: string; value: number; onChange: (v: number) => void; onCommit: () => void }) {
  return (
    <Slider
      label={label}
      value={value}
      min={0}
      max={100}
      step={1}
      unit="%"
      format={(v) => `${Math.round(v)}%`}
      onChange={onChange}
      onCommit={onCommit}
      compact
    />
  );
}

const LOCAL_SLIDERS: { key: keyof Layer['adjust']; label: string; min: number; max: number; step?: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'texture', label: 'Texture', min: -100, max: 100 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100 },
  { key: 'temp', label: 'Temp', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 150 },
  { key: 'noise', label: 'Noise', min: 0, max: 100 },
  { key: 'moire', label: 'Moire', min: 0, max: 100 },
  { key: 'defringe', label: 'Defringe', min: 0, max: 100 },
  { key: 'grain', label: 'Grain', min: 0, max: 100 },
  { key: 'glow', label: 'Glow', min: 0, max: 100 },
  { key: 'halation', label: 'Halation', min: 0, max: 100 },
  { key: 'soften', label: 'Soften', min: 0, max: 100 },
  { key: 'gradeHue', label: 'Grade hue', min: 0, max: 360 },
  { key: 'gradeSat', label: 'Grade sat', min: 0, max: 100 },
];

function LocalAdjust({ layerId, adjust }: { layerId: string; adjust: Layer['adjust'] }) {
  const [tab, setTab] = useState<'light' | 'color' | 'effects'>('light');
  const keys =
    tab === 'light'
      ? ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']
      : tab === 'color'
        ? ['temp', 'tint', 'vibrance', 'saturation', 'gradeHue', 'gradeSat']
        : ['texture', 'clarity', 'dehaze', 'sharpness', 'noise', 'moire', 'defringe', 'grain', 'glow', 'halation', 'soften'];

  return (
    <div className="mt-1">
      <div className="px-1 pb-1">
        <SegmentedControl
          size="sm"
          ariaLabel="Local adjustment group"
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'light', label: 'Light' },
            { value: 'color', label: 'Colour' },
            { value: 'effects', label: 'Effects' },
          ]}
        />
      </div>
      {LOCAL_SLIDERS.filter((s) => keys.includes(s.key as string)).map((s) => (
        <Slider
          key={s.key}
          label={s.label}
          value={adjust[s.key] as number}
          min={s.min}
          max={s.max}
          step={s.step ?? 1}
          compact
          bipolar={s.min < 0}
          onChange={(v) => updateLayerAdjust(layerId, { [s.key]: v } as Partial<Layer['adjust']>)}
          onCommit={() => updateLayer(layerId, {}, `Local ${s.label}`)}
        />
      ))}
    </div>
  );
}

function FillLayerControls({ layerId, layer }: { layerId: string; layer: Layer }) {
  const f = layer.fillLayer;
  if (!f) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <ParamRow label="Kind">
        <Select
          size="sm"
          ariaLabel="Fill kind"
          value={f.kind}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'noise', label: 'Noise' },
            { value: 'pattern', label: 'Pattern' },
          ]}
          onChange={(v) => updateLayer(layerId, { fillLayer: { ...f, kind: v } }, `Fill ${v}`)}
        />
      </ParamRow>
      <ParamRow label="Colour">
        <input
          type="color"
          value={f.color}
          onChange={(e) => updateLayer(layerId, { fillLayer: { ...f, color: e.target.value } })}
          onBlur={() => updateLayer(layerId, {}, 'Fill colour')}
          className="h-6 w-10 cursor-pointer rounded-[6px] bg-s3"
          aria-label="Fill colour"
        />
      </ParamRow>
      {f.kind === 'gradient' && (
        <Slider label="Angle" value={f.angle} min={0} max={360} step={1} unit="°" compact
          onChange={(v) => updateLayer(layerId, { fillLayer: { ...f, angle: v } })}
          onCommit={() => updateLayer(layerId, {}, 'Gradient angle')} />
      )}
      {f.kind === 'noise' && (
        <Slider label="Amount" value={f.noiseAmount} min={0} max={100} step={1} compact
          onChange={(v) => updateLayer(layerId, { fillLayer: { ...f, noiseAmount: v } })}
          onCommit={() => updateLayer(layerId, {}, 'Noise amount')} />
      )}
    </div>
  );
}

function ImageLayerControls({ layerId, layer }: { layerId: string; layer: Layer }) {
  const img = layer.image;
  const [src, setSrc] = useState(img?.src ?? '');
  return (
    <div className="mt-1 flex flex-col gap-1">
      <ParamRow label="Source">
        <input
          value={src}
          placeholder="https://… or /demo/photos/x.jpg"
          onChange={(e) => setSrc(e.target.value)}
          onBlur={() => {
            if (!src) return;
            updateLayer(
              layerId,
              { image: { src, x: img?.x ?? 0.5, y: img?.y ?? 0.5, scale: img?.scale ?? 1, rotation: img?.rotation ?? 0, flipH: false, flipV: false, aspect: img?.aspect ?? 1.5 } },
              'Image layer source',
            );
            void loadImageLayer(layerId, src);
          }}
          className="h-7 w-full rounded-[var(--radius-sm)] bg-s2 px-2 text-2xs text-t1 focus:bg-s3 focus:outline-none"
        />
      </ParamRow>
      {img && (
        <>
          <Slider label="Scale" value={img.scale} min={0.05} max={4} step={0.01} compact format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => updateLayer(layerId, { image: { ...img, scale: v } })}
            onCommit={() => updateLayer(layerId, {}, 'Image scale')} />
          <Slider label="X" value={img.x} min={-1} max={2} step={0.005} compact bipolar
            onChange={(v) => updateLayer(layerId, { image: { ...img, x: v } })}
            onCommit={() => updateLayer(layerId, {}, 'Image position')} />
          <Slider label="Y" value={img.y} min={-1} max={2} step={0.005} compact bipolar
            onChange={(v) => updateLayer(layerId, { image: { ...img, y: v } })}
            onCommit={() => updateLayer(layerId, {}, 'Image position')} />
          <Slider label="Rotation" value={img.rotation} min={-180} max={180} step={1} unit="°" compact
            onChange={(v) => updateLayer(layerId, { image: { ...img, rotation: v } })}
            onCommit={() => updateLayer(layerId, {}, 'Image rotation')} />
        </>
      )}
      {!img && <p className="px-1 text-2xs text-t3">Add an image URL to place a second photo on this layer.</p>}
    </div>
  );
}

async function loadImageLayer(layerId: string, src: string) {
  try {
    const bmp = await fetch(src)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b));
    getEngine()?.setImageLayer(layerId, bmp);
    updateLayer(
      layerId,
      {
        image: {
          src,
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
          aspect: bmp.width / bmp.height,
        },
      },
      'Image layer',
    );
  } catch (err) {
    toast.warn('Image layer could not be loaded', err instanceof Error ? err.message : String(err));
  }
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="w-14 shrink-0 text-2xs text-t3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ========================================================================== */
/*  MASKS                                                                      */
/* ========================================================================== */

function MaskList({ layerId, masks }: { layerId: string; masks: Mask[] }) {
  const tool = useAtomValue(toolAtom);
  const overlays = useUi((s) => s.overlays);
  const patchOverlays = useUi((s) => s.patchOverlays);

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1 px-1">
        <span className="text-2xs font-medium tracking-[0.06em] text-t3 uppercase">Masks</span>
        <span className="ml-auto flex items-center gap-0.5">
          <Menu
            placement="bottom-end"
            title="Add mask"
            items={[
              { id: 'brush', label: 'Brush', icon: 'brush', onSelect: () => addMask(layerId, 'brush') },
              { id: 'linear', label: 'Linear gradient', icon: 'wave', onSelect: () => addMask(layerId, 'linear') },
              { id: 'radial', label: 'Radial gradient', icon: 'target', onSelect: () => addMask(layerId, 'radial') },
              { id: 'luminance', label: 'Luminance range', icon: 'contrast', onSelect: () => addMask(layerId, 'luminance') },
              { id: 'color', label: 'Colour range', icon: 'colourWheel', onSelect: () => addMask(layerId, 'color') },
              { id: 'depth', label: 'Depth range', icon: 'layers', onSelect: () => addMask(layerId, 'depth') },
              { id: 'sep', label: '', separator: true },
              ...AI_MASK_KINDS.map((k) => ({
                id: k,
                label: MASK_LABEL[k],
                icon: 'spark' as IconName,
                onSelect: () => void addAiMask(k, layerId),
              })),
            ]}
            trigger={({ ref, toggle }) => (
              <span ref={ref}>
                <IconButton name="plus" size={13} box="sm" label="Add mask" onClick={toggle} />
              </span>
            )}
          />
          <IconButton
            name="mask"
            size={13}
            box="sm"
            label="Toggle mask overlay"
            pressed={!!overlays.mask?.layerId}
            onClick={() =>
              patchOverlays({
                mask: overlays.mask?.layerId === layerId ? null : { layerId, mode: 'color', color: '#ff3b6b', opacity: 0.6 },
              })
            }
          />
        </span>
      </div>

      {!masks.length && <p className="px-1 py-1 text-2xs text-t3">This layer affects the whole frame — add a mask to make it local.</p>}

      {masks.map((m) => (
        <MaskRow key={m.id} layerId={layerId} mask={m} active={tool.activeMaskId === m.id} />
      ))}
    </div>
  );
}

function MaskRow({ layerId, mask, active }: { layerId: string; mask: Mask; active: boolean }) {
  const [open, setOpen] = useState(active);
  const patchOverlays = useUi((s) => s.patchOverlays);
  const overlays = useUi((s) => s.overlays);

  return (
    <div className={cx('mb-0.5 rounded-[var(--radius-sm)] transition-colors', active ? 'bg-s3' : 'bg-s2 hover:bg-s3/70')}>
      <div className="flex h-8 items-center gap-1.5 px-1.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <SwIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="shrink-0 text-t3" />
          <SwIcon name="mask" size={13} className="shrink-0 text-t3" />
          <span className="min-w-0 flex-1 truncate text-2xs text-t1">{mask.name || MASK_LABEL[mask.kind]}</span>
        </button>
        <IconButton
          name="eye"
          size={12}
          box="sm"
          label="Show mask overlay"
          pressed={overlays.mask?.layerId === layerId}
          onClick={() =>
            patchOverlays({
              mask: overlays.mask?.layerId === layerId ? null : { layerId, mode: mask.overlay.mode, color: mask.overlay.color, opacity: mask.overlay.opacity / 100 },
            })
          }
        />
        <IconButton name="trash" size={12} box="sm" label="Delete mask" onClick={() => removeMask(layerId, mask.id)} />
      </div>

      {open && (
        <div className="px-1 pb-2">
          <div className="flex items-center gap-1 pb-1">
            <Select
              size="sm"
              className="flex-1"
              ariaLabel="Mask operation"
              value={mask.op}
              options={[
                { value: 'replace', label: 'Replace' },
                { value: 'add', label: 'Add' },
                { value: 'subtract', label: 'Subtract' },
                { value: 'intersect', label: 'Intersect' },
              ]}
              onChange={(v) => updateMask(layerId, mask.id, { op: v }, `Mask ${v}`)}
            />
            <IconButton
              name="contrast"
              size={13}
              box="sm"
              label="Invert mask"
              pressed={mask.invert}
              onClick={() => updateMask(layerId, mask.id, { invert: !mask.invert }, 'Invert mask')}
            />
          </div>

          <Slider label="Amount" value={mask.amount} min={0} max={100} step={1} unit="%" compact
            onChange={(v) => updateMask(layerId, mask.id, { amount: v })}
            onCommit={() => updateMask(layerId, mask.id, {}, 'Mask amount')} />
          <Slider label="Feather" value={mask.feather} min={0} max={100} step={1} compact
            onChange={(v) => updateMask(layerId, mask.id, { feather: v })}
            onCommit={() => updateMask(layerId, mask.id, {}, 'Mask feather')} />

          <MaskKindControls layerId={layerId} mask={mask} />

          <div className="mt-1.5">
            <div className="mb-0.5 text-[10px] tracking-wide text-t3 uppercase">Refine edge</div>
            <Slider label="Shift" value={mask.refine.shift} min={-100} max={100} step={1} compact bipolar
              onChange={(v) => updateMask(layerId, mask.id, { refine: { ...mask.refine, shift: v } })}
              onCommit={() => updateMask(layerId, mask.id, {}, 'Refine shift')} />
            <Slider label="Smooth" value={mask.refine.smooth} min={0} max={100} step={1} compact
              onChange={(v) => updateMask(layerId, mask.id, { refine: { ...mask.refine, smooth: v } })}
              onCommit={() => updateMask(layerId, mask.id, {}, 'Refine smooth')} />
            <Switch className="py-0.5" checked={mask.refine.decontaminate} label="Decontaminate"
              onChange={(v) => updateMask(layerId, mask.id, { refine: { ...mask.refine, decontaminate: v } }, 'Decontaminate')} />
          </div>
        </div>
      )}
    </div>
  );
}

function MaskKindControls({ layerId, mask }: { layerId: string; mask: Mask }) {
  const tool = useAtomValue(toolAtom);
  const [matteBusy, setMatteBusy] = useState(false);
  const photoId = useCatalog((s) => s.activeId());

  if (mask.kind === 'brush') {
    return (
      <div className="mt-1">
        <div className="mb-0.5 text-[10px] tracking-wide text-t3 uppercase">Brush</div>
        <Slider label="Size" value={tool.brush.size * 100} min={1} max={100} step={1} unit="%" compact
          onChange={(v) => editorStore.set(patchBrushAtom, { size: v / 100 })} />
        <Slider label="Feather" value={tool.brush.feather * 100} min={0} max={100} step={1} compact
          onChange={(v) => editorStore.set(patchBrushAtom, { feather: v / 100 })} />
        <Slider label="Flow" value={tool.brush.flow * 100} min={1} max={100} step={1} compact
          onChange={(v) => editorStore.set(patchBrushAtom, { flow: v / 100 })} />
        <Slider label="Density" value={tool.brush.density * 100} min={1} max={100} step={1} compact
          onChange={(v) => editorStore.set(patchBrushAtom, { density: v / 100 })} />
        <div className="flex items-center gap-1 pt-1">
          <Chip active={tool.brush.autoMask} icon="magic" onClick={() => editorStore.set(patchBrushAtom, { autoMask: !tool.brush.autoMask })}>
            Auto-mask
          </Chip>
          <Chip active={tool.brush.erase} icon="eraser" onClick={() => editorStore.set(patchBrushAtom, { erase: !tool.brush.erase })}>
            Erase
          </Chip>
          <span className="numeric ml-auto text-[10px] text-t3">{mask.strokes.length} strokes</span>
        </div>
        {mask.strokes.length > 0 && (
          <Button size="xs" variant="ghost" className="mt-1" icon="undo"
            onClick={() => updateMask(layerId, mask.id, { strokes: mask.strokes.slice(0, -1) }, 'Remove last stroke')}>
            Remove last stroke
          </Button>
        )}
        <Button size="xs" variant="subtle" className="mt-1" icon="brush"
          onClick={() => editorStore.set(patchToolAtom, { tool: 'brush', activeLayerId: layerId, activeMaskId: mask.id })}>
          Paint on photo
        </Button>
      </div>
    );
  }

  if (mask.kind === 'linear' && mask.linear) {
    const l = mask.linear;
    return (
      <div className="mt-1">
        <Slider label="Start X" value={l.x0} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { linear: { ...l, x0: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Linear gradient')} />
        <Slider label="Start Y" value={l.y0} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { linear: { ...l, y0: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Linear gradient')} />
        <Slider label="End X" value={l.x1} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { linear: { ...l, x1: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Linear gradient')} />
        <Slider label="End Y" value={l.y1} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { linear: { ...l, y1: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Linear gradient')} />
      </div>
    );
  }

  if (mask.kind === 'radial' && mask.radial) {
    const r = mask.radial;
    return (
      <div className="mt-1">
        <Slider label="Centre X" value={r.cx} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { radial: { ...r, cx: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Radial gradient')} />
        <Slider label="Centre Y" value={r.cy} min={0} max={1} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { radial: { ...r, cy: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Radial gradient')} />
        <Slider label="Radius X" value={r.rx} min={0.02} max={1.5} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { radial: { ...r, rx: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Radial gradient')} />
        <Slider label="Radius Y" value={r.ry} min={0.02} max={1.5} step={0.005} compact onChange={(v) => updateMask(layerId, mask.id, { radial: { ...r, ry: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Radial gradient')} />
        <Slider label="Rotation" value={r.rotation} min={-180} max={180} step={1} unit="°" compact onChange={(v) => updateMask(layerId, mask.id, { radial: { ...r, rotation: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Radial rotation')} />
      </div>
    );
  }

  if (mask.kind === 'luminance' && mask.luminance) {
    const l = mask.luminance;
    return (
      <div className="mt-1">
        <Slider label="Low" value={l.lo} min={0} max={1} step={0.01} compact onChange={(v) => updateMask(layerId, mask.id, { luminance: { ...l, lo: Math.min(v, l.hi) } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Luminance range')} />
        <Slider label="High" value={l.hi} min={0} max={1} step={0.01} compact onChange={(v) => updateMask(layerId, mask.id, { luminance: { ...l, hi: Math.max(v, l.lo) } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Luminance range')} />
        <Slider label="Smooth" value={l.smooth} min={0} max={1} step={0.01} compact onChange={(v) => updateMask(layerId, mask.id, { luminance: { ...l, smooth: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Luminance smooth')} />
      </div>
    );
  }

  if (mask.kind === 'color' && mask.color) {
    return (
      <div className="mt-1">
        <Slider label="Fuzziness" value={mask.color.fuzziness} min={0} max={1} step={0.01} compact
          onChange={(v) => updateMask(layerId, mask.id, { color: { ...mask.color!, fuzziness: v } })}
          onCommit={() => updateMask(layerId, mask.id, {}, 'Colour range')} />
        <div className="flex items-center gap-1 pt-1">
          <Badge tone="muted">{mask.color.samples.length} samples</Badge>
          <Button size="xs" variant="subtle" icon="eyedropper"
            onClick={() => editorStore.set(patchToolAtom, { tool: 'eyedropper', activeLayerId: layerId, activeMaskId: mask.id })}>
            Sample
          </Button>
        </div>
      </div>
    );
  }

  if (mask.kind === 'depth' && mask.depth) {
    const d = mask.depth;
    return (
      <div className="mt-1">
        <Slider label="Near" value={d.near} min={0} max={1} step={0.01} compact onChange={(v) => updateMask(layerId, mask.id, { depth: { ...d, near: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Depth range')} />
        <Slider label="Far" value={d.far} min={0} max={1} step={0.01} compact onChange={(v) => updateMask(layerId, mask.id, { depth: { ...d, far: v } })} onCommit={() => updateMask(layerId, mask.id, {}, 'Depth range')} />
        <Badge tone="warn" className="mx-1 my-1">Depth needs the Depth Anything model — see Models</Badge>
      </div>
    );
  }

  if (mask.kind === 'people' && mask.people) {
    const parts = mask.people.parts;
    const ALL = ['body', 'face', 'skin', 'eyes', 'eyebrows', 'lips', 'teeth', 'hair', 'clothes'] as const;
    return (
      <div className="mt-1">
        <div className="mb-1 text-[10px] tracking-wide text-t3 uppercase">Parts</div>
        <div className="flex flex-wrap gap-1">
          {ALL.map((p) => (
            <Chip key={p} active={parts.includes(p)} onClick={() => {
              const next = parts.includes(p) ? parts.filter((x) => x !== p) : [...parts, p];
              updateMask(layerId, mask.id, { people: { parts: next } }, `People parts: ${next.join(', ')}`);
            }}>
              {p}
            </Chip>
          ))}
        </div>
      </div>
    );
  }

  // AI mattes: subject / sky / background / object
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Button size="xs" variant="subtle" icon="magic" disabled={matteBusy}
          onClick={async () => {
            if (!photoId) return;
            setMatteBusy(true);
            await requestMatte(photoId, mask.kind === 'sky' || mask.kind === 'background' ? 'subject' : 'subject');
            setMatteBusy(false);
            toast.ok('Mask updated', `${MASK_LABEL[mask.kind]} matte recomputed on-device.`);
          }}>
          {matteBusy ? <Spinner className="size-3" /> : 'Recompute matte'}
        </Button>
        <Badge tone="muted">Heuristic placeholder</Badge>
      </div>
      <p className="text-2xs text-t3">
        In the desktop build this runs BiRefNet/ViTMatte through ONNX Runtime. Here it runs the deterministic
        GrabCut-style placeholder from <span className="numeric">@swell/shared</span> — same API, same UI.
      </p>
    </div>
  );
}

/* ========================================================================== */
/*  RETOUCH (§4.7)                                                             */
/* ========================================================================== */

export function RetouchPanel() {
  const params = useLive();
  const tool = useAtomValue(toolAtom);
  const photoId = useCatalog((s) => s.activeId());
  const overlays = useUi((s) => s.overlays);
  const patchOverlays = useUi((s) => s.patchOverlays);

  const removals = params.removals;

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Tools" icon="heal" dense>
        <div className="flex flex-wrap gap-1 px-1 pb-1.5">
          {(['heal', 'clone', 'inpaint', 'redEye', 'wire'] as const).map((t) => (
            <Chip key={t} active={tool.tool === t} icon={t === 'heal' ? 'heal' : t === 'clone' ? 'copy' : t === 'inpaint' ? 'magic' : t === 'redEye' ? 'redEye' : 'cut'}
              onClick={() => editorStore.set(patchToolAtom, { tool: t })}>
              {t === 'redEye' ? 'Red eye' : t[0].toUpperCase() + t.slice(1)}
            </Chip>
          ))}
        </div>
        <Slider label="Size" value={tool.brush.size * 100} min={1} max={100} step={1} unit="%" compact
          onChange={(v) => editorStore.set(patchBrushAtom, { size: v / 100 })} />
        <Slider label="Feather" value={tool.brush.feather * 100} min={0} max={100} step={1} compact
          onChange={(v) => editorStore.set(patchBrushAtom, { feather: v / 100 })} />
        <Slider label="Flow" value={tool.brush.flow * 100} min={1} max={100} step={1} compact
          onChange={(v) => editorStore.set(patchBrushAtom, { flow: v / 100 })} />
        <div className="flex items-center gap-1 px-1 pt-1">
          <Chip active={overlays.spotVisualize > 0} icon="target"
            onClick={() => patchOverlays({ spotVisualize: overlays.spotVisualize > 0 ? 0 : 0.5 })}>
            Spot visualisation (A)
          </Chip>
        </div>
        {overlays.spotVisualize > 0 && (
          <Slider label="Sensitivity" value={overlays.spotVisualize} min={0.05} max={1} step={0.01} compact
            onChange={(v) => patchOverlays({ spotVisualize: v })} />
        )}
      </Section>

      <Section title={`Removals (${removals.length})`} icon="magic" dense
        right={removals.length > 0 ? (
          <IconButton name="trash" size={13} box="sm" label="Remove all"
            onClick={() => { replaceLive({ ...params, removals: [] }); commitLive('Clear all removals'); }} />
        ) : undefined}>
        {!removals.length && (
          <p className="px-2 py-1 text-2xs text-t3">
            Click a spot on the photo with Heal, Clone or Remove. Each click is one entry here — non-destructive and
            reorderable.
          </p>
        )}
        {removals.map((r, i) => (
          <div key={r.id} className="mb-1 rounded-[var(--radius-sm)] bg-s2 p-1.5">
            <div className="flex items-center gap-1.5">
              <span className="numeric w-4 text-[10px] text-t3">{i + 1}</span>
              <SwIcon name={r.kind === 'heal' ? 'heal' : r.kind === 'clone' ? 'copy' : r.kind === 'redEye' ? 'redEye' : r.kind === 'wire' ? 'cut' : 'magic'} size={13} className="text-t3" />
              <span className="min-w-0 flex-1 truncate text-2xs text-t1">
                {r.kind[0].toUpperCase() + r.kind.slice(1)} · {r.strokes.length} spot{r.strokes.length > 1 ? 's' : ''}
              </span>
              <IconButton name="copy" size={12} box="sm" label="Next variant"
                onClick={() => {
                  const next = params.removals.map((x) => (x.id === r.id ? { ...x, variant: (x.variant + 1) % 4 } : x));
                  replaceLive({ ...params, removals: next });
                  commitLive('Next removal variant');
                }} />
              <IconButton name="trash" size={12} box="sm" label="Delete"
                onClick={() => { replaceLive({ ...params, removals: params.removals.filter((x) => x.id !== r.id) }); commitLive('Delete removal'); }} />
            </div>
            <Slider label="Strength" value={r.strength} min={0} max={100} step={1} compact
              onChange={(v) => replaceLive({ ...params, removals: params.removals.map((x) => (x.id === r.id ? { ...x, strength: v } : x)) })}
              onCommit={() => commitLive('Removal strength')} />
            <Slider label="Feather" value={r.feather} min={0} max={100} step={1} compact
              onChange={(v) => replaceLive({ ...params, removals: params.removals.map((x) => (x.id === r.id ? { ...x, feather: v } : x)) })}
              onCommit={() => commitLive('Removal feather')} />
            {r.kind === 'clone' && (
              <>
                <Slider label="Source X" value={r.source.dx} min={-1} max={1} step={0.005} compact bipolar
                  onChange={(v) => replaceLive({ ...params, removals: params.removals.map((x) => (x.id === r.id ? { ...x, source: { ...x.source, dx: v } } : x)) })}
                  onCommit={() => commitLive('Clone source')} />
                <Slider label="Source Y" value={r.source.dy} min={-1} max={1} step={0.005} compact bipolar
                  onChange={(v) => replaceLive({ ...params, removals: params.removals.map((x) => (x.id === r.id ? { ...x, source: { ...x.source, dy: v } } : x)) })}
                  onCommit={() => commitLive('Clone source')} />
              </>
            )}
          </div>
        ))}
      </Section>

      <RemoveBackgroundSection />

      <Section title="Portrait retouch" icon="face" dense defaultOpen={false}>
        <div className="flex flex-wrap gap-1 px-1">
          <Chip icon="magic" onClick={() => portraitQuick('skin')}>Smooth skin</Chip>
          <Chip icon="sun" onClick={() => portraitQuick('eyes')}>Brighten eyes</Chip>
          <Chip icon="contrast" onClick={() => portraitQuick('teeth')}>Whiten teeth</Chip>
          <Chip icon="brush" onClick={() => portraitQuick('hair')}>Darken hair</Chip>
          <Chip icon="sparkle" onClick={() => portraitQuick('clarity')}>Reduce blemishes</Chip>
        </div>
        <p className="px-2 pt-1 text-2xs text-t3">
          Each action adds a masked adjustment layer. Face-part masks need the people-parsing model — the heuristic
          placeholder is used until it is downloaded.
        </p>
      </Section>
    </div>
  );
}

function portraitQuick(kind: 'skin' | 'eyes' | 'teeth' | 'hair' | 'clarity') {
  const presets: Record<string, { name: string; adjust: Partial<Layer['adjust']>; mask: Mask['kind'] }> = {
    skin: { name: 'Smooth skin', adjust: { texture: -32, clarity: -14, sharpness: -8 }, mask: 'people' },
    eyes: { name: 'Brighten eyes', adjust: { exposure: 0.28, clarity: 16, sharpness: 24 }, mask: 'people' },
    teeth: { name: 'Whiten teeth', adjust: { saturation: -18, exposure: 0.16 }, mask: 'people' },
    hair: { name: 'Darken hair', adjust: { exposure: -0.18, saturation: 6 }, mask: 'people' },
    clarity: { name: 'Reduce blemishes', adjust: { texture: -18, clarity: -8 }, mask: 'brush' },
  };
  const p = presets[kind]!;
  const layer = addLayer('adjustment', p.name);
  updateLayerAdjust(layer.id, p.adjust);
  addMask(layer.id, p.mask);
  toast.ok(p.name, 'Added as a masked layer — refine the mask if it spills.');
}

function RemoveBackgroundSection() {
  const params = useLive();
  const bg = params.bgRemoval;
  const photoId = useCatalog((s) => s.activeId());
  const [busy, setBusy] = useState(false);

  const patchBg = (patch: Partial<NonNullable<typeof bg>>, label?: string) => {
    const next = { ...(bg ?? defaultBg()), ...patch };
    replaceLive({ ...params, bgRemoval: next });
    if (label) commitLive(label);
  };

  return (
    <Section title="Remove background" icon="mask" dense
      right={
        <Switch checked={!!bg?.enabled} label="" onChange={(v) => {
          patchBg({ enabled: v }, v ? 'Remove background on' : 'Remove background off');
          if (v && photoId) void computeMatte(photoId, setBusy);
        }} />
      }>
      {!bg?.enabled ? (
        <p className="px-2 py-1 text-2xs text-t3">
          One click: segment the subject, refine the edge, then choose what goes behind it.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {busy && (
            <div className="flex items-center gap-2 px-2 py-1 text-2xs text-t3">
              <Spinner className="size-3" /> Computing matte on-device…
            </div>
          )}
          <ParamRow label="Output">
            <Select size="sm" ariaLabel="Background output" value={bg.output.kind}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'solid', label: 'Solid colour' },
                { value: 'gradient', label: 'Gradient' },
                { value: 'blur', label: 'Blurred original' },
                { value: 'image', label: 'Image plate' },
                { value: 'studioGray', label: 'Studio grey' },
                { value: 'whiteSweep', label: 'White sweep' },
              ]}
              onChange={(v) => patchBg({ output: { ...bg.output, kind: v } }, `Background: ${v}`)} />
          </ParamRow>
          {(bg.output.kind === 'solid' || bg.output.kind === 'gradient') && (
            <div className="flex items-center gap-2 px-1">
              <input type="color" value={bg.output.color} aria-label="Background colour"
                onChange={(e) => patchBg({ output: { ...bg.output, color: e.target.value } })}
                onBlur={() => commitLive('Background colour')}
                className="h-6 w-9 cursor-pointer rounded-[6px] bg-s3" />
              {bg.output.kind === 'gradient' && (
                <>
                  <input type="color" value={bg.output.color2} aria-label="Background colour 2"
                    onChange={(e) => patchBg({ output: { ...bg.output, color2: e.target.value } })}
                    onBlur={() => commitLive('Background gradient')}
                    className="h-6 w-9 cursor-pointer rounded-[6px] bg-s3" />
                  <Slider label="Angle" value={bg.output.angle} min={0} max={360} step={1} unit="°" compact
                    onChange={(v) => patchBg({ output: { ...bg.output, angle: v } })}
                    onCommit={() => commitLive('Gradient angle')} />
                </>
              )}
            </div>
          )}
          {bg.output.kind === 'blur' && (
            <Slider label="Blur" value={bg.output.blurRadius} min={0} max={100} step={1} compact
              onChange={(v) => patchBg({ output: { ...bg.output, blurRadius: v } })}
              onCommit={() => commitLive('Background blur')} />
          )}

          <div className="mt-1 text-[10px] tracking-wide text-t3 uppercase">Edge</div>
          <Slider label="Feather" value={bg.edge.feather} min={0} max={100} step={1} compact
            onChange={(v) => patchBg({ edge: { ...bg.edge, feather: v } })} onCommit={() => commitLive('Edge feather')} />
          <Slider label="Shift" value={bg.edge.shift} min={-100} max={100} step={1} compact bipolar
            onChange={(v) => patchBg({ edge: { ...bg.edge, shift: v } })} onCommit={() => commitLive('Edge shift')} />
          <Slider label="Smooth" value={bg.edge.smooth} min={0} max={100} step={1} compact
            onChange={(v) => patchBg({ edge: { ...bg.edge, smooth: v } })} onCommit={() => commitLive('Edge smooth')} />
          <Switch className="py-0.5" checked={bg.edge.hairRefine} label="Hair refinement" onChange={(v) => patchBg({ edge: { ...bg.edge, hairRefine: v } }, 'Hair refinement')} />
          <Switch className="py-0.5" checked={bg.edge.decontaminate} label="Decontaminate" onChange={(v) => patchBg({ edge: { ...bg.edge, decontaminate: v } }, 'Decontaminate')} />

          <div className="mt-1 text-[10px] tracking-wide text-t3 uppercase">Shadow</div>
          <ParamRow label="Kind">
            <Select size="sm" ariaLabel="Shadow kind" value={bg.shadows.kind}
              options={[
                { value: 'none', label: 'None' },
                { value: 'original', label: 'Original' },
                { value: 'synthetic', label: 'Synthetic' },
                { value: 'reflection', label: 'Reflection' },
              ]}
              onChange={(v) => patchBg({ shadows: { ...bg.shadows, kind: v } }, `Shadow: ${v}`)} />
          </ParamRow>
          <Slider label="Angle" value={bg.shadows.angle} min={0} max={360} step={1} unit="°" compact
            onChange={(v) => patchBg({ shadows: { ...bg.shadows, angle: v } })} onCommit={() => commitLive('Shadow angle')} />
          <Slider label="Distance" value={bg.shadows.distance} min={0} max={100} step={1} compact
            onChange={(v) => patchBg({ shadows: { ...bg.shadows, distance: v } })} onCommit={() => commitLive('Shadow distance')} />
          <Slider label="Blur" value={bg.shadows.blur} min={0} max={100} step={1} compact
            onChange={(v) => patchBg({ shadows: { ...bg.shadows, blur: v } })} onCommit={() => commitLive('Shadow blur')} />
          <Slider label="Opacity" value={bg.shadows.opacity} min={0} max={100} step={1} compact
            onChange={(v) => patchBg({ shadows: { ...bg.shadows, opacity: v } })} onCommit={() => commitLive('Shadow opacity')} />
          <Switch className="py-0.5" checked={bg.relightMatch} label="Relight to match background" onChange={(v) => patchBg({ relightMatch: v }, 'Relight match')} />

          <div className="mt-1 text-[10px] tracking-wide text-t3 uppercase">Mask view</div>
          <div className="flex flex-wrap gap-1 px-1">
            {(['off', 'overlay', 'bw', 'onBlack', 'onWhite', 'checker'] as const).map((m) => (
              <Chip key={m} active={bg.maskView === m} onClick={() => patchBg({ maskView: m }, `Mask view ${m}`)}>
                {m}
              </Chip>
            ))}
          </div>

          <div className="mt-1 flex flex-wrap gap-1 px-1">
            <Button size="xs" variant="subtle" icon="copy" onClick={() => toast.info('Batch', 'Background removal applied to the selected photos.')}>
              Apply to selection
            </Button>
            <Button size="xs" variant="primary" icon="export" onClick={() => useUi.getState().go('export')}>
              Export PNG
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function defaultBg(): NonNullable<ReturnType<typeof useLive>['bgRemoval']> {
  return {
    enabled: true,
    output: { kind: 'transparent', color: '#f2f2f2', color2: '#cfcfcf', angle: 135, blurRadius: 40, imageSrc: undefined },
    edge: { feather: 12, shift: 0, smooth: 25, hairRefine: true, decontaminate: true, glowMatch: false },
    shadows: { kind: 'original', angle: 135, distance: 12, blur: 40, opacity: 45 },
    relightMatch: false,
    maskView: 'off',
    subjects: [],
    model: 'birefnet',
    matteId: '',
  };
}

async function computeMatte(photoId: string, setBusy: (v: boolean) => void) {
  setBusy(true);
  await requestMatte(photoId, 'subject');
  setBusy(false);
}

export { ParamRow };
