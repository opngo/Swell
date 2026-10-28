import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Keycap } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl } from '@/ui/Controls.tsx';
import { PhotoGrid } from '@/components/PhotoGrid.tsx';
import { useCatalog, useVisibleIds } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { formatAperture, formatDate, formatDateTime, formatFocal, formatShutter } from '@swell/shared';
import type { Photo } from '@swell/schema';

/**
 * Page 3 — Cull & Compare (§4.3).
 *
 * Keyboard-first: ←/→ move, 0–5 rate, P pick, X reject, U unflag, Enter
 * develop, Backspace remove from view, ⇧C compare, ⇧S survey. Rating then
 * auto-advance is the whole point of the page, so it is on by default and
 * configurable in Settings.
 */
export function CullPage() {
  const ids = useVisibleIds();
  const photos = useCatalog((s) => s.photos);
  const select = useCatalog((s) => s.select);
  const activeId = useCatalog((s) => s.activeId());
  const rate = useCatalog((s) => s.rate);
  const flag = useCatalog((s) => s.flag);
  const compareCount = useUi((s) => s.compareCount);
  const setCompareCount = useUi((s) => s.setCompareCount);
  const surveyCount = useUi((s) => s.surveyCount);
  const setSurveyCount = useUi((s) => s.setSurveyCount);
  const go = useUi((s) => s.go);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [mode, setMode] = useState<'grid' | 'compare' | 'survey'>('grid');
  const [index, setIndex] = useState(0);
  const [linked, setLinked] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const safeIndex = Math.min(index, Math.max(0, ids.length - 1));
  const current = photos[ids[safeIndex] ?? ''] ?? null;

  useEffect(() => {
    const id = ids[safeIndex];
    if (id && id !== activeId) select(id);
  }, [safeIndex, ids, activeId, select]);

  const step = useCallback(
    (d: number) => setIndex((i) => Math.min(ids.length - 1, Math.max(0, i + d))),
    [ids.length],
  );

  const advance = useCallback(() => {
    if (autoAdvance) step(1);
  }, [autoAdvance, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const id = ids[safeIndex];
      if (!id) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      } else if (e.key >= '0' && e.key <= '5') {
        rate([id], Number(e.key));
        advance();
      } else if (e.key === 'p' || e.key === 'P') {
        flag([id], 'pick');
        advance();
      } else if (e.key === 'x' || e.key === 'X') {
        flag([id], 'reject');
        advance();
      } else if (e.key === 'u' || e.key === 'U') {
        flag([id], 'none');
        rate([id], 0);
      } else if (e.key === 'Enter') {
        select(id);
        go('develop');
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        useCatalog.getState().updatePhoto(id, { flag: 'reject' });
        advance();
      } else if (e.key === '=' || e.key === '+') {
        setZoom((z) => Math.min(8, z * 1.25));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(1, z / 1.25));
      } else if (e.key === '\\') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === 'c' && e.shiftKey) {
        setMode('compare');
      } else if (e.key === 's' && e.shiftKey) {
        setMode('survey');
      } else if (e.key === 'g' && e.shiftKey) {
        setMode('grid');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, flag, go, ids, rate, safeIndex, select, step]);

  const compareIds = useMemo(
    () => ids.slice(safeIndex, safeIndex + compareCount).filter(Boolean) as string[],
    [ids, safeIndex, compareCount],
  );
  const surveyIds = useMemo(() => {
    const sel = useCatalog.getState().selection;
    const base = sel.length >= 2 ? sel : ids.slice(safeIndex, safeIndex + surveyCount);
    return base.slice(0, Math.max(2, surveyCount)).filter(Boolean);
  }, [ids, safeIndex, surveyCount, mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 px-2">
        <SegmentedControl
          size="sm"
          ariaLabel="Cull mode"
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          segments={[
            { value: 'grid', label: 'Grid' },
            { value: 'compare', label: 'Compare' },
            { value: 'survey', label: 'Survey' },
          ]}
        />
        {mode === 'compare' && (
          <>
            <Select2 value={String(compareCount)} onChange={(v) => setCompareCount(Number(v))} options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} up` }))} />
            <Tooltip label="Link zoom & pan" placement="bottom">
              <span>
                <IconButton name="link" size={14} box="sm" label="Link zoom" pressed={linked} onClick={() => setLinked(!linked)} />
              </span>
            </Tooltip>
          </>
        )}
        {mode === 'survey' && <Select2 value={String(surveyCount)} onChange={(v) => setSurveyCount(Number(v))} options={[2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} up` }))} />}

        <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}
        <div className="flex items-center gap-0.5">
          <IconButton name="chevronLeft" size={14} box="sm" label="Previous (←)" disabled={safeIndex === 0} onClick={() => step(-1)} />
          <span className="numeric px-1 text-2xs text-t3">
            {safeIndex + 1} / {ids.length}
          </span>
          <IconButton name="chevronRight" size={14} box="sm" label="Next (→)" disabled={safeIndex >= ids.length - 1} onClick={() => step(1)} />
        </div>

        {current && (
          <div className="ml-2 flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <IconButton
                key={r}
                name={r <= current.rating ? 'starSolid' : 'star'}
                size={14}
                box="sm"
                label={`Rate ${r} (${r})`}
                className={r <= current.rating ? 'text-[oklch(0.82_0.14_85)]' : undefined}
                onClick={() => {
                  rate([current.id], r === current.rating ? 0 : r);
                  advance();
                }}
              />
            ))}
            <IconButton name="flag" size={14} box="sm" label="Pick (P)" pressed={current.flag === 'pick'} onClick={() => { flag([current.id], current.flag === 'pick' ? 'none' : 'pick'); advance(); }} />
            <IconButton name="close" size={14} box="sm" label="Reject (X)" pressed={current.flag === 'reject'} onClick={() => { flag([current.id], current.flag === 'reject' ? 'none' : 'reject'); advance(); }} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Chip active={autoAdvance} icon="arrowRight" onClick={() => setAutoAdvance(!autoAdvance)}>
            Auto-advance
          </Chip>
          <Button size="xs" variant="subtle" icon="develop" disabled={!current} onClick={() => { if (current) { select(current.id); go('develop'); } }}>
            Develop
          </Button>
        </div>
      </div>

      {mode === 'grid' && <PhotoGrid ids={ids} className="px-2 pb-3" />}

      {mode === 'compare' && (
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          {compareIds.map((id, i) => {
            const p = photos[id];
            if (!p) return null;
            return (
              <ComparePane
                key={id}
                photo={p}
                primary={i === 0}
                zoom={zoom}
                pan={pan}
                linked={linked}
                onZoom={(z) => setZoom(z)}
                onPan={(v) => setPan(v)}
                onRate={(r) => { rate([id], r); }}
                onFlag={(f) => flag([id], f)}
              />
            );
          })}
        </div>
      )}

      {mode === 'survey' && (
        <div className="grid min-h-0 flex-1 gap-2 p-2" style={{ gridTemplateColumns: `repeat(${Math.min(surveyCount, 3)}, minmax(0,1fr))`, gridTemplateRows: `repeat(${Math.ceil(surveyCount / 3)}, minmax(0,1fr))` }}>
          <AnimatePresence>
            {surveyIds.map((id) => {
              const p = photos[id];
              if (!p) return null;
              return (
                <motion.div
                  key={id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                  className="relative min-h-0 overflow-hidden rounded-[var(--radius-lg)] bg-s2 shadow-[var(--e1)]"
                >
                  <img src={p.src} alt={p.filename} className="size-full object-contain" draggable={false} />
                  <span className="absolute inset-x-1.5 top-1.5 flex items-center gap-1">
                    <Badge>{p.filename}</Badge>
                    <span className="ml-auto flex gap-0.5">
                      <IconButton name="flag" size={12} box="sm" label="Pick" pressed={p.flag === 'pick'} onClick={() => flag([id], p.flag === 'pick' ? 'none' : 'pick')} />
                      <IconButton name="close" size={12} box="sm" label="Reject" pressed={p.flag === 'reject'} onClick={() => flag([id], p.flag === 'reject' ? 'none' : 'reject')} />
                      <IconButton name="develop" size={12} box="sm" label="Develop" onClick={() => { select(id); go('develop'); }} />
                    </span>
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* metadata strip */}
      {current && (
        <div className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto bg-s1 px-2 no-scrollbar">
          <span className="numeric shrink-0 text-2xs text-t1">{current.filename}</span>
          <Meta p={current} />
          <span className="ml-auto flex shrink-0 items-center gap-1 text-2xs text-t3">
            <Keycap>←</Keycap>
            <Keycap>→</Keycap>
            <span>move</span>
            <Keycap>0-5</Keycap>
            <span>rate</span>
            <Keycap>P</Keycap>
            <Keycap>X</Keycap>
            <Keycap>Enter</Keycap>
            <span>develop</span>
          </span>
        </div>
      )}
    </div>
  );
}

function Meta({ p }: { p: Photo }) {
  return (
    <span className="numeric flex shrink-0 items-center gap-2 text-2xs text-t3">
      <span>{formatDateTime(p.captureTime)}</span>
      <span>{p.camera}</span>
      <span>{p.lens}</span>
      <span>{formatFocal(p.focalMm)}</span>
      <span>{formatAperture(p.aperture)}</span>
      <span>{formatShutter(p.shutter)}</span>
      <span>ISO {p.iso}</span>
      <span>{p.width}×{p.height}</span>
      <SwIcon name="clock" size={11} className="opacity-60" />
      <span>{formatDate(p.addedTime)}</span>
    </span>
  );
}

function ComparePane({
  photo,
  primary,
  zoom,
  pan,
  linked,
  onZoom,
  onPan,
  onRate,
  onFlag,
}: {
  photo: Photo;
  primary: boolean;
  zoom: number;
  pan: { x: number; y: number };
  linked: boolean;
  onZoom: (z: number) => void;
  onPan: (p: { x: number; y: number }) => void;
  onRate: (r: number) => void;
  onFlag: (f: Photo['flag']) => void;
}) {
  const [localZoom, setLocalZoom] = useState(1);
  const [localPan, setLocalPan] = useState({ x: 0, y: 0 });
  const z = primary || !linked ? (primary ? zoom : localZoom) : zoom;
  const p = primary || !linked ? (primary ? pan : localPan) : pan;
  const drag = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className={cx('relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-lg)]', primary ? 'bg-s2 shadow-[var(--e2)]' : 'bg-s1 shadow-[var(--e1)]')}>
      <img
        src={photo.src}
        alt={photo.filename}
        draggable={false}
        className="size-full object-contain"
        style={{ transform: `scale(${z}) translate(${p.x}px, ${p.y}px)`, transformOrigin: 'center' }}
        onWheel={(e) => {
          const next = Math.min(8, Math.max(1, (primary ? zoom : localZoom) * Math.exp(-e.deltaY * 0.002)));
          if (primary || !linked) {
            if (primary) onZoom(next);
            else setLocalZoom(next);
          } else onZoom(next);
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || z <= 1) return;
          const dx = (e.clientX - drag.current.x) / 100;
          const dy = (e.clientY - drag.current.y) / 100;
          drag.current = { x: e.clientX, y: e.clientY };
          const next = { x: p.x + dx, y: p.y + dy };
          if (primary || !linked) {
            if (primary) onPan(next);
            else setLocalPan(next);
          } else onPan(next);
        }}
        onPointerUp={() => (drag.current = null)}
      />

      <span className="absolute inset-x-1.5 top-1.5 flex items-center gap-1">
        <Badge tone={primary ? 'accent' : 'muted'}>{primary ? 'Select' : photo.filename}</Badge>
        {!primary && <Badge>{photo.filename}</Badge>}
        <span className="ml-auto flex gap-0.5">
          {[1, 2, 3, 4, 5].map((r) => (
            <IconButton key={r} name={r <= photo.rating ? 'starSolid' : 'star'} size={12} box="sm" label={`Rate ${r}`} className={r <= photo.rating ? 'text-[oklch(0.82_0.14_85)]' : undefined} onClick={() => onRate(r)} />
          ))}
          <IconButton name="flag" size={12} box="sm" label="Pick" pressed={photo.flag === 'pick'} onClick={() => onFlag(photo.flag === 'pick' ? 'none' : 'pick')} />
          <IconButton name="close" size={12} box="sm" label="Reject" pressed={photo.flag === 'reject'} onClick={() => onFlag(photo.flag === 'reject' ? 'none' : 'reject')} />
        </span>
      </span>

      <span className="glass numeric absolute bottom-1.5 left-1.5 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] text-t2">
        {Math.round(z * 100)}% · {photo.width}×{photo.height} · ISO {photo.iso} · {formatShutter(photo.shutter)}
      </span>
    </div>
  );
}

function Select2({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Layout"
      className="h-6 rounded-[var(--radius-sm)] bg-s2 px-1.5 text-2xs text-t1 focus:bg-s3 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default CullPage;
