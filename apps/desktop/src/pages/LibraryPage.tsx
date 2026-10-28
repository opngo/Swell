import { useMemo, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton } from '@/ui/Button.tsx';
import { Menu, Tooltip } from '@/ui/Overlay.tsx';
import { SegmentedControl, Select } from '@/ui/Controls.tsx';
import { PhotoGrid, COLOR_LABELS } from '@/components/PhotoGrid.tsx';
import { useCatalog, useVisibleIds } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import { emptyFilter, type MetadataFacet, type SortField } from '@swell/schema';

/**
 * Page 2 — Library (§4.2): the whole catalog, filtered and sorted, with batch
 * operations on the selection. The grid is virtualised so a 100 k photo catalog
 * scrolls at the same cost as a hundred.
 */
export function LibraryPage() {
  const ids = useVisibleIds();
  const filter = useCatalog((s) => s.filter);
  const sort = useCatalog((s) => s.sort);
  const patchFilter = useCatalog((s) => s.patchFilter);
  const setSort = useCatalog((s) => s.setSort);
  const setGridSize = useCatalog((s) => s.setGridSize);
  const gridSize = useCatalog((s) => s.gridSize);
  const collapseStacks = useCatalog((s) => s.collapseStacks);
  const setCollapseStacks = useCatalog((s) => s.setCollapseStacks);
  const showRejected = useCatalog((s) => s.showRejected);
  const setShowRejected = useCatalog((s) => s.setShowRejected);
  const selection = useCatalog((s) => s.selection);
  const photos = useCatalog((s) => s.photos);
  const keywords = useCatalog((s) => s.keywords);
  const rate = useCatalog((s) => s.rate);
  const flag = useCatalog((s) => s.flag);
  const label = useCatalog((s) => s.label);
  const addKeywords = useCatalog((s) => s.addKeywords);
  const stackWith = useCatalog((s) => s.stackWith);
  const toggleQuick = useCatalog((s) => s.toggleQuick);
  const go = useUi((s) => s.go);
  const [batchKeyword, setBatchKeyword] = useState('');

  const facets = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    const bump = (field: string, value: string) => {
      const m = counts.get(field) ?? new Map<string, number>();
      m.set(value, (m.get(value) ?? 0) + 1);
      counts.set(field, m);
    };
    for (const id of useCatalog.getState().order) {
      const p = photos[id];
      if (!p) continue;
      bump('camera', p.camera);
      bump('lens', p.lens);
      bump('iso', `ISO ${p.iso}`);
      bump('focal', `${p.focalMm}mm`);
      bump('date', p.captureTime.slice(0, 10));
      for (const d of useCatalog.getState().detections[id] ?? []) bump('detected', d.label);
    }
    return counts;
  }, [photos, ids.length]);

  const addFacet = (f: MetadataFacet) => patchFilter({ facets: [...filter.facets, f] });
  const hasFacet = (f: MetadataFacet) => filter.facets.some((x) => x.field === f.field && x.value === f.value);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 px-2">
        <SegmentedControl
          size="sm"
          ariaLabel="Attribute filter"
          value={filter.attribute?.editState ?? 'any'}
          onChange={(v) => patchFilter({ attribute: { ...filter.attribute, editState: v as 'any' | 'edited' | 'unedited' } })}
          segments={[
            { value: 'any', label: 'All' },
            { value: 'edited', label: 'Edited' },
            { value: 'unedited', label: 'Unedited' },
          ]}
        />
        <Select
          size="sm"
          ariaLabel="Minimum rating"
          className="w-28"
          value={String(filter.attribute?.minRating ?? 0)}
          options={[0, 1, 2, 3, 4, 5].map((r) => ({ value: String(r), label: r ? `${r}★ and up` : 'Any rating' }))}
          onChange={(v) => patchFilter({ attribute: { ...filter.attribute, minRating: Number(v) } })}
        />
        <Select
          size="sm"
          ariaLabel="Flag filter"
          className="w-28"
          value={(filter.attribute?.flags ?? []).join('+') || 'any'}
          options={[
            { value: 'any', label: 'Any flag' },
            { value: 'pick', label: 'Picks only' },
            { value: 'none', label: 'Unflagged' },
            { value: 'reject', label: 'Rejected' },
          ]}
          onChange={(v) => patchFilter({ attribute: { ...filter.attribute, flags: v === 'any' ? [] : [v as 'pick' | 'reject' | 'none'] } })}
        />
        <Select
          size="sm"
          ariaLabel="Sort"
          className="w-36"
          value={sort.field}
          options={[
            { value: 'captureTime', label: 'Capture time' },
            { value: 'addedTime', label: 'Import time' },
            { value: 'filename', label: 'Filename' },
            { value: 'rating', label: 'Rating' },
            { value: 'editedAt', label: 'Last edited' },
            { value: 'aspect', label: 'Aspect ratio' },
            { value: 'fileType', label: 'File type' },
          ]}
          onChange={(v) => setSort({ ...sort, field: v as SortField })}
        />
        <IconButton
          name={sort.direction === 'asc' ? 'chevronUp' : 'chevronDown'}
          size={14}
          box="sm"
          label={`Sort ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
          onClick={() => setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
        />

        <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}

        <Tooltip label="Stacks" placement="bottom">
          <span>
            <IconButton name="stack" size={14} box="sm" label="Collapse stacks" pressed={collapseStacks} onClick={() => setCollapseStacks(!collapseStacks)} />
          </span>
        </Tooltip>
        <Tooltip label="Rejected" placement="bottom">
          <span>
            <IconButton name="close" size={14} box="sm" label="Show rejected" pressed={showRejected} onClick={() => setShowRejected(!showRejected)} />
          </span>
        </Tooltip>
        {(filter.facets.length > 0 || filter.attribute?.minRating || (filter.attribute?.flags ?? []).length > 0 || filter.attribute?.editState !== 'any') && (
          <Button size="xs" variant="ghost" icon="close" onClick={() => patchFilter({ ...emptyFilter() })}>
            Clear filters
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="numeric text-2xs text-t3">
            {ids.length.toLocaleString()} photo{ids.length === 1 ? '' : 's'}
            {selection.length > 0 && ` · ${selection.length} selected`}
          </span>
          <input
            type="range"
            min={120}
            max={420}
            step={12}
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
            aria-label="Thumbnail size"
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-s3 accent-[var(--color-accent)]"
          />
        </div>
      </div>

      {/* facets */}
      <div className="flex shrink-0 items-start gap-3 overflow-x-auto px-2 pb-1.5 no-scrollbar">
        {(['camera', 'date', 'detected', 'iso'] as const).map((field) => {
          const entries = [...(facets.get(field)?.entries() ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 6);
          if (!entries.length) return null;
          return (
            <div key={field} className="flex shrink-0 items-center gap-1">
              <span className="text-2xs text-t3 capitalize">{field}</span>
              {entries.map(([value, n]) => {
                const f = { field, value } as MetadataFacet;
                return (
                  <Chip key={value} active={hasFacet(f)} onClick={() => (hasFacet(f) ? patchFilter({ facets: filter.facets.filter((x) => !(x.field === field && x.value === value)) }) : addFacet(f))}>
                    <span className="truncate">{value}</span>
                    <span className="numeric ml-1 text-t3">{n}</span>
                  </Chip>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* active facets */}
      {filter.facets.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pb-1.5">
          <SwIcon name="filter" size={13} className="text-t3" />
          {filter.facets.map((f) => (
            <Chip key={`${f.field}:${f.value}`} icon="close" active onClick={() => patchFilter({ facets: filter.facets.filter((x) => x !== f) })}>
              {f.field}: {f.value}
            </Chip>
          ))}
        </div>
      )}

      <PhotoGrid ids={ids} className="px-2 pb-3" emptyLabel="No photos match these filters." />

      {/* batch bar */}
      {selection.length > 0 && (
        <div className="flex h-11 shrink-0 items-center gap-1 bg-s1 px-2 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.8)]">
          <Badge tone="accent">{selection.length} selected</Badge>
          <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <IconButton key={r} name={r ? 'star' : 'starOff'} size={13} box="sm" label={r ? `Rate ${r}` : 'Clear rating'} onClick={() => rate(selection, r)} />
          ))}
          <IconButton name="flag" size={13} box="sm" label="Pick" onClick={() => flag(selection, 'pick')} />
          <IconButton name="close" size={13} box="sm" label="Reject" onClick={() => flag(selection, 'reject')} />
          <Menu
            placement="top-start"
            title="Colour label"
            items={(Object.keys(COLOR_LABELS) as (keyof typeof COLOR_LABELS)[]).map((k) => ({
              id: k,
              label: COLOR_LABELS[k].label,
              onSelect: () => label(selection, k),
            }))}
            trigger={({ ref, toggle }) => (
              <span ref={ref}>
                <IconButton name="label" size={13} box="sm" label="Colour label" onClick={toggle} />
              </span>
            )}
          />
          <Menu
            placement="top-start"
            title="Add keyword"
            items={keywords.slice(0, 16).map((k) => ({ id: k.id, label: k.name, icon: 'label' as const, onSelect: () => addKeywords(selection, [k.id]) }))}
            trigger={({ ref, toggle }) => (
              <span ref={ref}>
                <IconButton name="label" size={13} box="sm" label="Add keyword" onClick={toggle} />
              </span>
            )}
          />
          <input
            value={batchKeyword}
            onChange={(e) => setBatchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && batchKeyword.trim()) {
                const id = useCatalog.getState().createKeyword(batchKeyword.trim());
                addKeywords(selection, [id]);
                toast.ok('Keyword added', `"${batchKeyword.trim()}" → ${selection.length} photos.`);
                setBatchKeyword('');
              }
            }}
            placeholder="New keyword…"
            className="h-6 w-32 rounded-[var(--radius-sm)] bg-s2 px-2 text-2xs text-t1 focus:bg-s3 focus:outline-none"
          />
          <span className="mx-0.5 h-5 w-1 shrink-0" aria-hidden /> {/* spacing, not a divider */}
          <Button size="xs" variant="subtle" icon="stack" onClick={() => stackWith(selection, `stack-${Date.now()}`)}>
            Stack
          </Button>
          <Button size="xs" variant="subtle" icon="plus" onClick={() => toggleQuick(selection)}>
            Quick collection (B)
          </Button>
          <Button size="xs" variant="subtle" icon="develop" onClick={() => go('develop')}>
            Develop
          </Button>
          <Button size="xs" variant="ghost" icon="paste" className="ml-auto" onClick={() => {
            const src = useDevelop.getState().copyParams(selection[0]!);
            useDevelop.getState().pasteParams(selection, src);
            toast.ok('Settings synced', `Applied to ${selection.length} photos.`);
          }}>
            Sync settings
          </Button>
        </div>
      )}
    </div>
  );
}

export default LibraryPage;
