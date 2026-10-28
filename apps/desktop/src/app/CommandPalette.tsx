/**
 * CommandPalette — ⌘K / Ctrl+K (§10).
 *
 * One input, ranked results across five domains: commands (from the shortcut
 * table), pages, photos, presets and collections. Fuzzy scoring is shared with
 * the catalog search so typing behaves the same everywhere.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Keycap } from '@/ui/Button.tsx';
import { useUi, ROUTES, ROUTE_META, type RouteId } from '@/state/ui.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useSettings } from '@/state/settings.ts';
import { toast } from '@/state/toasts.ts';
import { chordLabel, fuzzyContains, fuzzyScore, highlightRuns } from '@swell/shared';
import type { ShortcutAction } from '@swell/schema';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  combo?: string;
  run: () => void;
}

const ACTION_LABELS: Partial<Record<ShortcutAction, { label: string; icon: IconName }>> = {
  'view.home': { label: 'Go to Home & Import', icon: 'home' },
  'view.grid': { label: 'Go to Library grid', icon: 'library' },
  'view.loupe': { label: 'Go to Cull (loupe)', icon: 'cull' },
  'view.compare': { label: 'Go to Compare', icon: 'cull' },
  'view.survey': { label: 'Go to Survey', icon: 'cull' },
  'view.develop': { label: 'Go to Develop', icon: 'develop' },
  'view.curves': { label: 'Go to Light & Curves', icon: 'curve' },
  'view.layers': { label: 'Go to Layers & Masking', icon: 'layers' },
  'view.retouch': { label: 'Go to Remove & Retouch', icon: 'heal' },
  'view.smart': { label: 'Go to Smart Detect & Search', icon: 'smart' },
  'view.presets': { label: 'Go to Presets', icon: 'presets' },
  'view.export': { label: 'Go to Export & Print', icon: 'export' },
  'global.settings': { label: 'Open Settings', icon: 'settings' },
  'dev.memoryHud': { label: 'Toggle Memory HUD', icon: 'cpu' },
  'panels.toggleAll': { label: 'Hide / show all panels', icon: 'panoramaOut' },
  'window.fullscreen': { label: 'Toggle fullscreen', icon: 'expand' },
  'window.lightsOut': { label: 'Lights out', icon: 'moon' },
  'view.clipping': { label: 'Cycle clipping warning', icon: 'contrast' },
  'view.beforeAfter': { label: 'Cycle before / after', icon: 'split' },
  'view.zoomToggle': { label: 'Toggle zoom (fit ↔ 4×)', icon: 'zoomIn' },
  'view.infoOverlay': { label: 'Show photo info', icon: 'info' },
  'tool.crop': { label: 'Crop tool', icon: 'crop' },
  'tool.spot': { label: 'Heal / spot tool', icon: 'heal' },
  'tool.mask': { label: 'Brush mask tool', icon: 'brush' },
  'tool.wbDropper': { label: 'White balance eyedropper', icon: 'eyedropper' },
  'tool.hand': { label: 'Hand / pan tool', icon: 'menu' },
  'tool.softProof': { label: 'Toggle soft proofing', icon: 'colourFilter' },
  'tool.spotVisualize': { label: 'Toggle spot visualisation', icon: 'target' },
  'tool.removeBg': { label: 'Remove background', icon: 'mask' },
  'edit.undo': { label: 'Undo', icon: 'undo' },
  'edit.redo': { label: 'Redo', icon: 'redo' },
  'edit.copySettings': { label: 'Copy develop settings', icon: 'copy' },
  'edit.pasteSettings': { label: 'Paste develop settings', icon: 'paste' },
  'edit.syncSettings': { label: 'Sync settings to selection', icon: 'layers' },
  'edit.resetParams': { label: 'Reset all settings', icon: 'restart' },
  'edit.autoTone': { label: 'Auto tone', icon: 'magic' },
  'edit.virtualCopy': { label: 'Create virtual copy', icon: 'copy' },
  'library.quickCollection': { label: 'Toggle quick collection', icon: 'plus' },
  'library.stack': { label: 'Stack selection', icon: 'stack' },
  'library.delete': { label: 'Remove from catalog', icon: 'trash' },
  'flag.pick': { label: 'Flag as pick', icon: 'flag' },
  'flag.reject': { label: 'Flag as reject', icon: 'close' },
  'rate.5': { label: 'Rate 5 stars', icon: 'starSolid' },
  'rate.0': { label: 'Clear rating', icon: 'star' },
};

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const go = useUi((s) => s.go);
  const shortcuts = useSettings((s) => s.shortcuts);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [group, setGroup] = useState<'all' | 'actions' | 'photos' | 'presets'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<string[]>([]);

  const items = useMemo(() => {
    const out: Item[] = [];
    const ui = useUi.getState();
    const cat = useCatalog.getState();
    const dev = useDevelop.getState();

    /* pages */
    for (const r of [...ROUTES]) {
      out.push({
        id: `route:${r}`,
        group: 'Pages',
        label: ROUTE_META[r].label,
        hint: `Page ${ROUTE_META[r].num}`,
        icon: ROUTE_META[r].icon as IconName,
        run: () => go(r),
      });
    }

    /* commands */
    for (const [action, combo] of Object.entries(shortcuts) as [ShortcutAction, string][]) {
      const meta = ACTION_LABELS[action];
      if (!meta) continue;
      out.push({
        id: `action:${action}`,
        group: 'Commands',
        label: meta.label,
        icon: meta.icon,
        combo,
        run: () => runAction(action),
      });
    }

    /* photos */
    for (const id of cat.order.slice(0, 400)) {
      const p = cat.photos[id];
      if (!p) continue;
      out.push({
        id: `photo:${id}`,
        group: 'Photos',
        label: p.title || p.filename,
        hint: `${p.camera} · ${p.filename}`,
        icon: 'photos',
        run: () => {
          cat.select(id);
          ui.go('develop');
        },
      });
    }

    /* presets */
    for (const p of dev.presets) {
      out.push({
        id: `preset:${p.id}`,
        group: 'Presets',
        label: p.name,
        hint: p.group,
        icon: 'palette',
        run: () => {
          const ids = cat.selection.length ? cat.selection : cat.activeId() ? [cat.activeId()!] : [];
          if (!ids.length) {
            toast.warn('No photo selected', 'Select a photo first.');
            return;
          }
          dev.applyPreset(ids, p.id, 100);
          toast.ok('Preset applied', `${p.name} → ${ids.length} photo(s)`);
        },
      });
    }

    /* collections */
    for (const c of cat.collections) {
      out.push({
        id: `collection:${c.id}`,
        group: 'Collections',
        label: c.name,
        hint: `${c.photoIds.length} photos`,
        icon: c.kind === 'smart' ? 'smart' : 'library',
        run: () => {
          cat.setSource({ kind: 'collection', id: c.id, label: c.name });
          ui.go('library');
        },
      });
    }

    /* extra one-offs */
    out.push({ id: 'x:shortcuts', group: 'Commands', label: 'Keyboard shortcuts', icon: 'keyboard', combo: '?', run: () => ui.setShortcuts(true) });
    out.push({ id: 'x:models', group: 'Commands', label: 'Models manager', icon: 'download', run: () => ui.setModels(true) });
    out.push({ id: 'x:activity', group: 'Commands', label: 'Activity centre', icon: 'activity', run: () => ui.setActivity(true) });
    out.push({ id: 'x:export', group: 'Commands', label: 'Export selection now', icon: 'export', combo: shortcuts['view.export'], run: () => ui.go('export') });

    return out;
  }, [shortcuts, go]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (group === 'actions') list = list.filter((i) => i.group === 'Commands' || i.group === 'Pages');
    if (group === 'photos') list = list.filter((i) => i.group === 'Photos');
    if (group === 'presets') list = list.filter((i) => i.group === 'Presets');
    if (!q) {
      const rec = recent.map((id) => list.find((i) => i.id === id)).filter(Boolean) as Item[];
      return [...rec, ...list.filter((i) => !rec.includes(i))].slice(0, 60);
    }
    const scored = list
      .map((i) => {
        const hay = `${i.label} ${i.hint ?? ''}`.toLowerCase();
        // Tier first (prefix > substring > subsequence), then fuzzy quality so
        // "expo" ranks Export above Export with previous, not alphabetically.
        const f = fuzzyScore(i.label, q)?.score ?? 0;
        if (hay.startsWith(q)) return { i, s: 3, f };
        if (hay.includes(q)) return { i, s: 2, f };
        if (fuzzyContains(hay, q)) return { i, s: 1, f };
        return { i, s: 0, f };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.f - a.f || a.i.label.localeCompare(b.i.label));
    return scored.slice(0, 60).map((x) => x.i);
  }, [items, query, group, recent]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query, group]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[index];
        if (it) {
          it.run();
          setRecent((r) => [it.id, ...r.filter((x) => x !== it.id)].slice(0, 6));
          setOpen(false);
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setGroup((g) => (g === 'all' ? 'actions' : g === 'actions' ? 'photos' : g === 'photos' ? 'presets' : 'all'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, index, setOpen]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of filtered) {
      map.set(it.group, [...(map.get(it.group) ?? []), it]);
    }
    return [...map.entries()];
  }, [filtered]);

  /** Which characters of each visible label the query matched. */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const map = new Map<string, number[]>();
    for (const it of filtered) {
      const r = fuzzyScore(it.label, q);
      if (r && r.indices.length) map.set(it.id, r.indices);
    }
    return map;
  }, [filtered, query]);

  let running = -1;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[9200] bg-[oklch(0.08_0.01_250/0.55)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="glass-strong fixed top-[12vh] left-1/2 z-[9210] w-[min(680px,92vw)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--e3)]"
            initial={{ opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          >
            <div className="flex items-center gap-2 px-3 pt-3">
              <SwIcon name="search" size={16} className="shrink-0 text-t3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands, photos, presets…"
                aria-label="Command palette search"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-t1 placeholder:text-t3 focus:outline-none"
              />
              <Keycap>esc</Keycap>
            </div>

            <div className="flex items-center gap-1 px-3 pb-2">
              {(['all', 'actions', 'photos', 'presets'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={cx(
                    'h-6 rounded-[var(--radius-pill)] px-2 text-2xs capitalize transition-colors',
                    group === g ? 'bg-s4 text-t1 shadow-[var(--e1)]' : 'text-t3 hover:bg-s2 hover:text-t2',
                  )}
                >
                  {g}
                </button>
              ))}
              <span className="numeric ml-auto text-2xs text-t3">{filtered.length} results · Tab to switch</span>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto px-1.5 pb-2 no-scrollbar" role="listbox" aria-label="Results">
              {grouped.map(([name, list]) => (
                <div key={name} className="mb-1">
                  <div className="px-2 py-1 text-[10px] tracking-[0.08em] text-t3 uppercase">{name}</div>
                  {list.map((it) => {
                    running++;
                    const idx = running;
                    const active = idx === index;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        data-idx={idx}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setIndex(idx)}
                        onClick={() => {
                          it.run();
                          setRecent((r) => [it.id, ...r.filter((x) => x !== it.id)].slice(0, 6));
                          setOpen(false);
                        }}
                        className={cx(
                          'flex h-9 w-full items-center gap-2 rounded-[var(--radius-md)] px-2 text-left transition-colors duration-[100ms]',
                          active ? 'bg-[var(--color-accent-soft)] text-t1 shadow-[var(--e1)]' : 'text-t2 hover:bg-s2',
                        )}
                      >
                        <SwIcon name={it.icon} size={15} className={cx('shrink-0', active ? 'text-[var(--color-accent)]' : 'text-t3')} />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {hits?.has(it.id)
                            ? highlightRuns(it.label, hits.get(it.id)!).map((r, k) => (
                                <span key={k} className={r.hit ? 'text-t1' : undefined}>
                                  {r.text}
                                </span>
                              ))
                            : it.label}
                        </span>
                        {it.hint && <span className="numeric hidden shrink-0 truncate text-2xs text-t3 sm:block">{it.hint}</span>}
                        {it.combo && (
                          <span className="flex shrink-0 gap-0.5">
                            {it.combo.split('+').map((k) => (
                              <Keycap key={k}>{chordLabel(k)}</Keycap>
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!filtered.length && (
                <div className="grid place-items-center py-10 text-t3">
                  <SwIcon name="search" size={22} />
                  <span className="mt-2 text-xs">Nothing matches “{query}”.</span>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Palette commands re-use the same dispatch the keyboard bus uses. */
function runAction(action: ShortcutAction) {
  const ui = useUi.getState();
  const cat = useCatalog.getState();
  const dev = useDevelop.getState();
  const ids = cat.selection.length ? cat.selection : cat.activeId() ? [cat.activeId()!] : [];
  const one = ids[0] ?? cat.activeId() ?? '';

  switch (action) {
    case 'view.home': return ui.go('home');
    case 'view.grid': return ui.go('library');
    case 'view.loupe': case 'view.compare': case 'view.survey': return ui.go('cull');
    case 'view.develop': return ui.go('develop');
    case 'view.curves': return ui.go('curves');
    case 'view.layers': return ui.go('layers');
    case 'view.retouch': return ui.go('retouch');
    case 'view.smart': return ui.go('smart');
    case 'view.presets': return ui.go('presets');
    case 'view.export': return ui.go('export');
    case 'global.settings': return ui.go('export');
    case 'dev.memoryHud': return ui.setMemoryHud(true);
    case 'panels.toggleAll': { ui.toggleLeft(); ui.toggleRight(); ui.toggleFilmstrip(); return; }
    case 'window.fullscreen': {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
      return;
    }
    case 'window.lightsOut': {
      const el = document.documentElement;
      el.dataset.lightsOut = el.dataset.lightsOut === 'true' ? 'false' : 'true';
      return;
    }
    case 'view.clipping': {
      const order = ['off', 'highlights', 'shadows', 'both'] as const;
      ui.patchOverlays({ clipping: order[(order.indexOf(ui.overlays.clipping as never) + 1) % order.length]! });
      return;
    }
    case 'view.beforeAfter': {
      ui.patchBeforeAfter({ mode: ui.beforeAfter.mode === 'off' ? 'split' : 'off' });
      return;
    }
    case 'view.zoomToggle': {
      ui.setView({ zoom: ui.view.zoom > 1.01 ? 1 : 4, panX: 0, panY: 0 });
      return;
    }
    case 'view.infoOverlay': return toast.info('Photo info', 'Hold I over the stage to see the metadata card.');
    case 'tool.crop': return editorTool('crop');
    case 'tool.spot': return editorTool('heal');
    case 'tool.mask': return editorTool('brush');
    case 'tool.wbDropper': return editorTool('eyedropper');
    case 'tool.hand': return editorTool('move');
    case 'tool.softProof': { ui.patchSoftProof({ enabled: !ui.softProof.enabled }); return; }
    case 'tool.spotVisualize': { ui.patchOverlays({ spotVisualize: ui.overlays.spotVisualize > 0 ? 0 : 0.5 }); return; }
    case 'tool.removeBg': return toast.info('Remove background', 'Available in the Retouch inspector (⌘⇧B).');
    case 'edit.undo': return toast.info('Undo', dev.undo(one) ?? 'Nothing to undo');
    case 'edit.redo': return toast.info('Redo', dev.redo(one) ?? 'Nothing to redo');
    case 'edit.copySettings': { dev.copyParams(one); return toast.ok('Settings copied'); }
    case 'edit.pasteSettings': { dev.pasteParams(ids, dev.copyParams(one)); return toast.ok('Settings pasted', `${ids.length} photo(s)`); }
    case 'edit.syncSettings': { dev.pasteParams(ids, dev.copyParams(one)); return toast.ok('Settings synced', `${ids.length} photo(s)`); }
    case 'edit.resetParams': { dev.resetAll(one); return toast.ok('Settings reset'); }
    case 'edit.autoTone': {
      const p = dev.getParams(one);
      dev.commit(one, { ...p, tone: { ...p.tone, exposure: p.tone.exposure + 0.2, contrast: 12, shadows: 18, highlights: -22 } }, 'Auto tone');
      return toast.ok('Auto tone applied');
    }
    case 'edit.virtualCopy': return toast.info('Virtual copy', "Use ⌘' on a selected photo.");
    case 'library.quickCollection': { cat.toggleQuick(ids); return toast.ok('Quick collection updated', `${ids.length} photo(s)`); }
    case 'library.stack': { if (ids.length > 1) cat.stackWith(ids, `stack-${Date.now()}`); return toast.ok('Stacked', `${ids.length} photo(s)`); }
    case 'library.delete': { cat.deletePhotos(ids); return toast.ok('Removed from catalog', `${ids.length} photo(s)`); }
    case 'flag.pick': { cat.flag(ids, 'pick'); return; }
    case 'flag.reject': { cat.flag(ids, 'reject'); return; }
    case 'rate.5': { cat.rate(ids, 5); return; }
    case 'rate.0': { cat.rate(ids, 0); return; }
    default: return;
  }
}

async function editorTool(tool: string) {
  const { editorStore, patchToolAtom } = await import('@/state/atoms.ts');
  editorStore.set(patchToolAtom, { tool: tool as never });
  if (!['develop', 'curves', 'layers', 'retouch'].includes(useUi.getState().route)) {
    useUi.getState().go(tool === 'brush' ? 'layers' : tool === 'heal' ? 'retouch' : 'develop');
  }
}
