import { useMemo } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { IconButton, Badge } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl, SearchField } from '@/ui/Controls.tsx';
import { ROUTE_META, useUi, isEditorRoute, type RouteId } from '@/state/ui.ts';
import { useCatalog, useVisibleIds } from '@/state/catalog.ts';
import { useDevelop, useHistory } from '@/state/develop.ts';

/**
 * Top bar: where you are, what's selected, and the three global controls that
 * must always be reachable — search, undo/redo, activity.
 */
export function TopBar({ route }: { route: RouteId }) {
  const source = useCatalog((s) => s.source);
  const selection = useCatalog((s) => s.selection);
  const query = useCatalog((s) => s.query);
  const setQuery = useCatalog((s) => s.setQuery);
  const photos = useCatalog((s) => s.photos);
  const visible = useVisibleIds();
  const meta = ROUTE_META[route];
  const mac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  const mod = mac ? '⌘' : 'Ctrl';

  const activeId = selection[selection.length - 1] ?? null;
  const { entries, head } = useHistory(activeId);
  const undo = useDevelop((s) => s.undo);
  const redo = useDevelop((s) => s.redo);

  const editor = isEditorRoute(route);
  const photo = activeId ? photos[activeId] : undefined;

  const crumb = useMemo(() => {
    if (editor && photo) return [meta.label, photo.filename];
    if (source.kind === 'library') return [meta.label, 'All Photographs'];
    return [meta.label, source.label];
  }, [editor, meta.label, photo?.filename, source.kind, source.label]);

  return (
    <header className="glass-strong relative z-40 flex h-[46px] items-center gap-3 px-3">
      {/* left: route + source */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        >
          <SwIcon name={meta.icon as IconName} size={16} />
        </span>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate font-medium text-t1">{crumb[0]}</span>
          {crumb[1] && (
            <>
              <SwIcon name="chevronRight" size={12} className="shrink-0 text-t3" />
              <span className="numeric truncate text-t3">{crumb[1]}</span>
            </>
          )}
        </nav>
        <Badge tone="muted" className="ml-1 hidden sm:inline-flex">
          {visible.length} shown{selection.length > 1 ? ` · ${selection.length} selected` : ''}
        </Badge>
      </div>

      {/* centre: search */}
      <div className="mx-auto hidden w-full max-w-md md:block">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search library — filename, keyword, “sunset dog beach”"
          shortcut={`${mod}K`}
        />
      </div>

      {/* right: view + history + panels */}
      <div className="flex shrink-0 items-center gap-1">
        {!editor && (
          <ViewModeControl />
        )}

        {editor && <BeforeAfterControl />}

        <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}

        <Tooltip label="Undo" placement="bottom" shortcut={`${mod}Z`}>
          <span>
            <IconButton
              name="undo"
              label="Undo"
              disabled={head < 0}
              onClick={() => activeId && undo(activeId)}
            />
          </span>
        </Tooltip>
        <Tooltip label="Redo" placement="bottom" shortcut={`${mod}⇧Z`}>
          <span>
            <IconButton
              name="redo"
              label="Redo"
              disabled={head >= entries.length - 1}
              onClick={() => activeId && redo(activeId)}
            />
          </span>
        </Tooltip>

        <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}

        <Tooltip label="Command palette" placement="bottom" shortcut={`${mod}K`}>
          <span>
            <IconButton name="search" label="Command palette" onClick={() => useUi.getState().setPalette(true)} />
          </span>
        </Tooltip>
        <Tooltip label="Activity centre" placement="bottom">
          <span>
            <IconButton name="clock" label="Activity centre" onClick={() => useUi.getState().setActivity(true)} />
          </span>
        </Tooltip>
        <Tooltip label="Memory HUD" placement="bottom" shortcut={`${mod}⌥M`}>
          <span>
            <IconButton name="cpu" label="Memory HUD" onClick={() => useUi.getState().setMemoryHud(true)} />
          </span>
        </Tooltip>
        <Tooltip label={useUi.getState().leftOpen ? 'Hide side panel' : 'Show side panel'} placement="bottom">
          <span>
            <IconButton name="menu" label="Toggle side panel" onClick={() => useUi.getState().toggleLeft()} />
          </span>
        </Tooltip>
      </div>
    </header>
  );
}

function ViewModeControl() {
  return (
    <SegmentedControl
      ariaLabel="View mode"
      size="sm"
      value="grid"
      onChange={() => undefined}
      segments={[
        { value: 'grid', icon: 'grid', title: 'Grid (G)' },
        { value: 'strip', icon: 'photos', title: 'Filmstrip' },
        { value: 'loupe', icon: 'loupe', title: 'Loupe (E)' },
      ]}
    />
  );
}

function BeforeAfterControl() {
  const mode = useUi((s) => s.beforeAfter.mode);
  const patch = useUi((s) => s.patchBeforeAfter);
  return (
    <SegmentedControl
      ariaLabel="Before / after"
      size="sm"
      value={mode === 'off' ? 'off' : mode === 'split' ? 'split' : mode === 'toggle' ? 'toggle' : 'split'}
      onChange={(v) => patch({ mode: v === 'off' ? 'off' : v === 'toggle' ? 'toggle' : 'split' })}
      segments={[
        { value: 'off', label: 'After', title: 'Show edited (\\)' },
        { value: 'split', icon: 'split', title: 'Split before/after' },
        { value: 'toggle', icon: 'contrast', title: 'Toggle before (/)' },
      ]}
    />
  );
}
