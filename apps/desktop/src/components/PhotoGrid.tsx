/**
 * PhotoGrid — the virtualised thumbnail surface shared by Library, Cull,
 * Smart and Presets previews (§4.2, §4.8, §4.9).
 *
 * Cells are absolutely positioned from a row virtualiser, so 10 000 photos cost
 * the same as 100. Selection, ratings, flags, colour labels, stack badges and
 * the "edited" marker are all tonal — nothing is outlined.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import type { Photo } from '@swell/schema';

/** Video sidecars are catalogued but not developed (§7.1). */
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'];

export const COLOR_LABELS: Record<Photo['colorLabel'], { label: string; css: string }> = {
  none: { label: 'None', css: 'transparent' },
  red: { label: 'Red', css: 'oklch(0.63 0.21 25)' },
  yellow: { label: 'Yellow', css: 'oklch(0.85 0.16 95)' },
  green: { label: 'Green', css: 'oklch(0.74 0.17 150)' },
  blue: { label: 'Blue', css: 'oklch(0.62 0.17 250)' },
  purple: { label: 'Purple', css: 'oklch(0.6 0.2 305)' },
};

export interface PhotoGridProps {
  ids: string[];
  /** px, defaults to the catalog grid size */
  size?: number;
  /** extra class on the scroller */
  className?: string;
  onOpen?: (id: string) => void;
  /** render a footer under each cell (used by Cull for metadata) */
  cellFooter?: (p: Photo) => React.ReactNode;
  emptyLabel?: string;
}

