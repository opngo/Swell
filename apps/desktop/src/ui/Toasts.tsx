import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useToasts, type Toast } from '@/state/toasts.ts';
import { cx } from './cx.ts';
import { SwIcon, type IconName } from './icons.tsx';
import { spring } from './motion.ts';
import { Progress } from './Button.tsx';
import { useReducedMotion } from './useReducedMotion.ts';

const TONE: Record<Toast['tone'], { icon: IconName; color: string; glow: string }> = {
  info: { icon: 'info', color: 'text-[var(--color-info)]', glow: 'oklch(0.76 0.11 230 / 0.16)' },
  ok: { icon: 'checkCircle', color: 'text-[var(--color-ok)]', glow: 'oklch(0.78 0.14 150 / 0.16)' },
  warn: { icon: 'warning', color: 'text-[var(--color-warn)]', glow: 'oklch(0.82 0.14 80 / 0.18)' },
  danger: { icon: 'warning', color: 'text-[var(--color-danger)]', glow: 'oklch(0.68 0.19 25 / 0.2)' },
};

function ToastCard({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const reduce = useReducedMotion();
  const tone = TONE[t.tone];

  useEffect(() => {
    if (!t.duration) return;
    const id = window.setTimeout(() => dismiss(t.id), t.duration);
    return () => window.clearTimeout(id);
  }, [t.id, t.duration, dismiss]);

  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.96, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.97, filter: 'blur(4px)' }}
      transition={spring.snappy}
      role="status"
      aria-live="polite"
      className="glass-strong pointer-events-auto relative w-80 overflow-hidden rounded-[var(--radius-md)] p-3 shadow-[var(--e3)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 90% at 0% 0%, ${tone.glow}, transparent 62%)` }}
      />
      <div className="relative flex items-start gap-2.5">
        <SwIcon name={tone.icon} size={18} className={cx('mt-0.5 shrink-0', tone.color)} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-t1">{t.title}</div>
          {t.description && <div className="mt-0.5 text-2xs leading-relaxed text-t3">{t.description}</div>}
          {t.progress !== undefined && <Progress value={t.progress} className="mt-2" />}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
              className="mt-2 rounded-[6px] bg-s3 px-2 py-1 text-2xs text-t1 transition-colors hover:bg-s4"
            >
              {t.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => dismiss(t.id)}
          aria-label="Dismiss"
          className="grid size-6 shrink-0 place-items-center rounded-[6px] text-t3 transition-colors hover:bg-s3 hover:text-t1"
        >
          <SwIcon name="close" size={12} />
        </button>
      </div>
      {t.duration > 0 && (
        <motion.span
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 bg-[var(--color-accent)]/70"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: t.duration / 1000, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[9600] flex flex-col-reverse items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </AnimatePresence>
      {reduce && null}
    </div>
  );
}

export default ToastHost;
