/**
 * ActivityCentre — the running-work drawer (§10, §6.7).
 *
 * Every long job (import, preview build, index, matte, export, backup) is a
 * catalog Task; this panel is the single place they are visible, cancellable
 * and explained, so nothing ever looks like it hung.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Badge, Button, IconButton } from '@/ui/Button.tsx';
import { useUi } from '@/state/ui.ts';
import { useCatalog } from '@/state/catalog.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { analysisClient } from '@/lib/analysisClient.ts';
import { toast } from '@/state/toasts.ts';
import { formatBytes, formatDuration, relativeTime } from '@swell/shared';
import type { Task } from '@swell/schema';

const KIND_ICON: Record<Task['kind'], IconName> = {
  import: 'import',
  preview: 'photos',
  index: 'smart',
  export: 'export',
  matte: 'mask',
  batch: 'layers',
  backup: 'database',
  optimize: 'cpu',
};

export function ActivityCenter() {
  const open = useUi((s) => s.activityOpen);
  const setOpen = useUi((s) => s.setActivity);
  const tasks = useCatalog((s) => s.tasks);
  const removeTask = useCatalog((s) => s.removeTask);
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [pools, setPools] = useState(() => imageLoader.stats());

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setPools(imageLoader.stats()), 1500);
    return () => window.clearInterval(t);
  }, [open]);

  const list = tasks.filter((t) =>
    filter === 'all' ? true : filter === 'active' ? t.state === 'running' || t.state === 'queued' : t.state !== 'running' && t.state !== 'queued',
  );
  const active = tasks.filter((t) => t.state === 'running' || t.state === 'queued');

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[9050]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-label="Activity centre"
            className="glass-strong fixed top-12 right-2 bottom-8 z-[9060] flex w-[min(400px,92vw)] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--e3)]"
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <header className="flex h-11 shrink-0 items-center gap-2 px-3">
              <SwIcon name="activity" size={16} className="text-t3" />
              <h2 className="text-sm font-medium text-t1">Activity</h2>
              {active.length > 0 && <Badge tone="accent">{active.length} running</Badge>}
              <div className="ml-auto flex items-center gap-0.5">
                {(['all', 'active', 'done'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cx(
                      'h-6 rounded-[var(--radius-pill)] px-2 text-2xs capitalize transition-colors',
                      filter === f ? 'bg-s4 text-t1' : 'text-t3 hover:bg-s2 hover:text-t2',
                    )}
                  >
                    {f}
                  </button>
                ))}
                <IconButton name="close" size={14} box="sm" label="Close activity centre" onClick={() => setOpen(false)} />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 no-scrollbar">
              {!list.length && (
                <div className="grid place-items-center py-12 text-t3">
                  <SwIcon name="check" size={24} />
                  <p className="mt-2 text-xs">Nothing running. Everything is idle and quiet.</p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {list.map((t) => {
                  const pct = t.total ? Math.min(100, Math.round((t.done / t.total) * 100)) : t.state === 'done' ? 100 : 0;
                  return (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                      className="mb-1.5 overflow-hidden rounded-[var(--radius-lg)] bg-s2 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <SwIcon
                          name={KIND_ICON[t.kind]}
                          size={15}
                          className={cx('shrink-0', t.state === 'failed' ? 'text-[var(--color-danger)]' : t.state === 'done' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]')}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-t1">{t.label}</span>
                        <span className="numeric shrink-0 text-2xs text-t3">
                          {t.state === 'done' || t.state === 'failed'
                            ? relativeTime(new Date(t.finishedAt ?? t.startedAt).toISOString())
                            : `${pct}%`}
                        </span>
                        {(t.state === 'running' || t.state === 'queued') && (
                          <IconButton name="close" size={12} box="sm" label="Cancel task" onClick={() => { removeTask(t.id); toast.info('Task cancelled', t.label); }} />
                        )}
                        {(t.state === 'done' || t.state === 'failed') && (
                          <IconButton name="trash" size={12} box="sm" label="Dismiss" onClick={() => removeTask(t.id)} />
                        )}
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-s3">
                        <motion.div
                          className={cx('h-full rounded-full', t.state === 'failed' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-accent)]')}
                          animate={{ width: `${pct}%` }}
                          transition={{ type: 'spring', stiffness: 180, damping: 22 }}
                        />
                      </div>
                      <div className="numeric mt-1 flex items-center gap-2 text-[10px] text-t3">
                        <span className="capitalize">{t.state}</span>
                        {t.total > 0 && <span>{t.done}/{t.total}</span>}
                        {t.startedAt > 0 && t.finishedAt && <span>{formatDuration(t.finishedAt - t.startedAt)}</span>}
                        {t.memoryHint && <span className="ml-auto">{t.memoryHint}</span>}
                        {t.error && <span className="ml-auto text-[var(--color-danger)]">{t.error}</span>}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            <footer className="shrink-0 px-2 pb-2">
              <div className="rounded-[var(--radius-lg)] bg-s2 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-2xs text-t2">
                  <SwIcon name="database" size={13} className="text-t3" />
                  Caches
                  <span className="numeric ml-auto text-t3">{formatBytes(pools.reduce((a, p) => a + p.bytes, 0))} held</span>
                </div>
                {pools.map((p) => (
                  <div key={p.id} className="mb-1 last:mb-0">
                    <div className="flex items-baseline justify-between text-[10px]">
                      <span className="text-t3 capitalize">{p.id}</span>
                      <span className="numeric text-t2">
                        {formatBytes(p.bytes)} / {formatBytes(p.budget)} · {p.items} items · {(p.hitRate * 100).toFixed(0)}% hits
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-s3">
                      <div className="h-full rounded-full bg-t2/50" style={{ width: `${Math.min(100, (p.bytes / Math.max(1, p.budget)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                <div className="mt-1.5 flex gap-1">
                  <Button size="xs" variant="subtle" icon="refresh" onClick={() => { imageLoader.clear(); setPools(imageLoader.stats()); toast.ok('Caches cleared'); }}>
                    Clear
                  </Button>
                  <Button size="xs" variant="ghost" icon="stop" onClick={() => { analysisClient.stop(); toast.info('Indexing paused', 'Resume from Smart Detect & Search.'); }}>
                    Pause indexing
                  </Button>
                </div>
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default ActivityCenter;
