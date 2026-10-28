/**
 * Light Curves (§5.5 / page 5) — the flagship editor.
 *
 *  · point curves for luma (RGB master) and each of R/G/B
 *  · parametric curve with four zone sliders and three draggable split handles
 *  · hue-indexed curves: H→H, H→S, H→L, L→S, S→S (periodic by OKLCH hue)
 *  · ≤16 points, monotone-cubic / smooth / linear interpolation
 *  · histogram behind the grid, targeted adjustment (drag on the photo),
 *    numeric point table, curve presets, invert / mirror
 *
 * Everything writes into `params.curves`, which `buildCurveLuts()` turns into
 * the 4096-entry LUTs the engine uploads — so what you see here is exactly
 * what renders, and what exports.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { Menu, Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl, Select } from '@/ui/Controls.tsx';
import { Slider } from '@/ui/Slider.tsx';
import { histogramAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { useLive, replaceLive, commitLive } from './ParamControls.tsx';
import {
  CURVE_PRESETS,
  INVERT_CURVE,
  MIRROR_CURVE,
  clamp01,
  normalizePoints,
  sampleCurve,
  sampleParametric,
  samplePeriodic,
  type CurveInterpolation,
  type CurvePoint,
} from '@swell/shared';
import type { Curves, DevelopParams } from '@swell/schema';

type ChannelId = 'luma' | 'r' | 'g' | 'b';
type HueChannelId = 'hh' | 'hs' | 'hl' | 'ls' | 'ss';

const CHANNELS: { id: ChannelId; label: string; color: string }[] = [
  { id: 'luma', label: 'RGB', color: 'var(--color-t1)' },
  { id: 'r', label: 'R', color: 'oklch(0.68 0.2 25)' },
  { id: 'g', label: 'G', color: 'oklch(0.75 0.17 145)' },
  { id: 'b', label: 'B', color: 'oklch(0.66 0.19 255)' },
];

const HUE_CHANNELS: { id: HueChannelId; label: string; hint: string }[] = [
  { id: 'hh', label: 'H→H', hint: 'Shift hue by hue' },
  { id: 'hs', label: 'H→S', hint: 'Saturation by hue' },
  { id: 'hl', label: 'H→L', hint: 'Luminance by hue' },
  { id: 'ls', label: 'L→S', hint: 'Saturation by luminance' },
  { id: 'ss', label: 'S→S', hint: 'Saturation by saturation' },
];

const SIZE = 248;
const PAD = 8;

export function CurvesPanel() {
  const params = useLive();
  const curves = params.curves;
  const [tab, setTab] = useState<'point' | 'hue'>('point');
  const [channel, setChannel] = useState<ChannelId>('luma');
  const [hueChannel, setHueChannel] = useState<HueChannelId>('hh');

  const setCurves = (patch: Partial<Curves>, label?: string) => {
    replaceLive({ ...params, curves: { ...curves, ...patch } });
    if (label) commitLive(label);
  };

  const points: CurvePoint[] = tab === 'point' ? curves[channel] : curves.hueCurves[hueChannel];
  const setPoints = (next: CurvePoint[], label?: string) => {
    if (tab === 'point') setCurves({ [channel]: normalizePoints(next).slice(0, 16) } as Partial<Curves>, label);
    else setCurves({ hueCurves: { ...curves.hueCurves, [hueChannel]: next.slice(0, 16) } }, label);
  };

  const isHue = tab === 'hue';
  const identity = isHue ? 0 : undefined;

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Tone curve" icon="curve" dense
        right={
          <span className="flex items-center gap-0.5">
            <Tooltip label="Invert curve" placement="left">
              <span><IconButton name="contrast" size={13} box="sm" label="Invert curve" onClick={() => setPoints(INVERT_CURVE(points), 'Invert curve')} /></span>
            </Tooltip>
            <Tooltip label="Mirror curve" placement="left">
              <span><IconButton name="merge" size={13} box="sm" label="Mirror curve" onClick={() => setPoints(MIRROR_CURVE(points), 'Mirror curve')} /></span>
            </Tooltip>
            <Tooltip label="Reset curve" placement="left">
              <span><IconButton name="restart" size={13} box="sm" label="Reset curve" onClick={() => setPoints(isHue ? [] : [{ x: 0, y: 0 }, { x: 1, y: 1 }], 'Reset curve')} /></span>
            </Tooltip>
          </span>
        }>
        <div className="px-1 pb-1.5">
          <SegmentedControl
            size="sm"
            ariaLabel="Curve mode"
            value={tab === 'hue' ? 'hue' : curves.mode}
            onChange={(v) => {
              if (v === 'hue') setTab('hue');
              else {
                setTab('point');
                setCurves({ mode: v as 'point' | 'parametric' });
              }
            }}
            segments={[
              { value: 'point', label: 'Point' },
              { value: 'parametric', label: 'Parametric' },
              { value: 'hue', label: 'Hue' },
            ]}
          />
        </div>

        {tab === 'point' && curves.mode === 'point' && (
          <>
            <div className="flex items-center gap-1 px-1 pb-1.5">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannel(c.id)}
                  aria-pressed={channel === c.id}
                  className={cx(
                    'numeric h-6 min-w-7 rounded-[var(--radius-sm)] px-1.5 text-2xs transition-colors',
                    channel === c.id ? 'bg-s4 text-t1 shadow-[var(--e1)]' : 'bg-s2 text-t3 hover:bg-s3',
                  )}
                  style={channel === c.id ? { color: c.color } : undefined}
                >
                  {c.label}
                </button>
              ))}
              <span className="numeric ml-auto text-[10px] text-t3">{points.length}/16</span>
            </div>
            <CurveEditor
              points={points}
              onChange={setPoints}
              color={CHANNELS.find((c) => c.id === channel)!.color}
              interpolation={curves.interpolation}
              channel={channel}
              identity={identity}
            />
          </>
        )}

        {tab === 'point' && curves.mode === 'parametric' && <ParametricEditor curves={curves} setCurves={setCurves} />}

        {tab === 'hue' && (
          <>
            <div className="flex flex-wrap items-center gap-1 px-1 pb-1.5">
              {HUE_CHANNELS.map((c) => (
                <Chip key={c.id} active={hueChannel === c.id} onClick={() => setHueChannel(c.id)} title={c.hint}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <CurveEditor
              points={points}
              onChange={setPoints}
              color="var(--color-accent)"
              interpolation="monotone"
              periodic
              identity={0}
              channel={hueChannel}
            />
            <p className="px-2 pt-1 text-2xs text-t3">
              {HUE_CHANNELS.find((c) => c.id === hueChannel)?.hint} — periodic, so the curve wraps at 0°/360°.
            </p>
          </>
        )}

        <div className="mt-1.5 px-1">
          <Select
            size="sm"
            ariaLabel="Interpolation"
            value={curves.interpolation}
            options={[
              { value: 'monotone', label: 'Monotone cubic (no overshoot)' },
              { value: 'smooth', label: 'Natural spline (smooth)' },
              { value: 'linear', label: 'Linear' },
            ]}
            onChange={(v) => setCurves({ interpolation: v as CurveInterpolation }, `Interpolation ${v}`)}
          />
        </div>
        <Slider
          label="Amount"
          value={curves.amount * 100}
          min={0}
          max={200}
          step={1}
          unit="%"
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => setCurves({ amount: v / 100 })}
          onCommit={() => commitLive('Curve amount')}
        />
        <div className="flex items-center gap-1 px-1 pt-0.5">
          <Chip active={curves.lockLuminosity} icon="contrast" onClick={() => setCurves({ lockLuminosity: !curves.lockLuminosity }, 'Lock luminosity')}>
            Lock luminosity
          </Chip>
          <Menu
            placement="bottom-end"
            title="Curve presets"
            items={CURVE_PRESETS.map((p) => ({ id: p.id, label: p.label, icon: 'curve' as const, onSelect: () => setPoints(normalizePoints(p.points), `Preset ${p.label}`) }))}
            trigger={({ ref, toggle }) => (
              <span ref={ref}>
                <Button size="xs" variant="ghost" icon="sparkle" onClick={toggle}>Presets</Button>
              </span>
            )}
          />
        </div>
      </Section>

      <TargetedAdjustment channel={tab === 'hue' ? null : channel} setPoints={setPoints} points={points} />
      <PointTable points={points} onChange={setPoints} periodic={tab === 'hue'} />
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

interface CurveEditorProps {
  points: CurvePoint[];
  onChange: (pts: CurvePoint[], label?: string) => void;
  color: string;
  interpolation: CurveInterpolation;
  channel: ChannelId | HueChannelId;
  /** y value of the identity line: undefined → diagonal, 0 → horizontal */
  identity?: number;
  periodic?: boolean;
}

