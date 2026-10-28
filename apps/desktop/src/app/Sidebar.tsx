import { useMemo, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { Badge, Chip } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { SearchField } from '@/ui/Controls.tsx';
import { ROUTE_META, ROUTES, useUi, type RouteId } from '@/state/ui.ts';
import { useCatalog, type SelectionSource, type SourceKind } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { PRESET_GROUPS } from '@/lib/builtinPresets.ts';
import { formatChord, SWELL_SHORTCUTS } from '@swell/schema';
import { isMac } from '@swell/shared';

/* -------------------------------------------------------------------------- */
/*  Module rail — the 10 pages of §4, always one click away                    */
/* -------------------------------------------------------------------------- */

const GROUPS: { label: string; routes: RouteId[] }[] = [
  { label: 'Ingest', routes: ['home'] },
  { label: 'Organise', routes: ['library', 'cull'] },
  { label: 'Edit', routes: ['develop', 'curves', 'layers', 'retouch'] },
  { label: 'Discover', routes: ['smart', 'presets'] },
  { label: 'Output', routes: ['export'] },
];

export function Rail() {
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const mac = isMac();

  return (
    <nav
      aria-label="Modules"
      className="relative z-30 flex h-full w-14 shrink-0 flex-col items-center gap-1 bg-s0 py-2"
    >
      <button
        type="button"
        onClick={() => go('home')}
        aria-label="Swell home"
        className="mb-1 grid size-9 place-items-center rounded-[var(--radius-md)] bg-s2 text-[var(--color-accent)] shadow-[var(--e1)] transition-transform duration-[140ms] hover:scale-105 active:scale-95"
      >
        <SwellMark />
      </button>

      {GROUPS.map((g, gi) => (
        <div key={g.label} className="flex w-full flex-col items-center gap-1">
          {gi > 0 && <span aria-hidden className="my-1 h-3 w-5 rounded-full bg-s2/70" />}
          {g.routes.map((r) => {
            const meta = ROUTE_META[r];
            const active = route === r;
            return (
              <Tooltip
                key={r}
                placement="right"
                shortcut={SWELL_SHORTCUTS[`page${meta.num}` as keyof typeof SWELL_SHORTCUTS] ? formatChord(SWELL_SHORTCUTS[`page${meta.num}` as keyof typeof SWELL_SHORTCUTS] as string, mac) : undefined}
                label={
                  <span>
                    <b className="font-medium">{meta.num}. {meta.label}</b>
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={() => go(r)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={`${meta.num}. ${meta.label}`}
                  className={cx(
                    'group relative grid size-10 place-items-center rounded-[var(--radius-md)] transition-all duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                    active ? 'bg-s3 text-t1 shadow-[var(--e1)]' : 'text-t3 hover:bg-s2 hover:text-t2',
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute -left-2 h-5 w-1 rounded-r-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]"
                    />
                  )}
                  <SwIcon name={meta.icon as IconName} size={20} />
                  <span
                    className={cx(
                      'absolute right-1 bottom-0.5 text-[8px] leading-none tabular-nums transition-colors',
                      active ? 'text-[var(--color-accent)]' : 'text-t3/60',
                    )}
                  >
                    {meta.num}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton icon="puzzle" label="Models" onClick={() => useUi.getState().setModels(true)} />
        <RailButton icon="settings" label="Settings" onClick={() => go('export')} shortcut="⌘," />
      </div>
    </nav>
  );
}

function RailButton({
  icon,
  label,
  onClick,
  shortcut,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <Tooltip label={label} placement="right" shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="grid size-10 place-items-center rounded-[var(--radius-md)] text-t3 transition-colors hover:bg-s2 hover:text-t2"
      >
        <SwIcon name={icon} size={20} />
      </button>
    </Tooltip>
  );
}

/** The Swell mark: three stacked waves, drawn as tonal shapes (no strokes). */
export function SwellMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 15.4c2.2 0 2.9-2.1 5-2.1s2.8 2.1 5 2.1 2.9-2.1 5-2.1 2.7 2.1 4 2.1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M4.6 10.6c1.7 0 2.3-1.6 3.9-1.6s2.2 1.6 3.9 1.6 2.2-1.6 3.9-1.6 2 1.6 3.1 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M7 6.4c1.2 0 1.6-1.1 2.7-1.1s1.5 1.1 2.7 1.1 1.5-1.1 2.4-1.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Contextual side panel — content depends on the route                       */
/* -------------------------------------------------------------------------- */

export function SidePanel({ route }: { route: RouteId }) {
  return (
    <aside
      aria-label="Contextual panel"
      className="relative z-20 flex h-full min-h-0 w-full flex-col overflow-hidden bg-s1"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-2">
        {route === 'home' && <HomePanel />}
        {(route === 'library' || route === 'cull') && <LibraryPanel />}
        {(route === 'develop' || route === 'curves' || route === 'layers' || route === 'retouch') && <EditorPanel route={route} />}
        {route === 'smart' && <SmartPanel />}
        {route === 'presets' && <PresetsPanel />}
        {route === 'export' && <OutputPanel />}
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- Home panel */

function HomePanel() {
  const photos = useCatalog((s) => s.photos);
  const order = useCatalog((s) => s.order);
  const go = useUi((s) => s.go);
  const recent = order.slice(0, 5);
  const edited = order.filter((id) => photos[id]?.hasEdits).length;

  return (
    <div className="flex flex-col gap-2">
      <Section title="Catalog" icon="database" dense>
        <PanelRow label="Photos" value={String(order.length)} />
        <PanelRow label="With edits" value={String(edited)} />
        <PanelRow label="Storage" value="Local — private" />
      </Section>
      <Section title="Jump to" icon="compass" dense>
        {(ROUTES as readonly RouteId[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => go(r)}
            className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-t2 transition-colors hover:bg-s2 hover:text-t1"
          >
            <SwIcon name={ROUTE_META[r].icon as IconName} size={15} className="text-t3" />
            <span className="truncate">{ROUTE_META[r].label}</span>
            <span className="numeric ml-auto text-2xs text-t3">{ROUTE_META[r].num}</span>
          </button>
        ))}
      </Section>
      <Section title="Recently added" icon="clock" dense defaultOpen={false}>
        {recent.map((id) => (
          <PanelRow key={id} label={photos[id]?.filename ?? id} value="" />
        ))}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- Library panel */

export function LibraryPanel() {
  const collections = useCatalog((s) => s.collections);
  const folders = useCatalog((s) => s.folders);
  const keywords = useCatalog((s) => s.keywords);
  const photos = useCatalog((s) => s.photos);
  const source = useCatalog((s) => s.source);
  const setSource = useCatalog((s) => s.setSource);
  const addFacet = useCatalog((s) => s.addFacet);
  const [kwQuery, setKwQuery] = useState('');

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const p of Object.values(photos)) byFolder.set(p.folderId, (byFolder.get(p.folderId) ?? 0) + 1);
    return byFolder;
  }, [photos]);

  const kwFiltered = kwQuery
    ? keywords.filter((k) => k.name.toLowerCase().includes(kwQuery.toLowerCase()))
    : keywords.filter((k) => !k.parentId || ['people', 'nature', 'animals', 'work', 'place', 'light', 'technique', 'projects'].includes(k.id.replace('kw-', '')));

  const isSel = (s: { kind: SourceKind; id?: string }) => s.kind === source.kind && s.id === source.id;

  return (
    <div className="flex flex-col gap-2">
      <Section title="Catalog" icon="database" dense>
        <SourceRow
          active={isSel({ kind: 'library' })}
          icon="photos"
          label="All Photographs"
          count={Object.keys(photos).length}
          onClick={() => setSource({ kind: 'library', label: 'All Photographs' })}
        />
        <SourceRow
          active={isSel({ kind: 'recent' })}
          icon="clock"
          label="Recent Import"
          count={Object.values(photos).filter((p) => p.importId === 'imp-latest').length}
          onClick={() => setSource({ kind: 'recent', label: 'Recent Import' })}
        />
        <SourceRow
          active={isSel({ kind: 'flagged' })}
          icon="flag"
          label="Flagged"
          count={Object.values(photos).filter((p) => p.flag !== 'none').length}
          onClick={() => setSource({ kind: 'flagged', label: 'Flagged' })}
        />
        <SourceRow
          active={isSel({ kind: 'quick', id: 'col-quick' })}
          icon="bookmark"
          label="Quick Collection"
          count={collections.find((c) => c.id === 'col-quick')?.photoIds.length ?? 0}
          onClick={() => setSource({ kind: 'quick', id: 'col-quick', label: 'Quick Collection' })}
          hint="B"
        />
      </Section>

      <Section title="Collections" icon="stack" dense right={<SwIcon name="plus" size={14} />}>
        {collections
          .filter((c) => c.id !== 'col-quick')
          .map((c) => (
            <SourceRow
              key={c.id}
              active={isSel({ kind: 'collection', id: c.id })}
              icon={c.kind === 'smart' ? 'magic' : c.kind === 'set' ? 'folder' : 'bookmark'}
              label={c.name}
              count={c.kind === 'smart' ? undefined : c.photoIds.length}
              onClick={() => setSource({ kind: 'collection', id: c.id, label: c.name })}
            />
          ))}
      </Section>

      <Section title="Folders" icon="folder" dense defaultOpen={false}>
        {folders.map((f) => (
          <SourceRow
            key={f.id}
            active={isSel({ kind: 'folder', id: f.id })}
            icon="folder"
            label={f.name}
            count={counts.get(f.id) ?? 0}
            onClick={() => setSource({ kind: 'folder', id: f.id, label: f.name })}
          />
        ))}
      </Section>

      <Section title="Keywords" icon="label" dense defaultOpen={false}>
        <SearchField value={kwQuery} onChange={setKwQuery} placeholder="Filter keywords" shortcut="" className="mb-1 px-1" />
        <div className="flex flex-wrap gap-1 px-1">
          {kwFiltered.slice(0, 40).map((k) => (
            <Chip key={k.id} onClick={() => addFacet({ field: 'keyword', value: k.name })}>
              {k.name}
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}

function SourceRow({
  active,
  icon,
  label,
  count,
  onClick,
  hint,
}: {
  active?: boolean;
  icon: IconName;
  label: string;
  count?: number;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'group flex h-7 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-xs transition-colors duration-[120ms]',
        active ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-t2 hover:bg-s2 hover:text-t1',
      )}
    >
      <SwIcon name={icon} size={15} className={cx('shrink-0', active ? 'opacity-100' : 'opacity-60')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-2xs text-t3">{hint}</span>}
      {count !== undefined && <span className="numeric shrink-0 text-2xs text-t3">{count}</span>}
    </button>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-1">
      <span className="truncate text-2xs text-t3">{label}</span>
      <span className="numeric shrink-0 text-xs text-t2">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- Editor panel */

function EditorPanel({ route }: { route: RouteId }) {
  const params = useCatalog((s) => s.photos);
  const presets = useDevelop((s) => s.presets);
  const snapshots = useDevelop((s) => s.snapshots);
  const versions = useDevelop((s) => s.versions);
  const activeId = useCatalog((s) => s.activeId());
  const applyPreset = useDevelop((s) => s.applyPreset);
  const applySnapshot = useDevelop((s) => s.applySnapshot);
  const applyVersion = useDevelop((s) => s.applyVersion);
  const go = useUi((s) => s.go);

  const photo = activeId ? params[activeId] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <NavigatorMini />

      <Section title="Edit" icon="develop" dense>
        {(ROUTES as readonly RouteId[])
          .filter((r) => ['develop', 'curves', 'layers', 'retouch'].includes(r))
          .map((r) => (
            <SourceRow
              key={r}
              active={route === r}
              icon={ROUTE_META[r].icon as IconName}
              label={ROUTE_META[r].label}
              onClick={() => go(r)}
              hint={String(ROUTE_META[r].num)}
            />
          ))}
      </Section>

      <Section title="Presets" icon="bookmark" dense defaultOpen={false}>
        {PRESET_GROUPS.map((g) => {
          const list = presets.filter((p) => p.group === g.id);
          if (!list.length) return null;
          return (
            <div key={g.id} className="mb-1">
              <div className="px-2 py-0.5 text-[10px] tracking-wide text-t3 uppercase">{g.label}</div>
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!activeId}
                  onClick={() => activeId && applyPreset([activeId], p.id, 100)}
                  className="flex h-6 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left text-2xs text-t2 transition-colors hover:bg-s2 hover:text-t1 disabled:opacity-40"
                >
                  <span className="truncate">{p.name}</span>
                  {p.favorite && <SwIcon name="starSolid" size={11} className="ml-auto text-[var(--color-warn)]" />}
                </button>
              ))}
            </div>
          );
        })}
      </Section>

      <Section title="Snapshots" icon="camera" dense defaultOpen={false}>
        {snapshots.filter((s) => !photo || s.photoId === photo.id).length === 0 && (
          <p className="px-2 py-1 text-2xs text-t3">No snapshots yet — create one from the History panel.</p>
        )}
        {snapshots
          .filter((s) => !photo || s.photoId === photo.id)
          .map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => activeId && applySnapshot(activeId, s.id)}
              className="flex h-6 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
            >
              <SwIcon name="camera" size={12} className="opacity-60" />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
      </Section>

      <Section title="Versions" icon="copy" dense defaultOpen={false}>
        {versions.filter((v) => !photo || v.photoId === photo.id).length === 0 && (
          <p className="px-2 py-1 text-2xs text-t3">Versions are named states you can diff and switch between.</p>
        )}
        {versions
          .filter((v) => !photo || v.photoId === photo.id)
          .map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => activeId && applyVersion(activeId, v.id)}
              className="flex h-6 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
            >
              <SwIcon name="copy" size={12} className="opacity-60" />
              <span className="truncate">{v.name}</span>
            </button>
          ))}
      </Section>
    </div>
  );
}

/** Tiny navigator: the whole frame with the current view rect as a tonal shape. */
export function NavigatorMini() {
  const view = useUi((s) => s.view);
  const photos = useCatalog((s) => s.photos);
  const activeId = useCatalog((s) => s.activeId());
  const photo = activeId ? photos[activeId] : undefined;
  const setView = useUi((s) => s.setView);

  const w = 100;
  const aspect = photo ? photo.width / photo.height : 1.5;
  const h = w / aspect;
  const vw = Math.min(1, 1 / view.zoom) * w;
  const vh = Math.min(1, 1 / view.zoom) * h;

  return (
    <div className="px-1 pb-1">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] tracking-wide text-t3 uppercase">Navigator</span>
        <span className="numeric text-2xs text-t3">{Math.round(view.zoom * 100)}%</span>
      </div>
      <div
        className="relative mx-auto overflow-hidden rounded-[var(--radius-sm)] bg-s2 shadow-[var(--e-inset)]"
        style={{ width: w, height: h }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          setView({ panX: x - 0.5, panY: y - 0.5, mode: 'custom' });
        }}
      >
        {photo && <img src={photo.src} alt="" className="absolute inset-0 size-full object-cover opacity-80" draggable={false} />}
        <span
          className="absolute rounded-[3px] bg-[var(--color-accent-soft)] shadow-[0_0_0_1.5px_var(--color-accent)]"
          style={{
            width: vw,
            height: vh,
            left: Math.max(0, Math.min(w - vw, (view.panX + 0.5) * w - vw / 2 + w / 2 - w / 2)),
            top: Math.max(0, Math.min(h - vh, (view.panY + 0.5) * h - vh / 2 + h / 2 - h / 2)),
          }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Smart panel */

function SmartPanel() {
  const features = useCatalog((s) => s.features);
  const detections = useCatalog((s) => s.detections);
  const addFacet = useCatalog((s) => s.addFacet);
  const query = useCatalog((s) => s.query);
  const setQuery = useCatalog((s) => s.setQuery);

  const concepts = useMemo(() => {
    const tally = new Map<string, { count: number; score: number }>();
    for (const list of Object.values(detections)) {
      for (const d of list) {
        const cur = tally.get(d.label) ?? { count: 0, score: 0 };
        cur.count++;
        cur.score = Math.max(cur.score, d.score);
        tally.set(d.label, cur);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 28);
  }, [detections]);

  const swatches = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of Object.values(features)) {
      for (const c of f.palette) {
        const key = `${Math.round(c.h / 20) * 20}|${c.css}`;
        map.set(c.css, (map.get(c.css) ?? 0) + c.weight);
      }
      void map;
    }
    const seen = new Set<string>();
    const out: { css: string; weight: number }[] = [];
    for (const f of Object.values(features)) {
      for (const c of f.palette) {
        if (seen.has(c.css)) continue;
        seen.add(c.css);
        out.push({ css: c.css, weight: c.weight });
      }
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, 14);
  }, [features]);

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 pb-1">
        <SearchField value={query} onChange={setQuery} placeholder="Try “dog on beach at sunset”" shortcut="" />
      </div>

      <Section title="Detected" icon="smart" dense>
        <div className="flex flex-wrap gap-1 px-1">
          {concepts.map(([label, v]) => (
            <Chip key={label} icon="spark" onClick={() => addFacet({ field: 'detected', value: label })}>
              {label} <span className="numeric ml-1 opacity-60">{v.count}</span>
            </Chip>
          ))}
          {!concepts.length && <p className="px-1 py-1 text-2xs text-t3">Indexing…</p>}
        </div>
      </Section>

      <Section title="Palette search" icon="palette" dense defaultOpen={false}>
        <div className="grid grid-cols-7 gap-1 px-1">
          {swatches.map((s) => (
            <button
              key={s.css}
              type="button"
              aria-label={`Search by colour ${s.css}`}
              onClick={() => addFacet({ field: 'detected', value: `color:${s.css}` })}
              className="aspect-square rounded-[6px] shadow-[var(--e-inset)] transition-transform hover:scale-110"
              style={{ background: s.css }}
            />
          ))}
        </div>
      </Section>

      <Section title="Indexed" icon="database" dense defaultOpen={false}>
        <PanelRow label="Photos analysed" value={`${Object.keys(features).length}`} />
        <PanelRow label="Detections" value={`${Object.values(detections).reduce((a, b) => a + b.length, 0)}`} />
        <Badge tone="muted" className="mx-1 mt-1">On-device · no uploads</Badge>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------- Presets panel */

function PresetsPanel() {
  const presets = useDevelop((s) => s.presets);
  const profiles = useDevelop((s) => s.profiles);
  const [group, setGroup] = useState<string>('all');
  const shown = group === 'all' ? presets : presets.filter((p) => p.group === group);

  return (
    <div className="flex flex-col gap-2">
      <Section title="Groups" icon="bookmark" dense>
        <div className="flex flex-wrap gap-1 px-1">
          <Chip active={group === 'all'} onClick={() => setGroup('all')}>All</Chip>
          {PRESET_GROUPS.map((g) => (
            <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </Chip>
          ))}
        </div>
      </Section>
      <Section title={`Presets (${shown.length})`} icon="bookmark" dense>
        {shown.map((p) => (
          <div key={p.id} className="flex h-7 items-center gap-2 rounded-[var(--radius-xs)] px-2 text-2xs text-t2 hover:bg-s2">
            <SwIcon name="bookmark" size={12} className="opacity-60" />
            <span className="truncate">{p.name}</span>
            {p.favorite && <SwIcon name="starSolid" size={11} className="ml-auto text-[var(--color-warn)]" />}
          </div>
        ))}
      </Section>
      <Section title={`Profiles (${profiles.length})`} icon="palette" dense defaultOpen={false}>
        {profiles.map((p) => (
          <div key={p.id} className="flex h-7 items-center gap-2 rounded-[var(--radius-xs)] px-2 text-2xs text-t2 hover:bg-s2">
            <SwIcon name="colourWheel" size={12} className="opacity-60" />
            <span className="truncate">{p.name}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- Output panel */

function OutputPanel() {
  const go = useUi((s) => s.go);
  return (
    <div className="flex flex-col gap-2">
      <Section title="Output" icon="export" dense>
        <SourceRow icon="export" label="Export" onClick={() => go('export')} />
        <SourceRow icon="printer" label="Print" onClick={() => go('export')} />
        <SourceRow icon="settings" label="Settings" onClick={() => go('export')} />
      </Section>
      <Section title="Queue" icon="clock" dense>
        <p className="px-2 py-1 text-2xs text-t3">The export queue is empty.</p>
      </Section>
    </div>
  );
}
