/**
 * ShortcutsDialog — the printable cheat sheet (§10).
 *
 * Reads the *live* bindings, so a rebind in Settings shows up here immediately,
 * and it can flip between the Swell and Lightroom-style presets.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, Keycap } from '@/ui/Button.tsx';
import { Modal, ModalHeader } from '@/ui/Overlay.tsx';
import { SearchField, SegmentedControl } from '@/ui/Controls.tsx';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import { chordLabel, isMac } from '@swell/shared';
import type { ShortcutAction } from '@swell/schema';

const GROUPS: { id: string; label: string; prefix: string }[] = [
  { id: 'view', label: 'Views & navigation', prefix: 'view.' },
  { id: 'panels', label: 'Panels & window', prefix: 'panels.' },
  { id: 'window', label: '', prefix: 'window.' },
  { id: 'rate', label: 'Ratings, flags & labels', prefix: 'rate.' },
  { id: 'flag', label: '', prefix: 'flag.' },
  { id: 'label', label: '', prefix: 'label.' },
  { id: 'tool', label: 'Tools', prefix: 'tool.' },
  { id: 'edit', label: 'Editing', prefix: 'edit.' },
  { id: 'library', label: 'Library & collections', prefix: 'library.' },
  { id: 'cull', label: '', prefix: 'cull.' },
  { id: 'export', label: 'Export', prefix: 'export.' },
  { id: 'global', label: 'Global', prefix: 'global.' },
  { id: 'dev', label: '', prefix: 'dev.' },
  { id: 'slider', label: 'Sliders', prefix: 'slider.' },
];

const TITLES: Partial<Record<ShortcutAction, string>> = {
  'view.grid': 'Library grid',
  'view.loupe': 'Loupe (single photo)',
  'view.survey': 'Survey',
  'view.compare': 'Compare',
  'view.develop': 'Develop',
  'view.curves': 'Light & Curves',
  'view.layers': 'Layers & Masking',
  'view.retouch': 'Remove & Retouch',
  'view.smart': 'Smart Detect & Search',
  'view.presets': 'Presets & History',
  'view.export': 'Export & Print',
  'view.home': 'Home & Import',
  'panels.toggleAll': 'Hide/show all panels',
  'panels.toggleSides': 'Hide/show side panels',
  'window.fullscreen': 'Fullscreen',
  'window.lightsOut': 'Lights out',
  'view.zoomToggle': 'Toggle zoom',
  'view.infoOverlay': 'Photo info overlay (hold)',
  'view.beforeAfterHold': 'Before/after (hold)',
  'view.beforeAfter': 'Cycle before/after mode',
  'view.clipping': 'Cycle clipping warning',
  'rate.0': 'No rating',
  'rate.1': '1 star',
  'rate.2': '2 stars',
  'rate.3': '3 stars',
  'rate.4': '4 stars',
  'rate.5': '5 stars',
  'flag.pick': 'Pick',
  'flag.reject': 'Reject',
  'flag.none': 'Unflag',
  'label.red': 'Red label',
  'label.yellow': 'Yellow label',
  'label.green': 'Green label',
  'label.blue': 'Blue label',
  'tool.crop': 'Crop & straighten',
  'tool.spot': 'Heal / spot removal',
  'tool.mask': 'Masking brush',
  'tool.tat': 'Targeted adjustment',
  'tool.overlay': 'Toggle mask overlay',
  'tool.wbDropper': 'White balance dropper',
  'tool.spotVisualize': 'Spot visualisation',
  'tool.zoom': 'Zoom tool',
  'tool.hand': 'Hand / pan',
  'tool.softProof': 'Soft proofing',
  'tool.removeBg': 'Remove background',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'edit.copySettings': 'Copy settings',
  'edit.pasteSettings': 'Paste settings',
  'edit.copySettingsDialog': 'Create preset from settings',
  'edit.syncSettings': 'Sync settings to selection',
  'edit.virtualCopy': 'Virtual copy',
  'edit.resetParams': 'Reset all settings',
  'edit.autoTone': 'Auto tone',
  'library.quickCollection': 'Toggle quick collection',
  'library.stack': 'Stack selection',
  'library.filter': 'Filter / find',
  'library.delete': 'Remove from catalog',
  'library.next': 'Next photo',
  'library.prev': 'Previous photo',
  'cull.autoAdvance': 'Toggle auto-advance (cull)',
  'export.dialog': 'Export dialog',
  'export.previous': 'Export with previous preset',
  'global.palette': 'Command palette',
  'global.settings': 'Settings',
  'dev.memoryHud': 'Memory HUD',
  'slider.increment': 'Increase value',
  'slider.decrement': 'Decrease value',
};

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcuts);
  const shortcuts = useSettings((s) => s.shortcuts);
  const preset = useSettings((s) => s.settings.general.shortcutPreset);
  const setPreset = useSettings((s) => s.setShortcutPreset);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { id: string; label: string; rows: [string, string][] }[] = [];
    let current: { id: string; label: string; rows: [string, string][] } | null = null;
    for (const g of GROUPS) {
      const rows = (Object.entries(shortcuts) as [string, string][])
        .filter(([action]) => action.startsWith(g.prefix))
        .filter(([action, combo]) => !q || (TITLES[action as ShortcutAction] ?? action).toLowerCase().includes(q) || combo.includes(q) || action.includes(q))
        .map(([action, combo]) => [TITLES[action as ShortcutAction] ?? action, combo] as [string, string]);
      if (!rows.length) continue;
      if (!g.label && current) current.rows.push(...rows);
      else {
        current = { id: g.id, label: g.label, rows };
        out.push(current);
      }
    }
    return out;
  }, [shortcuts, query]);

  return (
    <AnimatePresence>
      {open && (
        <Modal open={open} onClose={() => setOpen(false)} label="Keyboard shortcuts" size="lg">
          <ModalHeader
            title="Keyboard shortcuts"
            subtitle={`${Object.keys(shortcuts).length} bindings · ${isMac() ? 'macOS' : 'Windows/Linux'} glyphs`}
            icon="keyboard"
            onClose={() => setOpen(false)}
          />
          <div className="flex items-center gap-2 px-4 pb-2">
            <SearchField value={query} onChange={setQuery} placeholder="Search shortcuts…" shortcut="" className="w-64" />
            <SegmentedControl
              size="sm"
              ariaLabel="Shortcut preset"
              value={preset}
              onChange={(v) => setPreset(v as 'swell' | 'lrc')}
              segments={[
                { value: 'swell', label: 'Swell' },
                { value: 'lrc', label: 'Lightroom-style' },
              ]}
            />
            <Badge tone="muted" className="ml-auto">Rebind in Settings → Keyboard</Badge>
          </div>
          <motion.div layout className="max-h-[62vh] overflow-y-auto px-4 pb-4 no-scrollbar">
            {groups.map((g) => (
              <section key={g.id} className="mb-3">
                <h3 className="mb-1 text-2xs font-medium tracking-[0.08em] text-t3 uppercase">{g.label}</h3>
                <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {g.rows.map(([label, combo]) => (
                    <div key={label} className="flex h-7 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-2xs text-t2">{label}</span>
                      <span className="flex shrink-0 gap-0.5">
                        {combo.split('+').map((k) => (
                          <Keycap key={k}>{chordLabel(k)}</Keycap>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!groups.length && (
              <div className="grid place-items-center py-10 text-t3">
                <SwIcon name="search" size={22} />
                <p className="mt-2 text-xs">No shortcut matches “{query}”.</p>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Chip icon="keyboard" onClick={() => setQuery('')}>Show all</Chip>
              <Chip icon="print" onClick={() => window.print()}>Print this sheet</Chip>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </motion.div>
        </Modal>
      )}
    </AnimatePresence>
  );
}

export default ShortcutsDialog;
