import { useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { useCatalog, useVisibleIds } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { useDevelop } from '@/state/develop.ts';
import { Rating } from '@/ui/Controls.tsx';

/**
 * Filmstrip (§4.4): horizontal, virtualised, keyboard-driven. Arrow keys move
 * the active photo; the editor follows. Badges show rating, flag, stack count
 * and "edited" — all tonal, never stroked.
 */
export function Filmstrip() {
  const ids = useVisibleIds();
  const photos = useCatalog((s) => s.photos);
  const selection = useCatalog((s) => s.selection);
  const select = useCatalog((s) => s.select);
  const activeId = useCatalog((s) => s.activeId());
  const params = useDevelop((s) => s.params);
  const scroller = useRef<HTMLDivElement>(null);

  const v = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 92,
    horizontal: true,
    overscan: 8,
  });

  const index = activeId ? ids.indexOf(activeId) : -1;

  useEffect(() => {
    if (index >= 0) v.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const step = useCallback(
    (delta: number) => {
      const next = Math.min(ids.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      const id = ids[next];
      if (id) select(id);
    },
    [ids, index, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  void selection;

  return (
    <div className="relative z-10 h-24 shrink-0 bg-s1">
      <div ref={scroller} className="h-full w-full overflow-x-auto overflow-y-hidden no-scrollbar">
        <div className="relative flex h-full items-center" style={{ width: v.getTotalSize() }}>
          {v.getVirtualItems().map((vi) => {
            const id = ids[vi.index]!;
            const p = photos[id];
            if (!p) return null;
            const active = id === activeId;
            const stackCount = p.stackId ? Object.values(photos).filter((x) => x.stackId === p.stackId).length : 0;
            const edited = !!params[id];
            return (
              <div
                key={id}
                data-index={vi.index}
                ref={v.measureElement}
                className="absolute top-0 left-0 h-full py-2"
                style={{ transform: `translateX(${vi.start}px)`, width: vi.size }}
              >
                <button
                  type="button"
                  onClick={(e) => select(id, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey })}
                  onDoubleClick={() => useUi.getState().go('develop')}
                  aria-label={`${p.filename}${active ? ' (active)' : ''}`}
                  aria-current={active}
                  className={cx(
                    'group relative mx-1 flex h-full w-[84px] flex-col overflow-hidden rounded-[var(--radius-md)] transition-all duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                    active ? 'bg-s4 shadow-[var(--e2)]' : 'bg-s2 hover:bg-s3',
                  )}
                >
                  <img
                    src={p.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className={cx(
                      'min-h-0 flex-1 w-full object-cover transition-transform duration-[200ms]',
                      active ? 'scale-100' : 'scale-[0.98] opacity-80 group-hover:opacity-100',
                    )}
                  />
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]"
                    />
                  )}
                  <span className="flex h-5 shrink-0 items-center gap-1 px-1.5">
                    {p.flag === 'pick' && <SwIcon name="flag" size={11} className="text-[var(--color-ok)]" />}
                    {p.flag === 'reject' && <SwIcon name="close" size={11} className="text-[var(--color-danger)]" />}
                    {p.rating > 0 && <Rating value={p.rating} size={9} />}
                    {edited && <SwIcon name="develop" size={10} className="ml-auto text-[var(--color-accent)]" />}
                    {stackCount > 1 && (
                      <span className="numeric ml-auto rounded-[4px] bg-s4 px-1 text-[9px] text-t2">{stackCount}</span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-s1 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-s1 to-transparent" />
    </div>
  );
}

export default Filmstrip;