function CurveEditor({ points, onChange, color, interpolation, channel, identity, periodic }: CurveEditorProps) {
  const histogram = useAtomValue(histogramAtom);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const isHue = identity === 0 && !!periodic;
  const inner = SIZE - PAD * 2;

  const toPx = (p: CurvePoint) => ({
    x: PAD + p.x * inner,
    y: isHue ? PAD + (0.5 - p.y) * inner : PAD + (1 - p.y) * inner,
  });
  const toPoint = (px: number, py: number): CurvePoint => ({
    x: clamp01((px - PAD) / inner),
    y: isHue ? Math.max(-0.5, Math.min(0.5, 0.5 - (py - PAD) / inner)) : clamp01(1 - (py - PAD) / inner),
  });

  const sorted = useMemo(() => (periodic ? points : normalizePoints(points)), [points, periodic]);
  const path = useMemo(() => buildPath(sorted, interpolation, isHue, PAD, inner), [sorted, interpolation, isHue, inner]);

  const local = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  const onDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(index);
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    setHover(toPoint(p.x, p.y));
    if (drag === null) return;
    const next = toPoint(p.x, p.y);
    const cur = sorted[drag]!;
    if (!periodic && (drag === 0 || drag === sorted.length - 1)) next.x = cur.x; // endpoints: y only
    const arr = sorted.map((s, i) => (i === drag ? next : s));
    onChange(periodic ? arr : normalizePoints(arr));
  };

  const onUp = () => {
    if (drag !== null) {
      setDrag(null);
      onChange(sorted, `Curve point ${channel.toUpperCase()}`);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * SIZE;
    const py = ((e.clientY - r.top) / r.height) * SIZE;
    const p = toPoint(px, py);
    if (sorted.length >= 16) return;
    const hit = sorted.findIndex((s) => Math.hypot(toPx(s).x - px, toPx(s).y - py) < 9);
    if (hit >= 0) {
      onChange(sorted.filter((_, i) => i !== hit), 'Remove curve point');
      return;
    }
    onChange(periodic ? [...sorted, p] : normalizePoints([...sorted, p]), 'Add curve point');
  };

  const hist = histogram ? (channel === 'r' ? histogram.r : channel === 'g' ? histogram.g : channel === 'b' ? histogram.b : histogram.luma) : null;
  const histPath = hist ? histogramPath(hist, PAD, inner, SIZE) : '';

  return (
    <div className="relative px-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full touch-none rounded-[var(--radius-md)] bg-s2 shadow-[var(--e-inset)]"
        style={{ aspectRatio: '1 / 1' }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          onUp();
        }}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label={`${channel} curve editor — double-click to add or remove a point, drag points to shape the curve`}
      >
        {/* histogram */}
        {histPath && (
          <path d={histPath} fill={channel === 'luma' ? 'rgba(255,255,255,0.14)' : color} opacity={channel === 'luma' ? 1 : 0.2} />
        )}

        {/* grid */}
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} stroke="rgba(255,255,255,0.07)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            <line x1={PAD + t * inner} y1={PAD} x2={PAD + t * inner} y2={SIZE - PAD} />
            <line x1={PAD} y1={PAD + t * inner} x2={SIZE - PAD} y2={PAD + t * inner} />
          </g>
        ))}

        {/* identity */}
        {isHue ? (
          <line x1={PAD} y1={SIZE / 2} x2={SIZE - PAD} y2={SIZE / 2} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" strokeWidth="1" />
        ) : (
          <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={PAD} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" strokeWidth="1" />
        )}

        {/* hue ramp under hue curves */}
        {isHue && (
          <rect x={PAD} y={SIZE - PAD - 4} width={inner} height="4" rx="2" fill="url(#hueRamp)" opacity="0.7" />
        )}
        <defs>
          <linearGradient id="hueRamp" x1="0" y1="0" x2="1" y2="0">
            {Array.from({ length: 13 }, (_, i) => (
              <stop key={i} offset={`${(i / 12) * 100}%`} stopColor={`oklch(0.72 0.15 ${i * 30})`} />
            ))}
          </linearGradient>
        </defs>

        {/* curve */}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {/* points */}
        {sorted.map((p, i) => {
          const px = toPx(p);
          return (
            <g key={i}>
              <circle
                cx={px.x}
                cy={px.y}
                r={drag === i ? 7 : 5.5}
                fill="var(--color-s1)"
                stroke={color}
                strokeWidth="2"
                className="cursor-grab"
                onPointerDown={(e) => onDown(e, i)}
              />
              {drag === i && <circle cx={px.x} cy={px.y} r="12" fill={color} opacity="0.14" />}
            </g>
          );
        })}

        {/* crosshair readout */}
        {hover && !isHue && (
          <g pointerEvents="none">
            <line x1={toPx(hover).x} y1={PAD} x2={toPx(hover).x} y2={SIZE - PAD} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <line x1={PAD} y1={toPx(hover).y} x2={SIZE - PAD} y2={toPx(hover).y} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          </g>
        )}
      </svg>

      <div className="numeric pointer-events-none absolute right-2 bottom-2 rounded-[6px] bg-s1/85 px-1.5 py-0.5 text-[10px] text-t2">
        {hover
          ? isHue
            ? `hue ${Math.round(hover.x * 360)}° · Δ ${(hover.y * 100).toFixed(0)}`
            : `in ${(hover.x * 255).toFixed(0)} → out ${(hover.y * 255).toFixed(0)}`
          : 'double-click to add a point'}
      </div>
    </div>
  );
}

