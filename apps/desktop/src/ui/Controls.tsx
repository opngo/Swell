import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { cx } from './cx.ts';
import { SwIcon, type IconName } from './icons.tsx';
import { MenuList, Popover, Tooltip, type MenuItem } from './Overlay.tsx';
import { spring } from './motion.ts';
import { useReducedMotion } from './useReducedMotion.ts';

/* ---------------------------------- Switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <label className={cx('flex cursor-pointer items-center gap-3', disabled && 'cursor-default opacity-40', className)}>
      {label && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-t2">{label}</span>
          {description && <span className="block truncate text-2xs text-t3">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-[var(--radius-pill)] transition-colors duration-[160ms]',
          checked ? 'bg-[var(--color-accent)]' : 'bg-s4',
        )}
      >
        <motion.span
          layout={!reduce}
          transition={spring.snappy}
          style={{ left: checked ? 18 : 3 }}
          className={cx(
            'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full shadow-[var(--e1)]',
            checked ? 'bg-[var(--color-on-accent)]' : 'bg-t3',
          )}
        />
      </button>
    </label>
  );
}

/* ---------------------------- SegmentedControl ----------------------------- */

export interface Segment<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  segments: readonly Segment<T>[];
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('relative inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-s2 p-0.5', className)}
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={s.disabled}
            title={s.title}
            onClick={() => onChange(s.value)}
            className={cx(
              'relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] transition-colors duration-[120ms]',
              size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs',
              active ? 'text-t1' : 'text-t3 hover:text-t2',
              s.disabled && 'opacity-35',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-seg`}
                transition={reduce ? { duration: 0 } : spring.snappy}
                className="absolute inset-0 rounded-[inherit] bg-s4 shadow-[var(--e1)]"
              />
            )}
            {s.icon && <SwIcon name={s.icon} size={size === 'sm' ? 14 : 16} className="relative z-10" />}
            {s.label && <span className="relative z-10">{s.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------- Tabs ---------------------------------- */

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: readonly Segment<T>[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <div role="tablist" className={cx('flex items-center gap-1 px-2', className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cx(
              'relative flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 transition-colors duration-[120ms]',
              size === 'sm' ? 'h-7 text-2xs' : 'h-8 text-xs',
              active ? 'bg-s3 text-t1' : 'text-t3 hover:bg-s2 hover:text-t2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-tab`}
                transition={reduce ? { duration: 0 } : spring.smooth}
                className="absolute inset-0 rounded-[inherit] bg-s3 shadow-[var(--e1)]"
              />
            )}
            {t.icon && <SwIcon name={t.icon} size={15} className="relative z-10" />}
            <span className="relative z-10">{t.label ?? t.value}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Select --------------------------------- */

export interface Option<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  hint?: string;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  ariaLabel,
  size = 'md',
  align = 'bottom-start',
  disabled,
}: {
  value: T | '' | undefined;
  onChange: (v: T) => void;
  options: readonly Option<T>[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  align?: 'bottom-start' | 'bottom-end';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = options.find((o) => o.value === value);
  const items: MenuItem[] = options.map((o) => ({
    id: String(o.value),
    label: o.label,
    icon: o.icon,
    disabled: o.disabled,
    checked: o.value === value,
    onSelect: () => onChange(o.value),
  }));

  return (
    <Popover
      placement={align}
      matchWidth
      trigger={({ ref, toggle, ariaExpanded }) => (
        <button
          ref={(el) => {
            ref(el);
            setAnchor(el);
          }}
          type="button"
          role="combobox"
          aria-expanded={ariaExpanded}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={toggle}
          className={cx(
            'flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-s2 px-2 text-left transition-colors duration-[120ms] hover:bg-s3 disabled:opacity-40',
            size === 'sm' ? 'h-7 text-2xs' : 'h-8 text-xs',
            className,
          )}
        >
          {current?.icon && <SwIcon name={current.icon} size={14} className="shrink-0 opacity-70" />}
          <span className={cx('min-w-0 flex-1 truncate', !current && 'text-t3')}>{current?.label ?? placeholder}</span>
          <SwIcon name="chevronDown" size={14} className="shrink-0 text-t3" />
        </button>
      )}
      content={(close) => (
        <div className="max-h-80 overflow-y-auto">
          <MenuList items={items} onClose={() => { close(); setOpen(false); }} />
        </div>
      )}
    />
  );
}

/* -------------------------------- TextField -------------------------------- */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  icon?: IconName;
  hint?: ReactNode;
  error?: string;
  suffix?: ReactNode;
  size?: 'sm' | 'md';
  onClear?: () => void;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, icon, hint, error, suffix, size = 'md', className, onClear, value, ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className="px-0.5 text-2xs font-medium tracking-wide text-t3 uppercase">
          {label}
        </label>
      )}
      <div
        className={cx(
          'relative flex items-center gap-2 rounded-[var(--radius-sm)] bg-s2 px-2 transition-colors duration-[120ms]',
          'focus-within:bg-s3',
          size === 'sm' ? 'h-7' : 'h-9',
          error && 'bg-[oklch(0.68_0.19_25/0.14)]',
        )}
      >
        {icon && <SwIcon name={icon} size={16} className="shrink-0 text-t3" />}
        <input
          ref={ref}
          id={id}
          value={value as string}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={cx(
            'min-w-0 flex-1 bg-transparent text-xs text-t1 placeholder:text-t3 focus:outline-none',
            size === 'sm' ? 'text-2xs' : 'text-xs',
          )}
          {...rest}
        />
        {onClear && value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear"
            className="grid size-5 shrink-0 place-items-center rounded-[5px] text-t3 transition-colors hover:bg-s4 hover:text-t1"
          >
            <SwIcon name="close" size={12} />
          </button>
        ) : (
          suffix
        )}
      </div>
      {error ? (
        <span id={`${id}-err`} className="px-0.5 text-2xs text-[var(--color-danger)]">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="px-0.5 text-2xs text-t3">
          {hint}
        </span>
      ) : null}
    </div>
  );
});

