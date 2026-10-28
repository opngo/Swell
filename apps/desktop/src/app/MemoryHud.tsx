/**
 * Memory HUD — Ctrl/⌘+Alt+M (§6).
 *
 * A live, byte-accounted view of every cache Swell owns: decoded previews,
 * GPU textures, AI mattes and resident models. Each row shows the budget it is
 * held to and what evicting it would cost, because "the app is slow" is almost
 * always a memory question in disguise.
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, IconButton } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import { editorStore, engineStatsAtom, mattesAtom } from '@/state/atoms.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { getEngine } from '@/lib/engineSingleton.ts';
import { registry } from '@/lib/modelRegistry.ts';
import { toast } from '@/state/toasts.ts';
import { formatBytes } from '@swell/shared';
import { useAtomValue } from 'jotai';

export function MemoryHud() {
  const open = useUi((s) => s.memoryHudOpen);
  const setOpen = useUi((s) => s.setMemoryHud);
  const perf = useSettings((s) => s.settings.performance);
  const ai = useSettings((s) => s.settings.ai);
  const stats = useAtomValue(engineStatsAtom);
  const mattes = useAtomValue(mattesAtom);
  const [pools, setPools] = useState(() => imageLoader.stats());
  const [heap, setHeap] = useState<number | null>(null);
  const [models, setModels] = useState(() => registry.list());

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => {
      setPools(imageLoader.stats());
      setModels(registry.list());
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      setHeap(mem?.usedJSHeapSize ?? null);
    }, 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const matteBytes = useMemo(
    () => Object.values(mattes).reduce((a, m) => a + (m.alpha?.byteLength ?? m.width * m.height), 0),
    [mattes],
  );
  const residentModels = models.filter((m) => m.status.resident);
  const downloaded = models.filter((m) => m.status.state === 'ready');

  const rows = [
    {
      id: 'decoded',
      label: 'Decoded previews (RAM)',
      bytes: pools.reduce((a, p) => a + p.bytes, 0),
      budget: perf.decodedCacheMB * 1024 * 1024,
      hint: `${pools.reduce((a, p) => a + p.items, 0)} bitmaps · LRU by priority`,
      release: () => {
        imageLoader.clear();
        setPools(imageLoader.stats());
      },
    },
    {
      id: 'gpu',
      label: 'GPU textures',
      bytes: stats?.textureBytes ?? 0,
      budget: perf.vramBudgetMB * 1024 * 1024,
      hint: `${stats?.textures ?? 0} textures · ${stats?.framebuffers ?? 0} FBOs · pooled`,
      release: () => {
        const freed = getEngine()?.trim() ?? 0;
        toast.ok('GPU cache trimmed', formatBytes(freed) + ' released');
      },
    },
    {
      id: 'mattes',
      label: 'AI mattes',
      bytes: matteBytes,
      budget: 256 * 1024 * 1024,
      hint: `${Object.keys(mattes).length} mattes · vector params + RLE rasters`,
      release: () => editorStore.set(mattesAtom, {}),
    },
    {
      id: 'models',
      label: 'Resident models',
      bytes: residentModels.reduce((a, m) => a + m.residentMB * 1024 * 1024, 0),
      budget: perf.ramBudgetMB * 1024 * 1024,
      hint: `${residentModels.length}/${ai.residentModels} slots · unload after ${ai.unloadAfterIdleSec}s idle`,
      release: () => {
        void registry.unloadIdle(Infinity).then((ids) => {
          setModels(registry.list());
          toast.ok('Models unloaded', ids.length ? `${ids.length} session(s) released` : 'Nothing was resident');
        });
      },
    },
  ];

  const totalBudget = (perf.ramBudgetMB + perf.vramBudgetMB) * 1024 * 1024;
  const totalUsed = rows.reduce((a, r) => a + r.bytes, 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="Memory HUD"
          className="glass-strong fixed right-3 bottom-9 z-[9080] w-[min(420px,94vw)] overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--e3)]"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <header className="flex h-10 items-center gap-2 px-3">
            <SwIcon name="cpu" size={15} className="text-[var(--color-accent)]" />
            <h2 className="text-sm font-medium text-t1">Memory</h2>
            <Badge tone={totalUsed / totalBudget > 0.85 ? 'warn' : 'ok'}>
              {formatBytes(totalUsed)} of {formatBytes(totalBudget)}
            </Badge>
            <span className="ml-auto flex items-center gap-0.5">
              <IconButton name="refresh" size={13} box="sm" label="Release everything reclaimable" onClick={() => rows.forEach((r) => r.release())} />
              <IconButton name="close" size={13} box="sm" label="Close Memory HUD" onClick={() => setOpen(false)} />
            </span>
          </header>

          <div className="max-h-[60vh] overflow-y-auto px-2 pb-2 no-scrollbar">
            {rows.map((r) => {
              const pct = Math.min(100, (r.bytes / Math.max(1, r.budget)) * 100);
              return (
                <div key={r.id} className="mb-1.5 rounded-[var(--radius-lg)] bg-s2 p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-t1">{r.label}</span>
                    <span className="numeric shrink-0 text-2xs text-t2">{formatBytes(r.bytes)}</span>
                    <Tooltip label="Release now" placement="left">
                      <span>
                        <IconButton name="trash" size={12} box="sm" label={`Release ${r.label}`} onClick={r.release} />
                      </span>
                    </Tooltip>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-s3">
                    <motion.div
                      className={cx('h-full rounded-full', pct > 85 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)]')}
                      animate={{ width: `${pct}%` }}
                      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
                    />
                  </div>
                  <div className="numeric mt-1 text-[10px] text-t3">
                    {r.hint} · budget {formatBytes(r.budget)}
                  </div>
                </div>
              );
            })}

            {/* pool detail */}
            <div className="mb-1.5 rounded-[var(--radius-lg)] bg-s2 p-2">
              <div className="mb-1 text-2xs text-t2">LRU pools</div>
              {pools.map((p) => (
                <div key={p.id} className="numeric mb-0.5 flex items-baseline gap-2 text-[10px] last:mb-0">
                  <span className="w-16 shrink-0 capitalize text-t3">{p.id}</span>
                  <span className="text-t2">{formatBytes(p.bytes)}</span>
                  <span className="text-t3">/ {formatBytes(p.budget)}</span>
                  <span className="ml-auto text-t3">
                    {p.items} items · {(p.hitRate * 100).toFixed(0)}% hit · {p.evictions} evicted
                  </span>
                </div>
              ))}
            </div>

            {/* engine */}
            <div className="mb-1.5 rounded-[var(--radius-lg)] bg-s2 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-2xs text-t2">
                Render engine
                {stats && <Badge tone={stats.fps >= 50 ? 'ok' : stats.fps >= 30 ? 'warn' : 'danger'}>{stats.fps.toFixed(0)} fps</Badge>}
              </div>
              {stats ? (
                <div className="numeric grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-t3">
                  <span>backend <span className="text-t2">{stats.backend}</span></span>
                  <span>passes <span className="text-t2">{stats.passes}</span></span>
                  <span>last frame <span className="text-t2">{stats.lastRenderMs.toFixed(1)} ms</span></span>
                  <span>average <span className="text-t2">{stats.avgRenderMs.toFixed(1)} ms</span></span>
                  <span>work buffer <span className="text-t2">{stats.workSize.w}×{stats.workSize.h}</span></span>
                  <span>dropped <span className="text-t2">{stats.droppedFrames}</span></span>
                  <span className="col-span-2 truncate">renderer <span className="text-t2">{stats.renderer}</span></span>
                </div>
              ) : (
                <p className="text-[10px] text-t3">No engine mounted — open a photo in the editor.</p>
              )}
              {heap !== null && (
                <div className="numeric mt-1 text-[10px] text-t3">
                  JS heap <span className="text-t2">{formatBytes(heap)}</span>
                </div>
              )}
            </div>

            {/* models */}
            <div className="rounded-[var(--radius-lg)] bg-s2 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-2xs text-t2">
                Models
                <Badge tone="muted">{downloaded.length} downloaded · {residentModels.length} resident</Badge>
                <Button size="xs" variant="ghost" icon="download" className="ml-auto" onClick={() => { setOpen(false); useUi.getState().setModels(true); }}>
                  Manage
                </Button>
              </div>
              {residentModels.map((m) => (
                <div key={m.id} className="numeric flex items-baseline gap-2 text-[10px] text-t3">
                  <span className="min-w-0 flex-1 truncate text-t2">{m.name}</span>
                  <span>{m.residentMB} MB resident</span>
                </div>
              ))}
              {!residentModels.length && <p className="text-[10px] text-t3">Nothing resident — heuristics are serving masks and detection.</p>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default MemoryHud;