export function PhotoGrid({ ids, size, className, onOpen, cellFooter, emptyLabel }: PhotoGridProps) {
  const catalogSize = useCatalog((s) => s.gridSize);
  const setGridSize = useCatalog((s) => s.setGridSize);
  const cell = Math.max(96, Math.min(640, size ?? catalogSize));
  const gap = 8;
  const scroller = useRef<HTMLDivElement>(null);
  const photos = useCatalog((s) => s.photos);
  const selection = useCatalog((s) => s.selection);
  const select = useCatalog((s) => s.select);
  const rate = useCatalog((s) => s.rate);
  const flag = useCatalog((s) => s.flag);
  const edited = useDevelop((s) => s.params);
  const density = useSettings((s) => s.settings.appearance.density);
  const open = useUi((s) => s.go);

  const cols = Math.max(1, Math.floor((scroller.current?.clientWidth ?? 1200) / (cell + gap)));
  const rows = Math.ceil(ids.length / cols);
  const rowHeight = cell * (cellFooter ? 1.16 : 1) + gap;

  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const handleOpen = useCallback(
    (id: string) => {
      if (onOpen) onOpen(id);
      else {
        select(id);
        open('develop');
      }
    },
    [onOpen, open, select],
  );

  useEffect(() => {
    const onResize = () => v.measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [v]);

  const visible = useMemo(() => v.getVirtualItems(), [v, rows, cell]);

  if (!ids.length) {
    return (
      <div className={cx('grid flex-1 place-items-center text-t3', className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <SwIcon name="photos" size={30} />
          <span className="text-xs">{emptyLabel ?? 'No photos match this view.'}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={scroller} className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto', className)}>
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {visible.map((row) => {
          const start = row.index * cols;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={v.measureElement}
              className="absolute top-0 left-0 flex w-full"
              style={{ transform: `translateY(${row.start}px)`, height: rowHeight, gap }}
            >
              {ids.slice(start, start + cols).map((id) => {
                const p = photos[id];
                if (!p) return <div key={id} style={{ width: cell }} />;
                const isSel = selection.includes(id);
                return (
                  <PhotoCell
                    key={id}
                    photo={p}
                    size={cell}
                    selected={isSel}
                    edited={!!edited[id]}
                    density={density}
                    footer={cellFooter?.(p)}
                    onSelect={(opts) => select(id, opts)}
                    onOpen={() => handleOpen(id)}
                    onRate={(r) => rate([id], r)}
                    onFlag={(f) => flag([id], f)}
                    onResize={(px) => setGridSize(px)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhotoCell({
  photo,
  size,
  selected,
  edited,
  density,
  footer,
  onSelect,
  onOpen,
  onRate,
  onFlag,
  onResize,
}: {
  photo: Photo;
  size: number;
  selected: boolean;
  edited: boolean;
  density: string;
  footer?: React.ReactNode;
  onSelect: (opts?: { additive?: boolean; range?: boolean }) => void;
  onOpen: () => void;
  onRate: (r: number) => void;
  onFlag: (f: Photo['flag']) => void;
  onResize: (px: number) => void;
}) {
  const stackCount = useCatalog((s) => (photo.stackId ? Object.values(s.photos).filter((p) => p.stackId === photo.stackId).length : 0));
  const inQuick = useCatalog((s) => s.collections.find((c) => c.id === 'col-quick')?.photoIds.includes(photo.id) ?? false);
  const [hover, setHover] = useState(false);

  return (
    <div style={{ width: size }} className="shrink-0">
      <div
        role="gridcell"
        aria-selected={selected}
        tabIndex={0}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={(e) => onSelect({ additive: e.metaKey || e.ctrlKey, range: e.shiftKey })}
        onDoubleClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
        }}
        onWheel={(e) => {
          if (!e.altKey) return;
          onResize(Math.max(96, Math.min(640, size - Math.sign(e.deltaY) * 24)));
        }}
        className={cx(
          'group relative overflow-hidden rounded-[var(--radius-lg)] transition-all duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          selected ? 'bg-s4 shadow-[var(--e2)]' : 'bg-s2 hover:bg-s3 hover:shadow-[var(--e1)]',
          density === 'compact' && 'rounded-[var(--radius-sm)]',
        )}
        style={{ height: size }}
      >
        <img
          src={photo.src}
          alt={photo.title || photo.filename}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cx(
            'size-full object-cover transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            hover && 'scale-[1.02]',
            photo.flag === 'reject' && 'opacity-45 saturate-50',
          )}
        />

        {/* colour label — a soft tonal wash, never a stroke */}
        {photo.colorLabel !== 'none' && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2"
            style={{ background: `linear-gradient(to top, ${COLOR_LABELS[photo.colorLabel].css}, transparent)` }}
          />
        )}

        {/* badges */}
        <span className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start gap-1">
          {photo.flag === 'pick' && <SwIcon name="flag" size={13} className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] text-[var(--color-ok)]" />}
          {photo.flag === 'reject' && <SwIcon name="close" size={13} className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] text-[var(--color-danger)]" />}
          {inQuick && <Badge icon="plus">Quick</Badge>}
          <span className="ml-auto flex items-center gap-1">
            {edited && <SwIcon name="develop" size={13} className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] text-[var(--color-accent)]" />}
            {stackCount > 1 && <Badge>{stackCount}</Badge>}
            {VIDEO_EXT.includes(photo.ext.toLowerCase()) && <SwIcon name="videoCamera" size={13} className="text-t1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />}
          </span>
        </span>

        {/* rating */}
        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((r) => (
            <SwIcon
              key={r}
              name={r <= photo.rating ? 'starSolid' : 'star'}
              size={11}
              className={cx('drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]', r <= photo.rating ? 'text-[oklch(0.82_0.14_85)]' : 'text-t3/70')}
            />
          ))}
          <span className="numeric ml-auto rounded-[5px] bg-[oklch(0.1_0.01_250/0.6)] px-1 text-[9px] text-t2 backdrop-blur-sm">
            {photo.iso ? `ISO ${photo.iso}` : photo.camera}
          </span>
        </span>

        {/* hover toolbar */}
        {hover && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-[oklch(0.1_0.01_250/0.9)] to-transparent px-1.5 pt-5 pb-1.5">
            <CellButton icon="flag" label="Pick (P)" tone="ok" active={photo.flag === 'pick'} onClick={() => onFlag(photo.flag === 'pick' ? 'none' : 'pick')} />
            <CellButton icon="close" label="Reject (X)" tone="danger" active={photo.flag === 'reject'} onClick={() => onFlag(photo.flag === 'reject' ? 'none' : 'reject')} />
            {[1, 2, 3, 4, 5].map((r) => (
              <CellButton key={r} icon="star" label={`${r} star${r > 1 ? 's' : ''} (${r})`} active={photo.rating === r} onClick={() => onRate(photo.rating === r ? 0 : r)}>
                {r}
              </CellButton>
            ))}
            <CellButton icon="develop" label="Develop (D)" onClick={onOpen} />
          </span>
        )}
      </div>
      {footer}
    </div>
  );
}

function CellButton({
  icon,
  label,
  active,
  tone,
  onClick,
  children,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  tone?: 'ok' | 'danger';
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip label={label} placement="top">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cx(
          'grid size-6 place-items-center rounded-[var(--radius-sm)] text-[10px] transition-colors',
          active
            ? tone === 'danger'
              ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
              : tone === 'ok'
                ? 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]'
                : 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'bg-t1/10 text-t2 hover:bg-t1/20 hover:text-t1',
        )}
      >
        {children ?? <SwIcon name={icon} size={12} />}
      </button>
    </Tooltip>
  );
}

function Badge({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  return (
    <span className="numeric flex items-center gap-0.5 rounded-[5px] bg-[oklch(0.1_0.01_250/0.6)] px-1 py-px text-[9px] text-t2 backdrop-blur-sm">
      {icon && <SwIcon name={icon} size={9} />}
      {children}
    </span>
  );
}

