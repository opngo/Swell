import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cx } from './cx.ts';
import { SwIcon, type IconName } from './icons.tsx';

/* -------------------------------------------------------------------------- */
/*  Button                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'accentSoft';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  // accent fill — the only saturated surface in the app
  primary:
    'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-[var(--e1)] hover:brightness-110 hover:shadow-[var(--e2)]',
  secondary: 'bg-s3 text-t1 hover:bg-s4',
  subtle: 'bg-s2 text-t2 hover:bg-s3 hover:text-t1',
  ghost: 'bg-transparent text-t2 hover:bg-s2 hover:text-t1',
  danger: 'bg-[oklch(0.68_0.19_25/0.16)] text-[var(--color-danger)] hover:bg-[oklch(0.68_0.19_25/0.26)]',
  accentSoft: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-s4',
};

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-2xs rounded-[var(--radius-xs)] gap-1',
  sm: 'h-7 px-2.5 text-xs rounded-[var(--radius-sm)] gap-1.5',
  md: 'h-8 px-3 text-sm rounded-[var(--radius-sm)] gap-2',
  lg: 'h-10 px-4 text-md rounded-[var(--radius-md)] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading,
    block,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex items-center justify-center select-none whitespace-nowrap',
        'transition-[background-color,color,box-shadow,transform,filter] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner className={cx('size-3.5', children ? '-ml-0.5' : '')} />
      ) : icon ? (
        <SwIcon name={icon} size={size === 'lg' ? 20 : 18} className="shrink-0 opacity-90" />
      ) : null}
      {children}
      {iconRight && <SwIcon name={iconRight} size={size === 'lg' ? 20 : 18} className="shrink-0 opacity-70" />}
    </button>
  );
});

/** Square icon-only button — the workhorse of toolbars. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: IconName;
  size?: number;
  variant?: ButtonVariant;
  box?: 'sm' | 'md' | 'lg';
  pressed?: boolean;
  label: string;
}

const BOX = {
  sm: 'size-6 rounded-[var(--radius-xs)]',
  md: 'size-8 rounded-[var(--radius-sm)]',
  lg: 'size-10 rounded-[var(--radius-md)]',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { name, size = 18, variant = 'ghost', box = 'md', pressed, label, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed ?? undefined}
      className={cx(
        'inline-flex items-center justify-center shrink-0 select-none',
        'transition-[background-color,color,box-shadow,transform] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
        'active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35',
        BOX[box],
        pressed
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <SwIcon name={name} size={size} />
    </button>
  );
});

/** Pill chip — flags, ratings, match explanations, keywords. */
export function Chip({
  icon,
  active,
  tone = 'neutral',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  active?: boolean;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
  children?: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: active ? 'bg-s4 text-t1' : 'bg-s2 text-t2 hover:bg-s3 hover:text-t1',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
    ok: 'bg-[oklch(0.78_0.14_150/0.16)] text-[var(--color-ok)]',
    warn: 'bg-[oklch(0.82_0.14_80/0.16)] text-[var(--color-warn)]',
    danger: 'bg-[oklch(0.68_0.19_25/0.16)] text-[var(--color-danger)]',
  };
  return (
    <button
      type="button"
      aria-pressed={active ?? undefined}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-2xs whitespace-nowrap',
        'transition-colors duration-[120ms] active:scale-[0.97]',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {icon && <SwIcon name={icon} size={14} />}
      {children}
    </button>
  );
}

/** Non-interactive status pill. */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-s3 text-t2',
    muted: 'bg-s2 text-t3',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
    ok: 'bg-[oklch(0.78_0.14_150/0.15)] text-[var(--color-ok)]',
    warn: 'bg-[oklch(0.82_0.14_80/0.15)] text-[var(--color-warn)]',
    danger: 'bg-[oklch(0.68_0.19_25/0.15)] text-[var(--color-danger)]',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-2xs tabular-nums',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Keyboard hint — tonal pill, never stroked. */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-s2 px-1.5',
        'font-mono text-2xs text-t3 shadow-[inset_0_-1px_0_oklch(0_0_0/0.25)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="Working"
      className={cx(
        'inline-block size-4 animate-spin rounded-full',
        'bg-[conic-gradient(from_0deg,transparent_0%,var(--color-accent)_85%,transparent_100%)]',
        // tonal hole, not a stroke
        '[mask:radial-gradient(farthest-side,transparent_calc(100%_-_2px),#000_0)]',
        className,
      )}
    />
  );
}

/** Determinate progress — a filled pill with an animated wave (§3.4). */
export function Progress({
  value,
  indeterminate,
  className,
  tone = 'accent',
}: {
  value?: number;
  indeterminate?: boolean;
  className?: string;
  tone?: 'accent' | 'ok' | 'warn';
}) {
  const bg =
    tone === 'ok' ? 'bg-[var(--color-ok)]' : tone === 'warn' ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)]';
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('relative h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-s3', className)}
    >
      <div
        className={cx('relative h-full rounded-[var(--radius-pill)] transition-[width] duration-200', bg)}
        style={{ width: indeterminate ? '38%' : `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }}
      >
        {(indeterminate || true) && <span className="progress-wave absolute inset-0 rounded-[inherit]" />}
      </div>
      {indeterminate && (
        <style>{`@keyframes swell-indet{0%{transform:translateX(-100%)}100%{transform:translateX(360%)}}`}</style>
      )}
    </div>
  );
}
