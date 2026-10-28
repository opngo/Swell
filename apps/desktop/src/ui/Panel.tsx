import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from './cx.ts';
import { SwIcon, type IconName } from './icons.tsx';
import { spring } from './motion.ts';
import { useReducedMotion } from './useReducedMotion.ts';

/**
 * Panels & sections. Elevation is expressed with surface steps and shadows —
 * never with strokes. Sections collapse with a spring and a subtle blur-in.
 */

export function Panel({
  className,
  children,
  as: As = 'div',
  tone = 1,
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'aside';
  tone?: 0 | 1 | 2;
}) {
  const bg = tone === 0 ? 'bg-s0' : tone === 1 ? 'bg-s1' : 'bg-s2';
  return <As className={cx('flex flex-col overflow-hidden rounded-[var(--radius-lg)]', bg, className)}>{children}</As>;
}

export function PanelHeader({
  title,
  icon,
  right,
  className,
}: {
  title: ReactNode;
  icon?: IconName;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        'sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 px-3',
        'bg-[oklch(0.19_0.009_250/0.86)] backdrop-blur-xl',
        className,
      )}
    >
      {icon && <SwIcon name={icon} size={18} className="text-t3" />}
      <h2 className="text-sm font-medium tracking-[-0.01em] text-t1">{title}</h2>
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </header>
  );
}

export interface SectionProps {
  title: string;
  icon?: IconName;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  badge?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Compact sections are used inside dense inspector columns. */
  dense?: boolean;
}

export function Section({
  title,
  icon,
  open: controlled,
  defaultOpen = true,
  onToggle,
  badge,
  right,
  children,
  className,
  dense,
}: SectionProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const reduce = useReducedMotion();
  const toggle = () => {
    const next = !open;
    setInner(next);
    onToggle?.(next);
  };

  return (
    <section className={cx('relative', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cx(
          'group flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left',
          'transition-colors duration-[120ms] hover:bg-s2',
          dense ? 'h-7' : 'h-9',
        )}
      >
        <SwIcon
          name="chevronRight"
          size={14}
          className={cx(
            'shrink-0 text-t3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            open && 'rotate-90',
          )}
        />
        {icon && <SwIcon name={icon} size={16} className="shrink-0 text-t3" />}
        <span className={cx('truncate font-medium text-t1', dense ? 'text-2xs' : 'text-xs')}>{title}</span>
        {badge}
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {right}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduce ? false : { height: 0, opacity: 0, filter: 'blur(4px)' }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { height: 0, opacity: 0, filter: 'blur(4px)' }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <div className={cx(dense ? 'px-1 pb-1.5 pt-0.5' : 'px-1.5 pb-3 pt-1')}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Vertical rhythm helper — spacing is a separator in this system. */
export function Gap({ size = 3 }: { size?: 1 | 2 | 3 | 4 | 6 }) {
  const map = { 1: 'h-1', 2: 'h-2', 3: 'h-3', 4: 'h-4', 6: 'h-6' } as const;
  return <div aria-hidden className={map[size]} />;
}

/** A row of tools: tonal container, no strokes, evenly spaced. */
export function Toolbar({
  children,
  className,
  align = 'start',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'between' | 'end';
}) {
  const a = { start: 'justify-start', center: 'justify-center', between: 'justify-between', end: 'justify-end' }[align];
  return <div className={cx('flex items-center gap-1', a, className)}>{children}</div>;
}

/** Labelled field row used in inspectors (label left, control right). */
export function FieldRow({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex min-h-8 items-center gap-3 px-2 py-1', className)}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-t2">{label}</div>
        {hint && <div className="truncate text-2xs text-t3">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** Section title inside a page body (bigger than a Panel header). */
export function GroupTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-3 px-1">
      <h3 className="text-display text-lg text-t1">{children}</h3>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

