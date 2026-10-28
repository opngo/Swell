/**
 * KeyboardBus — the single global shortcut dispatcher (§10).
 *
 * Bindings come from Settings, so a rebind takes effect immediately and the
 * Lightroom-style preset works out of the box. One listener, one lookup table,
 * no per-component key handling (the editor's own keys — Space to pan, arrows
 * in sliders — are handled where the focus already is).
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSettings } from '@/state/settings.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi, isEditorRoute } from '@/state/ui.ts';
import { editorStore, liveParamsAtom, patchToolAtom, setLiveAtom } from '@/state/atoms.ts';
import { toast } from '@/state/toasts.ts';
import { formatChord, formatDateTime, matchesCombo, formatAperture, formatFocal, formatShutter } from '@swell/shared';
import type { ShortcutAction } from '@swell/schema';

export function KeyboardBus() {
  const shortcuts = useSettings((s) => s.shortcuts);
  const [info, setInfo] = useState(false);
  const heldBefore = useRef<string | null>(null);
  const heldInfo = useRef(false);

  useEffect(() => {
    const byCombo = new Map<string, ShortcutAction>();
    for (const [action, combo] of Object.entries(shortcuts) as [ShortcutAction, string][]) {
      byCombo.set(combo.toLowerCase(), action);
    }

    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'textbox';
    };

    const selected = () => {
      const c = useCatalog.getState();
      return c.selection.length ? c.selection : c.activeId() ? [c.activeId()!] : [];
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // global escapes that always work
      if (e.key === 'Escape') {
        const ui = useUi.getState();
        if (ui.paletteOpen) ui.setPalette(false);
        else if (ui.activityOpen) ui.setActivity(false);
        else if (ui.memoryHudOpen) ui.setMemoryHud(false);
        else if (ui.shortcutsOpen) ui.setShortcuts(false);
        else if (ui.modelsOpen) ui.setModels(false);
        return;
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        useUi.getState().setShortcuts(true);
        return;
      }
      if (isTyping(e.target)) return;
      if (e.metaKey && e.key.toLowerCase() === 'r') return; // never steal reload
      if (e.altKey && e.key === 'Tab') return; // OS window switching

      const combo = formatChord(e);
      let action = byCombo.get(combo);
      if (!action) {
        for (const [c, a] of byCombo) if (matchesCombo(e, c)) { action = a; break; }
      }
      if (!action) return;

      // let the browser keep its own chords we did not intend to bind
      const bound = Object.values(shortcuts).map((x) => x.toLowerCase());
      if (!bound.includes(combo) && !bound.some((b) => matchesCombo(e, b))) return;

      e.preventDefault();
      dispatch(action, { held: heldBefore, info: setInfo, heldInfo });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const combo = formatChord(e);
      const action = byCombo.get(combo);
      if (action === 'view.beforeAfterHold' && heldBefore.current) {
        useUi.getState().patchBeforeAfter({ mode: heldBefore.current as never });
        heldBefore.current = null;
      }
      if (action === 'view.infoOverlay') {
        heldInfo.current = false;
        setInfo(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [shortcuts]);

  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);

  return (
    <AnimatePresence>
      {info && photo && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="glass-strong pointer-events-none fixed bottom-9 left-1/2 z-[8800] w-[min(560px,90vw)] -translate-x-1/2 rounded-[var(--radius-lg)] p-3 text-2xs text-t1 shadow-[var(--e3)]"
        >
          <div className="mb-1 flex items-baseline gap-2">
            <span className="numeric truncate text-xs font-medium">{photo.filename}</span>
            <span className="numeric ml-auto shrink-0 text-t3">{photo.width}×{photo.height}</span>
          </div>
          <div className="numeric grid grid-cols-2 gap-x-4 gap-y-0.5 text-t2 sm:grid-cols-3">
            <span>{photo.camera}</span>
            <span>{photo.lens}</span>
            <span>{formatFocal(photo.focalMm)}</span>
            <span>{formatAperture(photo.aperture)}</span>
            <span>{formatShutter(photo.shutter)}</span>
            <span>ISO {photo.iso}</span>
            <span className="col-span-2">{formatDateTime(photo.captureTime)}</span>
            <span>{photo.gps?.place ?? 'No location'}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- dispatch */

