import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { engineOkAtom, engineStatsAtom, engineErrorAtom } from '@/state/atoms.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { formatBytes } from '@swell/shared';

/**
 * Status bar (26 px): selection, engine health, memory pools, model state.
 * Every number is tabular so it never reflows.
 */
export function StatusBar() {
  const selection = useCatalog((s) => s.selection);
  const visible = useCatalog((s) => s.order.length);
  const tasks = useCatalog((s) => s.tasks);
  const ok = useAtomValue(engineOkAtom);
  const stats = useAtomValue(engineStatsAtom);
  const error = useAtomValue(engineErrorAtom);
  const memoryOpen = useUi((s) => s.memoryHudOpen);
  const setMemory = useUi((s) => s.setMemoryHud);
  const [pools, setPools] = useState(() => imageLoader.stats());
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setPools(imageLoader.stats()), 2000);
    const c = window.setInterval(() => setClock(new Date()), 30_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(c);
    };
  }, []);

  const running = tasks.find((t) => t.state === 'running');
  const cached = pools.reduce((a, p) => a + p.bytes, 0);

  return (
    <footer className="relative z-40 flex h-[26px] items-center gap-3 bg-s1 px-3 text-2xs text-t3">
      <span className="numeric">
        {selection.length ? `${selection.length} selected` : `${visible} photos`}
      </span>

      {running && (
        <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
          <SwIcon name="restart" size={12} className="animate-spin" />
          <span className="numeric">
            {running.label} · {running.done}/{running.total}
          </span>
        </span>
      )}

      <span className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMemory(!memoryOpen)}
          className={cx(
            'flex items-center gap-1.5 rounded-[5px] px-1.5 py-0.5 transition-colors hover:bg-s2',
            memoryOpen && 'text-[var(--color-accent)]',
          )}
          aria-label="Memory HUD"
        >
          <SwIcon name="disk" size={12} />
          <span className="numeric">{formatBytes(cached)}</span>
          <span className="hidden sm:inline">cached</span>
        </button>

        <span className={cx('flex items-center gap-1.5', ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]')}>
          <SwIcon name={ok ? 'cpu' : 'warning'} size={12} />
          <span className="numeric">{stats ? `${stats.backend.toUpperCase()} · ${stats.fps.toFixed(0)} fps` : 'engine idle'}</span>
        </span>

        {stats && (
          <span className="numeric hidden md:inline">
            {stats.lastRenderMs.toFixed(1)} ms · {stats.passes} passes · {formatBytes(stats.textureBytes)} VRAM
          </span>
        )}

        {!ok && error && (
          <span className="flex items-center gap-1 text-[var(--color-danger)]">
            <SwIcon name="warning" size={12} />
            <span className="max-w-40 truncate">{error}</span>
          </span>
        )}

        <span className="numeric hidden lg:inline">
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
    </footer>
  );
}
