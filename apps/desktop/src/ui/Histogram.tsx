import { useEffect, useRef } from 'react';
import type { HistogramPayload } from '@swell/schema';
import { cx } from './cx.ts';

/**
 * Histogram — additive RGB + luma, log or linear, tonal regions for the curves
 * page. Painted on a 2D canvas so it costs nothing on the GPU budget.
 */

export interface HistogramProps {
  data: HistogramPayload | null;
  className?: string;
  log?: boolean;
  /** show the luma channel as a filled overlay */
  luma?: boolean;
  height?: number;
  /** 0..1 markers drawn as soft accent bands (curve region guides) */
  regions?: { from: number; to: number; label?: string }[];
  /** clipping indicators */
  clipping?: boolean;
  compact?: boolean;
}

const CHANNELS: [keyof HistogramPayload, string][] = [
  ['r', 'rgba(255,86,86,0.62)'],
  ['g', 'rgba(120,235,150,0.58)'],
  ['b', 'rgba(110,175,255,0.62)'],
];

export function Histogram({
  data,
  className,
  log = true,
  luma = true,
  height = 96,
  regions,
  clipping = true,
  compact,
}: HistogramProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 260;
    const h = height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!data) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, h - 1, w, 1);
      return;
    }

    const bins = data.luma.length;
    let peak = 1;
    for (const ch of ['r', 'g', 'b'] as const) {
      const arr = data[ch] as Float32Array;
      for (let i = 0; i < bins; i++) peak = Math.max(peak, arr[i] ?? 0);
    }
    const lumaArr = data.luma as Float32Array;
    for (let i = 0; i < bins; i++) peak = Math.max(peak, lumaArr[i] ?? 0);

    const scale = (v: number) => {
      const n = v / peak;
      return log ? Math.log1p(n * 63) / Math.log(64) : n;
    };

    // tonal region guides — soft accent washes, never lines
    if (regions?.length) {
      for (const r of regions) {
        const x0 = r.from * w;
        const x1 = r.to * w;
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, 'rgba(120,220,255,0)');
        g.addColorStop(0.5, 'rgba(120,220,255,0.09)');
        g.addColorStop(1, 'rgba(120,220,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x0, 0, x1 - x0, h);
      }
    }

    // thirds — extremely subtle tonal bands
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    ctx.fillRect(w / 3, 0, w / 3, h);

    ctx.globalCompositeOperation = 'lighter';
    for (const [key, color] of CHANNELS) {
      const arr = data[key] as Float32Array;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < bins; i++) {
        const x = (i / (bins - 1)) * w;
        const y = h - scale(arr[i] ?? 0) * (h - 3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (luma) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < bins; i++) {
        const x = (i / (bins - 1)) * w;
        const y = h - scale(lumaArr[i] ?? 0) * (h - 3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // clipping warnings: a soft glow at the edge that is actually clipping
    if (clipping) {
      if (data.clippedHighlights > 0.0004) {
        const a = Math.min(0.55, data.clippedHighlights * 22);
        const g = ctx.createLinearGradient(w - 26, 0, w, 0);
        g.addColorStop(0, 'rgba(255,90,90,0)');
        g.addColorStop(1, `rgba(255,90,90,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(w - 26, 0, 26, h);
      }
      if (data.clippedShadows > 0.0004) {
        const a = Math.min(0.5, data.clippedShadows * 18);
        const g = ctx.createLinearGradient(0, 0, 26, 0);
        g.addColorStop(0, `rgba(110,190,255,${a})`);
        g.addColorStop(1, 'rgba(110,190,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 26, h);
      }
    }
  }, [data, log, luma, height, regions, clipping]);

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[var(--radius-md)] bg-s2 shadow-[var(--e-inset)]',
        compact ? 'p-1' : 'p-1.5',
        className,
      )}
      style={{ height: height + (compact ? 8 : 12) }}
    >
      <canvas ref={ref} className="h-full w-full" style={{ height }} aria-hidden />
      {!data && (
        <div className="absolute inset-0 grid place-items-center text-2xs text-t3">No preview data yet</div>
      )}
      {data && !compact && (
        <div className="pointer-events-none absolute inset-x-2 bottom-0.5 flex justify-between text-[9px] text-t3/70">
          <span>Shadows</span>
          <span>Midtones</span>
          <span>Highlights</span>
        </div>
      )}
    </div>
  );
}

/** Small numeric readout strip under the histogram (clipping %, mean luma). */
export function HistogramStats({ data }: { data: HistogramPayload | null }) {
  if (!data) return null;
  return (
    <div className="numeric flex items-center justify-between gap-2 px-1 text-2xs text-t3">
      <span className={cx(data.clippedShadows > 0.002 && 'text-[var(--color-info)]')}>
        −{(data.clippedShadows * 100).toFixed(2)}%
      </span>
      <span>L̄ {(data.meanLuma * 100).toFixed(1)}</span>
      <span className={cx(data.clippedHighlights > 0.002 && 'text-[var(--color-danger)]')}>
        +{(data.clippedHighlights * 100).toFixed(2)}%
      </span>
    </div>
  );
}

export default Histogram;