function buildPath(pts: CurvePoint[], interp: CurveInterpolation, isHue: boolean, pad: number, inner: number): string {
  const N = 128;
  const yAt = (x: number) => {
    if (isHue) return 0.5 - samplePeriodic(pts, x);
    if (pts.length < 2) return x;
    return sampleCurve(pts, x, interp);
  };
  let d = '';
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const y = yAt(x);
    const px = pad + x * inner;
    const py = pad + (isHue ? (0.5 - y) * inner : (1 - y) * inner);
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
  }
  return d;
}

function histogramPath(bins: ArrayLike<number>, pad: number, inner: number, size: number): string {
  if (!bins.length) return '';
  let max = 1;
  for (let i = 0; i < bins.length; i++) max = Math.max(max, bins[i] ?? 0);
  const N = bins.length;
  let d = `M${pad},${size - pad}`;
  for (let i = 0; i < N; i++) {
    const x = pad + (i / (N - 1)) * inner;
    const h = (bins[i]! / max) * inner * 0.92;
    d += `L${x.toFixed(2)},${(size - pad - h).toFixed(2)}`;
  }
  return `${d}L${pad + inner},${size - pad}Z`;
}

/* -------------------------------------------------------------- parametric */

function ParametricEditor({ curves, setCurves }: { curves: Curves; setCurves: (p: Partial<Curves>, label?: string) => void }) {
  const p = curves.parametric;
  const splits = p.splits;
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const preview = useMemo(() => {
    const N = 96;
    const pts: CurvePoint[] = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      pts.push({ x, y: clamp01(x + sampleParametric(x, p) / 100) });
    }
    return pts;
  }, [p]);

  const setSplit = (i: number, v: number) => {
    const next: [number, number, number] = [...splits] as [number, number, number];
    next[i] = clamp01(v) * 100;
    if (i === 0) next[0] = Math.min(next[0], next[1] - 4);
    if (i === 1) {
      next[1] = Math.max(next[1], next[0] + 4);
      next[1] = Math.min(next[1], next[2] - 4);
    }
    if (i === 2) next[2] = Math.max(next[2], next[1] + 4);
    setCurves({ parametric: { ...p, splits: next } });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <CurveEditor
        points={preview}
        onChange={() => undefined}
        color="var(--color-accent)"
        interpolation="linear"
        channel="luma"
      />
      <div className="px-1">
        <div className="mb-1 flex items-center gap-1 text-[10px] tracking-wide text-t3 uppercase">
          <SwIcon name="split" size={12} /> Split points
        </div>
        <div
          ref={stripRef}
          className="relative h-6 rounded-[var(--radius-sm)] bg-s2 shadow-[var(--e-inset)]"
          onPointerMove={(e) => {
            if (dragSplit === null || !stripRef.current) return;
            const r = stripRef.current.getBoundingClientRect();
            setSplit(dragSplit, (e.clientX - r.left) / r.width);
          }}
          onPointerUp={() => {
            if (dragSplit !== null) setCurves({}, 'Parametric splits');
            setDragSplit(null);
          }}
        >
          {(['shadows', 'darks', 'lights', 'highlights'] as const).map((z, i) => (
            <span
              key={z}
              className="numeric absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] text-t3"
              style={{ left: `${i === 0 ? splits[0] / 2 : i === 1 ? (splits[0] + splits[1]) / 2 : i === 2 ? (splits[1] + splits[2]) / 2 : (splits[2] + 100) / 2}%` }}
            >
              {z.slice(0, 3)}
            </span>
          ))}
          {splits.map((s, i) => (
            <span
              key={i}
              role="slider"
              tabIndex={0}
              aria-label={`Split ${i + 1}`}
              aria-valuenow={Math.round(s)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="absolute top-1/2 h-5 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full bg-t2 shadow-[var(--e1)] transition-colors hover:bg-[var(--color-accent)]"
              style={{ left: `${s}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setDragSplit(i);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft') setSplit(i, (s - step) / 100);
                if (e.key === 'ArrowRight') setSplit(i, (s + step) / 100);
              }}
            />
          ))}
        </div>
      </div>
      {(['highlights', 'lights', 'darks', 'shadows'] as const).map((k) => (
        <Slider
          key={k}
          label={k[0].toUpperCase() + k.slice(1)}
          value={p[k]}
          min={-100}
          max={100}
          step={1}
          bipolar
          onChange={(v) => setCurves({ parametric: { ...p, [k]: v } })}
          onCommit={() => setCurves({}, `Parametric ${k}`)}
        />
      ))}
      <div className="px-1">
        <Button size="xs" variant="ghost" icon="restart" onClick={() => setCurves({ parametric: { highlights: 0, lights: 0, darks: 0, shadows: 0, splits: [25, 50, 75] } }, 'Reset parametric')}>
          Reset parametric
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- targeted adjustment */

function TargetedAdjustment({
  channel,
  points,
  setPoints,
}: {
  channel: ChannelId | null;
  points: CurvePoint[];
  setPoints: (p: CurvePoint[], label?: string) => void;
}) {
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const [armed, setArmed] = useState(false);
  const [img, setImg] = useState<ImageData | null>(null);
  const dragRef = useRef<{ index: number; startY: number; startY0: number } | null>(null);

  useEffect(() => {
    if (!armed || !photo || channel !== 'luma') return;
    let cancelled = false;
    void imageLoader.imageData(photo.src, 256).then((d) => !cancelled && setImg(d));
    return () => {
      cancelled = true;
    };
  }, [armed, photo?.src, photo, channel]);

  if (!photo || channel !== 'luma') return null;

  const sampleAt = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!img) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(clamp01((e.clientX - r.left) / r.width) * (img.width - 1));
    const y = Math.floor(clamp01((e.clientY - r.top) / r.height) * (img.height - 1));
    const i = (y * img.width + x) * 4;
    const lum = (0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!) / 255;
    return { lum, dy: (e.clientY - r.top) / r.height };
  };

  return (
    <Section title="Targeted adjustment" icon="target" dense defaultOpen={false}>
      <div className="px-1">
        <div className="mb-1 flex items-center gap-1">
          <Chip active={armed} icon="target" onClick={() => setArmed(!armed)}>
            Drag on the photo
          </Chip>
          <Badge tone="muted">{armed ? 'armed' : 'idle'}</Badge>
        </div>
        {armed && (
          <div
            className="relative cursor-crosshair overflow-hidden rounded-[var(--radius-md)] shadow-[var(--e-inset)]"
            onPointerDown={(e) => {
              const s = sampleAt(e);
              if (!s) return;
              const sorted = normalizePoints(points);
              let idx = sorted.findIndex((p) => Math.abs(p.x - s.lum) < 0.04);
              if (idx < 0) {
                if (sorted.length >= 16) return;
                idx = sorted.findIndex((p, i) => i === 0 || (p.x < s.lum && sorted[i + 1]?.x > s.lum));
                if (idx < 0) idx = sorted.length - 1;
                sorted.splice(idx + 1, 0, { x: s.lum, y: s.lum });
                idx = idx + 1;
              }
              dragRef.current = { index: idx, startY: e.clientY, startY0: sorted[idx]!.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const r = e.currentTarget.getBoundingClientRect();
              const dy = (d.startY - e.clientY) / r.height;
              const sorted = normalizePoints(points);
              const next = sorted.map((p, i) => (i === d.index ? { x: p.x, y: clamp01(d.startY0 + dy) } : p));
              setPoints(next);
            }}
            onPointerUp={(e) => {
              if (dragRef.current) {
                dragRef.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
                setPoints(normalizePoints(points), 'Targeted adjustment');
              }
            }}
          >
            <img src={photo.src} alt="" draggable={false} className="block w-full select-none opacity-90" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,oklch(0.1_0.01_250/0.55))]" />
            <span className="glass pointer-events-none absolute bottom-1 left-1 rounded-[6px] px-1.5 py-0.5 text-[10px] text-t2">
              Drag up to brighten, down to darken that tone
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- point table */

function PointTable({ points, onChange, periodic }: { points: CurvePoint[]; onChange: (p: CurvePoint[], l?: string) => void; periodic?: boolean }) {
  const sorted = periodic ? points : normalizePoints(points);
  return (
    <Section title={`Points (${sorted.length})`} icon="curvePoints" dense defaultOpen={false}>
      <div className="px-1">
        <div className="numeric mb-1 grid grid-cols-[1fr_1fr_auto] gap-1 text-[10px] tracking-wide text-t3 uppercase">
          <span>Input</span>
          <span>Output</span>
          <span />
        </div>
        {sorted.map((p, i) => (
          <div key={i} className="numeric mb-1 grid grid-cols-[1fr_1fr_auto] items-center gap-1">
            <input
              type="number"
              value={Number((periodic ? p.x * 360 : p.x * 255).toFixed(periodic ? 1 : 0))}
              step={periodic ? 1 : 1}
              disabled={!periodic && (i === 0 || i === sorted.length - 1)}
              onChange={(e) => {
                const v = Number(e.target.value) / (periodic ? 360 : 255);
                const next = sorted.map((s, j) => (j === i ? { ...s, x: clamp01(v) } : s));
                onChange(periodic ? next : normalizePoints(next));
              }}
              onBlur={() => onChange(sorted, 'Edit curve point')}
              className="h-6 w-full rounded-[6px] bg-s2 px-1.5 text-2xs text-t1 focus:bg-s3 focus:outline-none disabled:opacity-40"
              aria-label={`Point ${i + 1} input`}
            />
            <input
              type="number"
              value={Number((periodic ? p.y * 100 : p.y * 255).toFixed(periodic ? 1 : 0))}
              step={periodic ? 1 : 1}
              onChange={(e) => {
                const v = Number(e.target.value) / (periodic ? 100 : 255);
                const next = sorted.map((s, j) => (j === i ? { ...s, y: periodic ? Math.max(-0.5, Math.min(0.5, v)) : clamp01(v) } : s));
                onChange(periodic ? next : normalizePoints(next));
              }}
              onBlur={() => onChange(sorted, 'Edit curve point')}
              className="h-6 w-full rounded-[6px] bg-s2 px-1.5 text-2xs text-t1 focus:bg-s3 focus:outline-none"
              aria-label={`Point ${i + 1} output`}
            />
            <IconButton
              name="trash"
              size={12}
              box="sm"
              label={`Delete point ${i + 1}`}
              disabled={!periodic && (i === 0 || i === sorted.length - 1)}
              onClick={() => onChange(sorted.filter((_, j) => j !== i), 'Delete curve point')}
            />
          </div>
        ))}
        {sorted.length < 16 && (
          <Button size="xs" variant="ghost" icon="plus" onClick={() => onChange(periodic ? [...sorted, { x: 0.5, y: 0 }] : normalizePoints([...sorted, { x: 0.5, y: 0.5 }]), 'Add curve point')}>
            Add midpoint
          </Button>
        )}
      </div>
    </Section>
  );
}

export type { DevelopParams };
