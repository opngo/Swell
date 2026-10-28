import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cx } from './cx.ts';
import { Keycap } from './Button.tsx';

/* -------------------------------------------------------------------------- */
/*  Slider — Appendix A of the spec                                            */
/*                                                                             */
/*  · drag anywhere on the ROW (not just the track)                            */
/*  · value changes every frame; `onCommit` fires once per gesture → the       */
/*    history stack gets exactly one entry per interaction                     */
/*  · double-click resets to `defaultValue`                                    */
/*  · click the value to type it; Enter commits, Esc reverts                   */
/*  · Shift = ×0.1 fine, Alt = ×10 coarse (drag and keys)                      */
/*  · arrows ±step · PageUp/Down ±10 steps · Home/End = min/max                */
/*  · hover reveals the value in accent + a tooltip; the thumb scales on drag   */
/*  · role="slider" with aria-valuetext                                        */
/* -------------------------------------------------------------------------- */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  /** e.g. '+0.35 EV', '62%', '24 px' */
  format?: (v: number) => string;
  /** text for screen readers; defaults to `format` */
  valueText?: (v: number) => string;
  unit?: string;
  onChange: (v: number) => void;
  onCommit?: (v: number, ctx: { label: string; from: number; to: number }) => void;
  /** Called continuously while dragging, for the tooltip. */
  onScrub?: (v: number) => void;
  bipolar?: boolean;
  disabled?: boolean;
  /** Custom track painting (hue ramps, gradient fills). */
  trackStyle?: CSSProperties;
  /** Hide the numeric readout (used by colour wheels etc). */
  hideValue?: boolean;
  className?: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'ok';
  compact?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function roundToStep(v: number, step: number) {
  if (step <= 0) return v;
  const r = Math.round(v / step) * step;
  // avoid float dust (0.30000000000000004)
  const decimals = Math.max(0, -Math.floor(Math.log10(step))) + 1;
  return Number(r.toFixed(Math.min(decimals, 6)));
}

const defaultFormat = (v: number, step: number, unit?: string) => {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const s = v.toFixed(decimals);
  const signed = v > 0 && decimals > 0 ? `+${s}` : s;
  return unit ? `${signed} ${unit}` : signed;
};

/** How many pixels of drag cover the full range. */
const DRAG_SPAN = 220;