interface Ctx {
  held: React.MutableRefObject<string | null>;
  info: (v: boolean) => void;
  heldInfo: React.MutableRefObject<boolean>;
}

function dispatch(action: ShortcutAction, ctx: Ctx) {
  const ui = useUi.getState();
  const cat = useCatalog.getState();
  const dev = useDevelop.getState();
  const ids = cat.selection.length ? cat.selection : cat.activeId() ? [cat.activeId()!] : [];
  const one = ids[0] ?? cat.activeId() ?? '';

  switch (action) {
    /* ---------------------------------------------------------- navigation */
    case 'view.home': return ui.go('home');
    case 'view.grid': return ui.go('library');
    case 'view.loupe':
    case 'view.compare':
    case 'view.survey': return ui.go('cull');
    case 'view.develop': return ui.go('develop');
    case 'view.curves': return ui.go('curves');
    case 'view.layers': return ui.go('layers');
    case 'view.retouch': return ui.go('retouch');
    case 'view.smart': return ui.go('smart');
    case 'view.presets': return ui.go('presets');
    case 'view.export':
    case 'export.dialog':
    case 'export.previous': return ui.go('export');
    case 'global.palette': return ui.setPalette(!ui.paletteOpen);
    case 'global.settings': {
      ui.go('export');
      toast.info('Settings', 'Export · Print · Settings — the settings tab is on the right.');
      return;
    }
    case 'dev.memoryHud': return ui.setMemoryHud(!ui.memoryHudOpen);

    /* -------------------------------------------------------------- panels */
    case 'panels.toggleAll': {
      const hidden = !ui.leftOpen || !ui.rightOpen || !ui.filmstripOpen;
      if (hidden) {
        if (!ui.leftOpen) ui.toggleLeft();
        if (!ui.rightOpen) ui.toggleRight();
        if (!ui.filmstripOpen) ui.toggleFilmstrip();
      } else {
        ui.toggleLeft();
        ui.toggleRight();
        ui.toggleFilmstrip();
      }
      return;
    }
    case 'panels.toggleSides': {
      ui.toggleLeft();
      ui.toggleRight();
      return;
    }
    case 'window.fullscreen': {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
      return;
    }
    case 'window.lightsOut': {
      // hide chrome and drop the backdrop to black so the photo floats
      const el = document.documentElement;
      const on = el.dataset.lightsOut !== 'true';
      el.dataset.lightsOut = String(on);
      if (on) {
        if (ui.leftOpen) ui.toggleLeft();
        if (ui.rightOpen) ui.toggleRight();
      }
      toast.info(on ? 'Lights out' : 'Lights on', on ? 'Chrome hidden — press L to bring it back.' : 'Chrome restored.');
      return;
    }

    /* ---------------------------------------------------------------- view */
    case 'view.zoomToggle':
    case 'tool.zoom': {
      ui.setView({ zoom: ui.view.zoom > 1.01 ? 1 : 4, panX: 0, panY: 0, mode: ui.view.zoom > 1.01 ? 'fit' : 'custom' });
      return;
    }
    case 'view.infoOverlay': {
      ctx.heldInfo.current = true;
      ctx.info(true);
      return;
    }
    case 'view.beforeAfter': {
      const order = ['off', 'split', 'toggle'] as const;
      const next = order[(order.indexOf(ui.beforeAfter.mode as never) + 1) % order.length]!;
      ui.patchBeforeAfter({ mode: next });
      return;
    }
    case 'view.beforeAfterHold': {
      if (!ctx.held.current) ctx.held.current = ui.beforeAfter.mode;
      ui.patchBeforeAfter({ mode: 'toggle' });
      return;
    }
    case 'view.clipping': {
      const order = ['off', 'highlights', 'shadows', 'both'] as const;
      const next = order[(order.indexOf(ui.overlays.clipping as never) + 1) % order.length]!;
      ui.patchOverlays({ clipping: next });
      toast.info('Clipping', next === 'off' ? 'Off' : `Showing ${next}`);
      return;
    }

    /* ------------------------------------------------------------- ratings */
    case 'rate.0': case 'rate.1': case 'rate.2': case 'rate.3': case 'rate.4': case 'rate.5': {
      const r = Number(action.slice(-1));
      cat.rate(ids, r);
      advance(cat, ids);
      return;
    }
    case 'flag.pick': { cat.flag(ids, cat.photos[one]?.flag === 'pick' ? 'none' : 'pick'); advance(cat, ids); return; }
    case 'flag.reject': { cat.flag(ids, cat.photos[one]?.flag === 'reject' ? 'none' : 'reject'); advance(cat, ids); return; }
    case 'flag.none': { cat.flag(ids, 'none'); return; }
    case 'label.red': return cat.label(ids, 'red');
    case 'label.yellow': return cat.label(ids, 'yellow');
    case 'label.green': return cat.label(ids, 'green');
    case 'label.blue': return cat.label(ids, 'blue');

    /* --------------------------------------------------------------- tools */
    case 'tool.crop': return editorStore.set(patchToolAtom, { tool: 'crop' });
    case 'tool.spot': return editorStore.set(patchToolAtom, { tool: 'heal' });
    case 'tool.mask': return editorStore.set(patchToolAtom, { tool: 'brush' });
    case 'tool.tat': return editorStore.set(patchToolAtom, { tool: 'guides' });
    case 'tool.wbDropper': return editorStore.set(patchToolAtom, { tool: 'eyedropper' });
    case 'tool.hand': return editorStore.set(patchToolAtom, { tool: 'move' });
    case 'tool.overlay': {
      const live = editorStore.get(liveParamsAtom);
      const layer = live.params.layers[live.params.layers.length - 1];
      ui.patchOverlays({
        mask: ui.overlays.mask?.layerId ? null : layer ? { layerId: layer.id, mode: 'color', color: '#ff3b6b', opacity: 0.6 } : null,
      });
      if (!layer) toast.info('No layers', 'Add a masked layer to see an overlay.');
      return;
    }
    case 'tool.spotVisualize': {
      ui.patchOverlays({ spotVisualize: ui.overlays.spotVisualize > 0 ? 0 : 0.5 });
      return;
    }
    case 'tool.softProof': {
      ui.patchSoftProof({ enabled: !ui.softProof.enabled });
      toast.info('Soft proof', ui.softProof.enabled ? 'Off' : `Proofing ${ui.softProof.profile || 'sRGB'}`);
      return;
    }
    case 'tool.removeBg': {
      const live = editorStore.get(liveParamsAtom);
      const bg = live.params.bgRemoval;
      const next = { ...(bg ?? ({} as NonNullable<typeof bg>)), enabled: !(bg?.enabled ?? false) };
      editorStore.set(setLiveAtom, { ...live.params, bgRemoval: next });
      dev.commit(one, editorStore.get(liveParamsAtom).params, next.enabled ? 'Remove background on' : 'Remove background off');
      toast.ok(next.enabled ? 'Background removed' : 'Background restored', next.enabled ? 'Choose a replacement in the Retouch panel.' : 'One undo step away.');
      return;
    }

    /* --------------------------------------------------------------- edits */
    case 'edit.undo': {
      const label = dev.undo(one);
      toast.info('Undo', label ?? 'Nothing to undo');
      return;
    }
    case 'edit.redo': {
      const label = dev.redo(one);
      toast.info('Redo', label ?? 'Nothing to redo');
      return;
    }
    case 'edit.copySettings': {
      if (!one) return;
      dev.copyParams(one);
      void navigator.clipboard?.writeText(JSON.stringify(dev.copyParams(one))).catch(() => undefined);
      toast.ok('Settings copied', 'Paste into any selection.');
      return;
    }
    case 'edit.pasteSettings': {
      if (!ids.length) return;
      dev.pasteParams(ids, dev.copyParams(one));
      toast.ok('Settings pasted', `${ids.length} photo(s)`);
      return;
    }
    case 'edit.syncSettings': {
      if (ids.length < 2) {
        toast.warn('Select more photos', 'Sync applies the active photo’s settings to the rest of the selection.');
        return;
      }
      dev.pasteParams(ids.slice(1), dev.copyParams(one));
      toast.ok('Settings synced', `${ids.length - 1} photo(s) updated.`);
      return;
    }
    case 'edit.copySettingsDialog': {
      ui.go('presets');
      toast.info('Create preset', 'Choose which groups to store, then save.');
      return;
    }
    case 'edit.virtualCopy': {
      if (!one) return;
      const p = cat.photos[one];
      if (!p) return;
      cat.addPhotos([{ ...p, id: `${one}-copy-${Date.now()}`, filename: p.filename.replace(/(\.[^.]+)$/, '-copy$1'), title: `${p.title} (copy)` }]);
      dev.pasteParams([`${one}-copy-${Date.now()}`], dev.getParams(one));
      toast.ok('Virtual copy created', 'A new catalog entry with the same edits.');
      return;
    }
    case 'edit.resetParams': {
      if (!one) return;
      dev.resetAll(one);
      toast.ok('Settings reset', 'Back to the imported original.');
      return;
    }
    case 'edit.autoTone': {
      if (!one) return;
      const params = dev.getParams(one);
      dev.commit(one, { ...params, tone: { ...params.tone, exposure: params.tone.exposure + 0.2, contrast: 12, shadows: 18, highlights: -22 } }, 'Auto tone');
      toast.ok('Auto tone', 'Exposure, contrast and the extremes were balanced.');
      return;
    }

    /* ------------------------------------------------------------- library */
    case 'library.quickCollection': {
      cat.toggleQuick(ids);
      toast.ok('Quick collection', `${ids.length} photo(s) toggled (B).`);
      return;
    }
    case 'library.stack': {
      if (ids.length < 2) {
        toast.warn('Select 2+ photos', 'Stacking groups a burst or RAW+JPEG pair.');
        return;
      }
      cat.stackWith(ids, `stack-${Date.now()}`);
      toast.ok('Stacked', `${ids.length} photos in one stack.`);
      return;
    }
    case 'library.filter': {
      ui.go('library');
      ui.setPalette(true);
      return;
    }
    case 'library.delete': {
      if (!ids.length) return;
      const confirm = useSettings.getState().settings.general.confirmDelete;
      if (confirm && !window.confirm(`Remove ${ids.length} photo(s) from the catalog? The files stay on disk.`)) return;
      cat.deletePhotos(ids);
      toast.ok('Removed from catalog', `${ids.length} photo(s). Files were not deleted.`);
      return;
    }
    case 'library.next': return advance(cat, ids, 1);
    case 'library.prev': return advance(cat, ids, -1);

    case 'cull.autoAdvance': {
      toast.info('Auto-advance', 'Toggled from the Cull toolbar.');
      return;
    }
    case 'slider.increment':
    case 'slider.decrement':
      return; // handled by the focused Slider
    default:
      if (isEditorRoute(ui.route)) return;
      return;
  }
}

/** Move the active photo within the current source order. */
function advance(cat: ReturnType<typeof useCatalog.getState>, ids: string[], delta = 1) {
  const order = cat.order;
  const cur = ids[0] ?? cat.activeId();
  if (!cur) return;
  const i = order.indexOf(cur);
  const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
  if (next) cat.select(next);
}
