import { useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { IconButton, Button, Badge } from '@/ui/Button.tsx';
import { Menu } from '@/ui/Overlay.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi, type RouteId } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import { LightPanel, ColorPanel, DetailPanel, EffectsPanel } from './panels/AdjustPanels.tsx';
import { LensPanel, GeometryPanel, HistoryPanel, MetaPanel } from './panels/CameraPanels.tsx';
import { LayersPanel, RetouchPanel } from './panels/LocalPanels.tsx';
import { CurvesPanel } from './panels/CurvesPanel.tsx';

/**
 * The inspector column on editor routes (§4). One tab strip, a scrollable body,
 * and a photo summary header with the destructive-but-undoable actions.
 */

type PanelId =
  | 'light'
  | 'color'
  | 'detail'
  | 'effects'
  | 'lens'
  | 'geometry'
  | 'curves'
  | 'layers'
  | 'retouch'
  | 'history'
  | 'meta';

const PANELS: Record<PanelId, { label: string; icon: IconName; render: () => React.ReactNode }> = {
  light: { label: 'Light', icon: 'sun', render: () => <LightPanel /> },
  color: { label: 'Colour', icon: 'colourWheel', render: () => <ColorPanel /> },
  detail: { label: 'Detail', icon: 'aperture', render: () => <DetailPanel /> },
  effects: { label: 'Effects', icon: 'grain', render: () => <EffectsPanel /> },
  lens: { label: 'Lens', icon: 'lens', render: () => <LensPanel /> },
  geometry: { label: 'Geometry', icon: 'crop', render: () => <GeometryPanel /> },
  curves: { label: 'Curves', icon: 'curve', render: () => <CurvesPanel /> },
  layers: { label: 'Layers & masks', icon: 'layers', render: () => <LayersPanel /> },
  retouch: { label: 'Retouch', icon: 'heal', render: () => <RetouchPanel /> },
  history: { label: 'History', icon: 'history', render: () => <HistoryPanel /> },
  meta: { label: 'Metadata', icon: 'page', render: () => <MetaPanel /> },
};

const TABS: Record<string, PanelId[]> = {
  develop: ['light', 'color', 'detail', 'effects', 'lens', 'geometry', 'history', 'meta'],
  curves: ['curves', 'light', 'color', 'history', 'meta'],
  layers: ['layers', 'light', 'color', 'history', 'meta'],
  retouch: ['retouch', 'layers', 'light', 'history', 'meta'],
};

export function InspectorColumn() {
  const route = useUi((s) => s.route);
  const tabs = TABS[route] ?? TABS.develop!;
  const [panel, setPanel] = useState<PanelId>(tabs[0]!);
  const photoId = useCatalog((s) => s.activeId());
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const selection = useCatalog((s) => s.selection);
  const edited = useDevelop((s) => (photoId ? !!s.params[photoId] : false));
  const reset = useDevelop((s) => s.resetAll);
  const copy = useDevelop((s) => s.copyParams);
  const paste = useDevelop((s) => s.pasteParams);
  const createSnapshot = useDevelop((s) => s.addSnapshot);
  const [width, setWidth] = useState(340);

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col bg-s1"
      style={{ width }}
      aria-label="Inspector"
    >
      <ResizeHandle side="left" onDelta={(d) => setWidth((w) => Math.min(560, Math.max(280, w - d)))} />

      {/* header */}
      <header className="flex h-9 shrink-0 items-center gap-1 px-2">
        <SwIcon name="sliders" size={15} className="shrink-0 text-t3" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-t1">
          {photo?.title || photo?.filename.replace(/\.[^.]+$/, '') || 'No photo'}
        </span>
        {edited && <Badge tone="accent">Edited</Badge>}
        <Menu
          placement="bottom-end"
          title="Develop"
          items={[
            { id: 'reset', label: 'Reset all settings', icon: 'restart', onSelect: () => photoId && (reset(photoId), toast.ok('Settings reset', 'One undo step away.')) },
            { id: 'copy', label: 'Copy settings', icon: 'copy', onSelect: () => photoId && (copy(photoId), toast.ok('Settings copied', 'Paste into any selection.')) },
            { id: 'paste', label: `Paste to ${selection.length || 1} photo(s)`, icon: 'paste', onSelect: () => photoId && paste(selection.length ? selection : [photoId], copy(photoId)) },
            { id: 'snap', label: 'Create snapshot', icon: 'camera', onSelect: () => photoId && createSnapshot(photoId, `Snapshot ${Date.now() % 1000}`) },
            { id: 'sep', label: '', separator: true },
            { id: 'prev', label: 'Previous conversion', icon: 'history', onSelect: () => useUi.getState().go('presets') },
            { id: 'export', label: 'Export…', icon: 'export', onSelect: () => useUi.getState().go('export') },
          ]}
          trigger={({ ref, toggle }) => (
            <span ref={ref}>
              <IconButton name="menu" size={14} box="sm" label="Develop menu" onClick={toggle} />
            </span>
          )}
        />
      </header>

      {/* tabs */}
      <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-1 pb-1 no-scrollbar" aria-label="Inspector sections">
        {tabs.map((id) => {
          const p = PANELS[id];
          const active = id === panel;
          return (
            <Tooltip key={id} label={p.label} placement="bottom">
              <button
                type="button"
                onClick={() => setPanel(id)}
                aria-current={active}
                className={cx(
                  'relative grid h-8 shrink-0 place-items-center rounded-[var(--radius-sm)] px-2.5 transition-colors duration-[120ms]',
                  active ? 'bg-s4 text-t1 shadow-[var(--e1)]' : 'text-t3 hover:bg-s2 hover:text-t2',
                )}
              >
                <SwIcon name={p.icon} size={15} />
                <span className="sr-only">{p.label}</span>
                {active && (
                  <span aria-hidden className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-[var(--color-accent)]" />
                )}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        {PANELS[panel].render()}
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-1 bg-s1 px-2">
        <Button size="xs" variant="ghost" icon="copy" onClick={() => photoId && (copy(photoId), toast.ok('Settings copied'))}>
          Copy
        </Button>
        <Button size="xs" variant="ghost" icon="paste" onClick={() => photoId && paste(selection.length ? selection : [photoId], copy(photoId))}>
          Paste
        </Button>
        <Button size="xs" variant="ghost" icon="restart" className="ml-auto" onClick={() => photoId && reset(photoId)}>
          Reset
        </Button>
      </footer>
    </aside>
  );
}

/** Invisible drag strip that resizes a column — no divider line anywhere. */
export function ResizeHandle({ side, onDelta }: { side: 'left' | 'right'; onDelta: (dx: number) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize panel (${side})`}
      tabIndex={0}
      onPointerDown={(e) => {
        setDrag(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        onDelta(e.movementX);
      }}
      onPointerUp={() => setDrag(false)}
      className={cx(
        'absolute top-0 bottom-0 z-30 w-1.5 cursor-col-resize transition-colors',
        side === 'left' ? '-left-0.5' : '-right-0.5',
        drag ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-s3',
      )}
    />
  );
}