export const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
  {
    label,
    value,
    min,
    max,
    step = 0.01,
    defaultValue,
    format,
    valueText,
    unit,
    onChange,
    onCommit,
    onScrub,
    bipolar,
    disabled,
    trackStyle,
    hideValue,
    className,
    hint,
    tone = 'default',
    compact,
  },
  ref,
) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const dragRef = useRef<{ startX: number; startY: number; startValue: number; from: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const range = max - min || 1;

  const fmt = useCallback(
    (v: number) => (format ? format(v) : defaultFormat(v, step, unit)),
    [format, step, unit],
  );

  const pct = ((clamp(value, min, max) - min) / range) * 100;
  const zeroPct = bipolar ? ((clamp(0, min, max) - min) / range) * 100 : 0;
  const fillLeft = bipolar ? Math.min(pct, zeroPct) : 0;
  const fillWidth = bipolar ? Math.abs(pct - zeroPct) : pct;

  const set = useCallback(
    (v: number) => {
      const snapped = roundToStep(clamp(v, min, max), step);
      // magnetic detent on the default value — makes "back to 0" effortless
      const magnet = defaultValue !== undefined ? defaultValue : bipolar ? 0 : undefined;
      const final = magnet !== undefined && Math.abs(snapped - magnet) < step * 0.75 ? magnet : snapped;
      if (final !== value) onChange(final);
      return final;
    },
    [min, max, step, value, onChange, bipolar, defaultValue],
  );

  /* --- pointer scrubbing ------------------------------------------------ */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || typing || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startValue: value, from: value };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const fine = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    const dx = e.clientX - d.startX;
    const next = set(d.startValue + (dx / DRAG_SPAN) * range * fine);
    onScrub?.(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    if (d.from !== value) onCommit?.(value, { label, from: d.from, to: value });
  };

  const onDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    const from = value;
    onChange(defaultValue);
    onCommit?.(defaultValue, { label, from, to: defaultValue });
  };

  /* --- keyboard --------------------------------------------------------- */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled || typing) return;
    const fine = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    const big = step * 10 * fine;
    const small = step * fine;
    const from = value;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + small;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - small;
        break;
      case 'PageUp':
        next = value + big;
        break;
      case 'PageDown':
        next = value - big;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      case 'Enter':
      case ' ':
        setTyping(true);
        setDraft(String(value));
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    const v = set(next);
    onCommit?.(v, { label, from, to: v });
  };

  /* --- typing ----------------------------------------------------------- */
  useEffect(() => {
    if (typing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [typing]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft.replace(',', '.'));
    const from = value;
    if (!Number.isNaN(parsed)) {
      const v = set(parsed);
      onCommit?.(v, { label, from, to: v });
    }
    setTyping(false);
  };

  const accent =
    tone === 'danger' ? 'var(--color-danger)' : tone === 'ok' ? 'var(--color-ok)' : 'var(--color-accent)';

  return (
    <div
      ref={ref}
      className={cx(
        'group/slider relative select-none rounded-[var(--radius-sm)] px-1',
        compact ? 'py-0.5' : 'py-1',
        disabled ? 'opacity-40' : 'cursor-ew-resize',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* hover halo behind the whole row — tonal, never a stroke */}
      <span
        aria-hidden
        className={cx(
          'pointer-events-none absolute inset-0 rounded-[inherit] bg-s2 transition-opacity duration-[120ms]',
          hovered || dragging ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div className="relative flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className={cx(
            'truncate text-xs transition-colors duration-[120ms]',
            dragging ? 'text-t1' : hovered ? 'text-t1' : 'text-t2',
          )}
        >
          {label}
        </label>

        {!hideValue &&
          (typing ? (
            <input
              ref={inputRef}
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') setTyping(false);
                e.stopPropagation();
              }}
              className="numeric w-16 rounded-[4px] bg-s3 px-1 text-right text-xs text-t1 shadow-[var(--e-inset)]"
            />
          ) : (
            <button
              type="button"
              id={id}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={label}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-valuetext={valueText ? valueText(value) : fmt(value)}
              aria-orientation="horizontal"
              aria-disabled={disabled || undefined}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (disabled) return;
                setTyping(true);
                setDraft(String(value));
              }}
              className={cx(
                'numeric shrink-0 rounded-[4px] px-1 text-xs tabular-nums transition-colors duration-[120ms]',
                dragging ? 'text-t1' : hovered ? 'text-[var(--color-accent)]' : 'text-t3',
                'hover:bg-s3',
              )}
              style={dragging ? { color: accent } : undefined}
            >
              {fmt(value)}
            </button>
          ))}
      </div>

      {/* track */}
      <div className={cx('relative mt-1', compact ? 'h-3' : 'h-4')}>
        <div
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-[var(--radius-pill)] bg-s3"
          style={trackStyle}
        >
          {!trackStyle && (
            <span
              className="absolute inset-y-0 rounded-[var(--radius-pill)] transition-[opacity] duration-[120ms]"
              style={{
                left: `${fillLeft}%`,
                width: `${fillWidth}%`,
                background: accent,
                opacity: dragging ? 0.95 : hovered ? 0.8 : 0.62,
              }}
            />
          )}
          {trackStyle && (
            <span
              className="absolute inset-y-0 rounded-[var(--radius-pill)] bg-[oklch(1_0_0/0.28)]"
              style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
            />
          )}
        </div>

        {/* thumb */}
        <span
          aria-hidden
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[var(--e1)] transition-transform duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            left: `${pct}%`,
            background: dragging || hovered ? accent : 'var(--color-t1)',
            transform: `translate(-50%,-50%) scale(${dragging ? 1.35 : hovered ? 1.12 : 1})`,
            opacity: dragging || hovered ? 1 : 0.72,
          }}
        />
      </div>

      {/* drag tooltip */}
      {(dragging || (hovered && hint)) && (
        <div
          role="tooltip"
          className="glass-strong pointer-events-none absolute -top-8 left-1/2 z-30 -translate-x-1/2 rounded-[var(--radius-sm)] px-2 py-1 text-2xs whitespace-nowrap text-t1 shadow-[var(--e2)]"
        >
          <span className="numeric">{fmt(value)}</span>
          {hint && <span className="ml-2 text-t3">{hint}</span>}
          {dragging && (
            <span className="ml-2 inline-flex items-center gap-1 text-t3">
              <Keycap className="h-4">⇧</Keycap> fine
              <Keycap className="h-4">⌥</Keycap> coarse
              <Keycap className="h-4">2×</Keycap> reset
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default Slider;