/** Compact numeric field with a drag-to-scrub label (used in dialogs). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      onChange(clamped);
    }
    setDraft(null);
  };
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <span className="min-w-0 flex-1 truncate text-xs text-t2">{label}</span>
      <div className="flex h-7 items-center rounded-[var(--radius-sm)] bg-s2 px-1.5 focus-within:bg-s3">
        <input
          type="text"
          inputMode="decimal"
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setDraft(null);
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              onChange(Math.min(max ?? Infinity, value + step * (e.shiftKey ? 10 : 1)));
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(Math.max(min ?? -Infinity, value - step * (e.shiftKey ? 10 : 1)));
            }
          }}
          aria-label={label}
          className="numeric w-14 bg-transparent text-right text-xs text-t1 focus:outline-none"
        />
        {unit && <span className="ml-1 text-2xs text-t3">{unit}</span>}
      </div>
    </div>
  );
}

/* -------------------------------- ColorField ------------------------------- */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

function rgbToHsv({ r, g, b }: RgbColor): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function ColorField({
  label,
  color,
  onChange,
  className,
}: {
  label: string;
  color: RgbColor;
  onChange: (c: RgbColor) => void;
  className?: string;
}) {
  const hsv = rgbToHsv(color);
  const [drag, setDrag] = useState<'sv' | 'h' | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hRef = useRef<HTMLDivElement>(null);

  const pickSV = (clientX: number, clientY: number) => {
    const r = svRef.current?.getBoundingClientRect();
    if (!r) return;
    const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    onChange(hsvToRgb(hsv.h, s, v));
  };
  const pickH = (clientX: number) => {
    const r = hRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(hsvToRgb(h, hsv.s, hsv.v));
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => (drag === 'sv' ? pickSV(e.clientX, e.clientY) : pickH(e.clientX));
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  const css = `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`;

  return (
    <Popover
      placement="bottom-start"
      trigger={({ ref, toggle }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-label={`${label}: ${css}`}
          className={cx('flex items-center gap-2 rounded-[var(--radius-sm)] bg-s2 p-1 pr-2 hover:bg-s3', className)}
        >
          <span className="size-5 rounded-[6px] shadow-[var(--e-inset)]" style={{ background: css }} />
          <span className="text-2xs text-t2">{label}</span>
        </button>
      )}
      content={() => (
        <div className="w-56 p-2">
          <div
            ref={svRef}
            onPointerDown={(e) => {
              setDrag('sv');
              pickSV(e.clientX, e.clientY);
            }}
            className="relative h-32 w-full cursor-crosshair rounded-[var(--radius-sm)]"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h * 360} 100% 50%))`,
            }}
          >
            <span
              className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[var(--e2)] mix-blend-difference"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <div
            ref={hRef}
            onPointerDown={(e) => {
              setDrag('h');
              pickH(e.clientX);
            }}
            className="relative mt-2 h-3 w-full cursor-ew-resize rounded-[var(--radius-pill)]"
            style={{
              background:
                'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          >
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[var(--e2)]"
              style={{ left: `${hsv.h * 100}%` }}
            />
          </div>
          <div className="numeric mt-2 flex items-center justify-between text-2xs text-t3">
            <span>{css}</span>
            <span>
              H {Math.round(hsv.h * 360)}° · S {Math.round(hsv.s * 100)} · V {Math.round(hsv.v * 100)}
            </span>
          </div>
        </div>
      )}
    />
  );
}

/* --------------------------------- Ratings --------------------------------- */

export function Rating({
  value,
  onChange,
  size = 14,
  className,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  className?: string;
}) {
  return (
    <div role={onChange ? 'radiogroup' : 'img'} aria-label={`Rating ${value} of 5`} className={cx('flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          role={onChange ? 'radio' : undefined}
          aria-checked={onChange ? value === n : undefined}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange?.(value === n ? 0 : n)}
          className={cx(
            'grid place-items-center rounded-full p-0.5 transition-transform duration-[120ms]',
            onChange && 'hover:scale-125 active:scale-95',
            n <= value ? 'text-[var(--color-warn)]' : 'text-s5',
          )}
        >
          <SwIcon name={n <= value ? 'starSolid' : 'star'} size={size} />
        </button>
      ))}
    </div>
  );
}

/** Pick / reject / none flag (cull workflow). */
export function PickState({
  value,
  onChange,
  size = 16,
}: {
  value: 'pick' | 'reject' | 'none';
  onChange?: (v: 'pick' | 'reject' | 'none') => void;
  size?: number;
}) {
  const map = {
    pick: { icon: 'flag' as IconName, tone: 'text-[var(--color-ok)]', label: 'Pick' },
    reject: { icon: 'close' as IconName, tone: 'text-[var(--color-danger)]', label: 'Reject' },
    none: { icon: 'dashFlag' as IconName, tone: 'text-t3', label: 'No flag' },
  }[value];
  const Cmp = (
    <SwIcon name={map.icon} size={size} className={cx(map.tone, 'transition-transform duration-[120ms]')} />
  );
  if (!onChange) return Cmp;
  return (
    <button type="button" aria-label={map.label} onClick={() => onChange('none')} className="grid place-items-center rounded-full p-0.5 hover:scale-110">
      {Cmp}
    </button>
  );
}

/* -------------------------------- EmptyState ------------------------------- */

export function EmptyState({
  icon = 'photos',
  title,
  description,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.smooth}
      className={cx('flex flex-col items-center justify-center gap-3 px-8 py-14 text-center', className)}
    >
      <span className="relative grid size-16 place-items-center rounded-[var(--radius-lg)] bg-s2 text-t3">
        <span className="absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_120%,var(--color-accent-soft),transparent_65%)]" />
        <SwIcon name={icon} size={26} className="relative" />
      </span>
      <div>
        <h3 className="text-display text-md text-t1">{title}</h3>
        {description && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-t3">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}

/* ---------------------------------- Stat ----------------------------------- */

export function Stat({
  label,
  value,
  unit,
  tone,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  tone?: 'ok' | 'warn' | 'danger' | 'accent';
  hint?: string;
  className?: string;
}) {
  const color =
    tone === 'ok'
      ? 'text-[var(--color-ok)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : tone === 'danger'
          ? 'text-[var(--color-danger)]'
          : tone === 'accent'
            ? 'text-[var(--color-accent)]'
            : 'text-t1';
  const body = (
    <div className={cx('rounded-[var(--radius-md)] bg-s2 px-3 py-2', className)}>
      <div className="text-2xs tracking-wide text-t3 uppercase">{label}</div>
      <div className={cx('numeric mt-0.5 text-md leading-none', color)}>
        {value}
        {unit && <span className="ml-1 text-2xs text-t3">{unit}</span>}
      </div>
    </div>
  );
  return hint ? (
    <Tooltip label={hint}>
      <span className="block">{body}</span>
    </Tooltip>
  ) : (
    body
  );
}

/** key → value metadata row. */
export function KeyValue({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-2xs text-t3">{k}</span>
      <span className={cx('min-w-0 truncate text-right text-xs text-t2', mono && 'numeric')}>{v}</span>
    </div>
  );
}

/** Search field with the ⌘K hint and instant clear. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  shortcut = '⌘K',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  shortcut?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClear={value ? () => onChange('') : undefined}
      placeholder={placeholder}
      icon="search"
      autoFocus={autoFocus}
      className={className}
      suffix={
        !value && shortcut ? (
          <span className="text-2xs text-t3">{shortcut}</span>
        ) : undefined
      }
    />
  );
}
