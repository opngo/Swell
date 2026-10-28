import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Spinner } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { Menu, Modal, ModalHeader, Tooltip } from '@/ui/Overlay.tsx';
import { SearchField, Select, Switch } from '@/ui/Controls.tsx';
import { Slider } from '@/ui/Slider.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { EngineClient } from '@/engine-client/EngineClient.ts';
import { applyPresetParams, makeRenderRequest } from '@/lib/renderRequest.ts';
import { PRESET_GROUPS, PROFILE_GROUPS } from '@/lib/builtinPresets.ts';
import { defaultParams, presetSchema, type Preset, type Profile } from '@swell/schema';
import { formatDate, uid } from '@swell/shared';

/**
 * Page 9 — Presets, Profiles & History (§4.9).
 *
 * The thumbnails here are **real renders**: one shared WebGL context paints each
 * preset onto the active photo at 240 px and the result is cached as a JPEG data
 * URL. Hover previews apply the preset to the live doc without a history entry,
 * so leaving the card reverts cleanly.
 */

const PREVIEW_W = 240;

export function PresetsPage() {
  const presets = useDevelop((s) => s.presets);
  const profiles = useDevelop((s) => s.profiles);
  const snapshots = useDevelop((s) => s.snapshots);
  const versions = useDevelop((s) => s.versions);
  const applyPreset = useDevelop((s) => s.applyPreset);
  const applyProfile = useDevelop((s) => s.applyProfile);
  const addPreset = useDevelop((s) => s.addPreset);
  const deletePreset = useDevelop((s) => s.deletePreset);
  const toggleFavorite = useDevelop((s) => s.togglePresetFavorite);
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const photoId = useCatalog((s) => s.activeId());
  const selection = useCatalog((s) => s.selection);
  const select = useCatalog((s) => s.select);
  const go = useUi((s) => s.go);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [amount, setAmount] = useState(100);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const hovered = useRef<string | null>(null);
  const backup = useRef<Record<string, unknown> | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presets.filter(
      (p) =>
        (group === 'all' || p.group === group) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
  }, [presets, group, query]);

  /* ---------------------------------------------------- real thumbnails */
  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    const canvas = makeCanvas(PREVIEW_W, Math.round(PREVIEW_W / 1.5));
    const client = new EngineClient({ canvas, histogramHz: 0 });
    if (!client.init()) {
      client.dispose();
      canvas.remove();
      return;
    }
    setPreviewing(true);

    void (async () => {
      let bmp: ImageBitmap;
      try {
        bmp = await imageLoader.loadPhoto(photo, 'thumb');
      } catch {
        client.dispose();
        setPreviewing(false);
        return;
      }
      client.setSource(photo.id, bmp);
      const base = useDevelop.getState().params[photo.id] ?? defaultParams();
      const out: Record<string, string> = {};
      let n = 0;
      for (const p of list) {
        if (cancelled) break;
        const params = applyPresetParams(base, p.params, (p.amount ?? 100) / 100);
        const h = Math.round((PREVIEW_W * photo.height) / photo.width);
        canvas.width = PREVIEW_W;
        canvas.height = h;
        client.schedule(
          makeRenderRequest({
            photoId: photo.id,
            requestId: ++n,
            params,
            source: bmp,
            width: PREVIEW_W,
            height: h,
          }),
        );
        client.flush();
        try {
          out[p.id] = canvas.toDataURL('image/jpeg', 0.72);
        } catch {
          /* tainted canvas cannot happen for local files, but stay safe */
        }
        if (n % 4 === 0) {
          setPreviews({ ...out });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (!cancelled) {
        setPreviews(out);
        setPreviewing(false);
      }
      bmp.close();
      client.dispose();
      canvas.remove();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, list.length, photo?.src]);

  /* ------------------------------------------------- hover live preview */
  const hoverOn = (p: Preset) => {
    if (!photoId || hovered.current === p.id) return;
    hovered.current = p.id;
    const dev = useDevelop.getState();
    backup.current = { ...(dev.params[photoId] ?? {}) } as Record<string, unknown>;
    applyPreset([photoId], p.id, amount);
  };
  const hoverOff = () => {
    if (!photoId || !hovered.current || !backup.current) return;
    hovered.current = null;
    // revert silently — the committed doc is restored without a history entry
    useDevelop.setState((s) => {
      s.params[photoId] = backup.current as never;
    });
    backup.current = null;
  };

  const photoSnapshots = photoId ? snapshots.filter((s) => s.photoId === photoId) : [];
  const photoVersions = photoId ? versions.filter((v) => v.photoId === photoId) : [];

  return (
    <div className="flex min-h-0 flex-1">
      {/* sidebar */}
      <div className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto bg-s1 p-2 no-scrollbar">
        <SearchField value={query} onChange={setQuery} placeholder="Filter presets…" shortcut="" />
        <div className="flex flex-wrap gap-1 px-1 pt-1">
          <Chip active={group === 'all'} onClick={() => setGroup('all')}>
            All
          </Chip>
          {PRESET_GROUPS.map((g) => (
            <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </Chip>
          ))}
        </div>

        <Section title="Amount" icon="sliders" dense className="mt-1">
          <Slider
            label="Preset amount"
            value={amount}
            min={0}
            max={200}
            step={1}
            unit="%"
            format={(v) => `${Math.round(v)}%`}
            onChange={setAmount}
            onCommit={() => toast.info('Amount', `${amount}% — applied when you click a preset.`)}
          />
        </Section>

        <Section title="Actions" icon="magic" dense>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Button size="xs" variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!photoId}>
              Create from current
            </Button>
            <Button size="xs" variant="subtle" icon="import" onClick={() => fileInput('preset')}>
              Import .swellpreset
            </Button>
            <Button size="xs" variant="subtle" icon="colourFilter" onClick={() => fileInput('cube')}>
              Import .cube / .3dl LUT
            </Button>
            <Button size="xs" variant="ghost" icon="develop" onClick={() => go('develop')}>
              Back to Develop
            </Button>
          </div>
        </Section>

        <Section title={`Snapshots (${photoSnapshots.length})`} icon="camera" dense defaultOpen={false}>
          <div className="px-1 pb-1">
            {photoSnapshots.map((s) => (
              <div key={s.id} className="group flex h-7 items-center gap-1">
                <button type="button" className="min-w-0 flex-1 truncate rounded-[6px] px-1.5 py-1 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
                  onClick={() => { useDevelop.getState().applySnapshot(photoId!, s.id); toast.ok('Snapshot applied', s.name); }}>
                  {s.name}
                </button>
                <span className="numeric text-[10px] text-t3">{formatDate(new Date(s.ts).toISOString())}</span>
              </div>
            ))}
            {!photoSnapshots.length && <p className="px-1 py-1 text-2xs text-t3">No snapshots for this photo.</p>}
          </div>
        </Section>

        <Section title={`Versions (${photoVersions.length})`} icon="copy" dense defaultOpen={false}>
          <div className="px-1 pb-1">
            {photoVersions.map((v) => (
              <div key={v.id} className="group flex h-7 items-center gap-1">
                <button type="button" className="min-w-0 flex-1 truncate rounded-[6px] px-1.5 py-1 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
                  onClick={() => { useDevelop.getState().applyVersion(photoId!, v.id); toast.ok('Version applied', v.name); }}>
                  {v.name}
                </button>
                <IconButton name="split" size={12} box="sm" label="Diff against current"
                  onClick={() => toast.info('Version diff', `${diffCount(v.params, useDevelop.getState().getParams(photoId!))} values differ.`)} />
              </div>
            ))}
            {!photoVersions.length && <p className="px-1 py-1 text-2xs text-t3">No named versions yet.</p>}
          </div>
        </Section>

        <Section title="Profiles" icon="palette" dense defaultOpen={false}>
          {PROFILE_GROUPS.map((g) => (
            <div key={g.id} className="mb-1">
              <div className="px-1 text-[10px] tracking-wide text-t3 uppercase">{g.label}</div>
              {profiles.filter((p) => p.group === g.id).map((p) => (
                <button key={p.id} type="button"
                  onClick={() => { if (photoId) { applyProfile(photoId, p.id); toast.ok('Profile applied', p.name); } }}
                  className="flex h-7 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1">
                  <SwIcon name="palette" size={12} className="text-t3" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.lutId && <Badge tone="muted">LUT</Badge>}
                </button>
              ))}
            </div>
          ))}
        </Section>
      </div>

      {/* preset grid */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 px-3">
          <span className="numeric text-2xs text-t3">{list.length} presets</span>
          {previewing && (
            <span className="flex items-center gap-1 text-2xs text-t3">
              <Spinner className="size-3" /> rendering live previews
            </span>
          )}
          {selection.length > 1 && (
            <Badge tone="accent">Applies to {selection.length} selected photos</Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Tooltip label="Batch: apply the last preset to the whole selection" placement="bottom">
              <span>
                <IconButton name="layers" size={14} box="sm" label="Batch apply"
                  onClick={() => {
                    if (!list[0]) return;
                    const ids = selection.length ? selection : photoId ? [photoId] : [];
                    applyPreset(ids, list[0].id, amount);
                    toast.ok('Preset applied', `${list[0].name} → ${ids.length} photo(s) at ${amount}%.`);
                  }} />
              </span>
            </Tooltip>
            <IconButton name="settings" size={14} box="sm" label="History & versions" onClick={() => go('develop')} />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 overflow-y-auto p-3 no-scrollbar">
          {list.map((p) => (
            <div
              key={p.id}
              onPointerEnter={() => hoverOn(p)}
              onPointerLeave={hoverOff}
              className={cx(
                'group relative overflow-hidden rounded-[var(--radius-lg)] bg-s2 shadow-[var(--e1)] transition-all duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:bg-s3 hover:shadow-[var(--e2)]',
              )}
            >
              <button type="button" className="block w-full text-left"
                onClick={() => {
                  const ids = selection.length ? selection : photoId ? [photoId] : [];
                  if (!ids.length) {
                    toast.warn('No photo selected', 'Pick a photo first.');
                    return;
                  }
                  hoverOff();
                  applyPreset(ids, p.id, amount);
                  toast.ok('Preset applied', `${p.name} at ${amount}% → ${ids.length} photo(s)`);
                }}
                aria-label={`Apply ${p.name}`}
              >
                {previews[p.id] ? (
                  <img src={previews[p.id]} alt="" className="block aspect-3/2 w-full object-cover" draggable={false} />
                ) : (
                  <span className="grid aspect-3/2 w-full place-items-center bg-s2 text-t3">
                    {previewing ? <Spinner className="size-4" /> : <SwIcon name="palette" size={18} />}
                  </span>
                )}
                <span className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-2xs text-t1">{p.name}</span>
                  {p.favorite && <SwIcon name="starSolid" size={11} className="text-[oklch(0.82_0.14_85)]" />}
                </span>
              </button>
              <span className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton name={p.favorite ? 'starSolid' : 'star'} size={12} box="sm" label="Favourite" onClick={() => toggleFavorite(p.id)} />
                <Menu
                  placement="bottom-end"
                  title={p.name}
                  items={[
                    { id: 'fav', label: p.favorite ? 'Remove favourite' : 'Favourite', icon: 'star', onSelect: () => toggleFavorite(p.id) },
                    { id: 'export', label: 'Export .swellpreset', icon: 'export', onSelect: () => exportPreset(p) },
                    { id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: () => addPreset({ ...p, id: uid('preset'), name: `${p.name} copy`, group: 'user' }) },
                    { id: 'del', label: 'Delete', icon: 'trash', onSelect: () => { deletePreset(p.id); toast.ok('Preset deleted', p.name); } },
                  ]}
                  trigger={({ ref, toggle }) => (
                    <span ref={ref}>
                      <IconButton name="menu" size={12} box="sm" label="Preset menu" onClick={toggle} />
                    </span>
                  )}
                />
              </span>
              <span className="numeric absolute bottom-8 left-2 rounded-[5px] bg-[oklch(0.1_0.01_250/0.6)] px-1 text-[9px] text-t2 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                {p.include.length} groups · {p.amount}%
              </span>
            </div>
          ))}
          {!list.length && (
            <div className="col-span-full grid place-items-center py-16 text-t3">
              <div className="flex flex-col items-center gap-2">
                <SwIcon name="palette" size={26} />
                <span className="text-xs">No presets match “{query}”.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreatePresetDialog open={creating} onClose={() => setCreating(false)} onSave={(input) => { addPreset(input); setCreating(false); toast.ok('Preset created', input.name); }} />
    </div>
  );

  function fileInput(kind: 'preset' | 'cube') {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = kind === 'preset' ? '.swellpreset,.json' : '.cube,.3dl';
    el.onchange = async () => {
      const f = el.files?.[0];
      if (!f) return;
      const text = await f.text();
      if (kind === 'preset') {
        try {
          const parsed = presetSchema.parse(JSON.parse(text));
          addPreset({ ...parsed, id: uid('preset'), group: 'user' });
          toast.ok('Preset imported', parsed.name);
        } catch (err) {
          toast.error('Import failed', err instanceof Error ? err.message : 'Not a Swell preset file.');
        }
      } else {
        const id = uid('lut');
        const client = new EngineClient({ canvas: makeCanvas(2, 2) });
        const res = client.init() ? client.importCube(id, text) : null;
        client.dispose();
        if (!res) {
          toast.error('LUT import failed', 'That file could not be parsed as a .cube/.3dl LUT.');
          return;
        }
        useDevelop.setState((s) => {
          s.profiles.push({ id, name: f.name.replace(/\.(cube|3dl)$/i, ''), group: 'lut', params: {}, lutId: id, favorite: false } as Profile);
        });
        toast.ok('LUT imported', `${res.title ?? f.name} · ${res.size}³ — available under Profiles → LUT.`);
      }
    };
    el.click();
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;opacity:0';
  document.body.appendChild(c);
  return c;
}

function exportPreset(p: Preset) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/\s+/g, '-').toLowerCase()}.swellpreset`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast.ok('Preset exported', a.download);
}

function diffCount(a: unknown, b: unknown, out = { n: 0 }): number {
  if (a === b) return out.n;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return ++out.n;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b as object)])) {
    diffCount((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out);
  }
  return out.n;
}

/* ------------------------------------------------------- create dialog */

const GROUP_OPTIONS = [
  'wb', 'tone', 'presence', 'curves', 'mixer', 'pointColor', 'grading', 'detail',
  'lens', 'geometry', 'effects', 'calibration', 'treatment', 'profile',
];

function CreatePresetDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: { id: string; name: string; group: Preset['group']; include: string[]; amount: number; params: Partial<Preset['params']> }) => void;
}) {
  const photoId = useCatalog((s) => s.activeId());
  const current = useDevelop((s) => (photoId ? s.params[photoId] : undefined));
  const [name, setName] = useState('My preset');
  const [group, setGroup] = useState<Preset['group']>('user');
  const [include, setInclude] = useState<string[]>(['tone', 'presence', 'curves', 'grading']);

  if (!open) return null;

  const params: Partial<Preset['params']> = {};
  const base = defaultParams();
  if (current) {
    for (const g of include) {
      const cur = (current as unknown as Record<string, unknown>)[g];
      const def = (base as unknown as Record<string, unknown>)[g];
      if (cur !== undefined && JSON.stringify(cur) !== JSON.stringify(def)) {
        (params as Record<string, unknown>)[g] = cur;
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} label="Create preset" size="md">
      <ModalHeader title="Create preset" subtitle="Store the current look as a reusable preset" icon="plus" onClose={onClose} />
      <div className="flex flex-col gap-2 p-3">
        <label className="text-2xs text-t3">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-8 w-full rounded-[var(--radius-md)] bg-s2 px-2 text-xs text-t1 focus:bg-s3 focus:outline-none"
          />
        </label>
        <label className="text-2xs text-t3">
          Group
          <Select
            size="sm"
            className="mt-1 w-full"
            ariaLabel="Preset group"
            value={group}
            options={[
              { value: 'user', label: 'User' },
              { value: 'swell', label: 'Swell' },
              { value: 'creative', label: 'Creative' },
              { value: 'bw', label: 'Black & white' },
              { value: 'film', label: 'Film emulation' },
              { value: 'color', label: 'Colour' },
              { value: 'local', label: 'Local' },
            ]}
            onChange={(v) => setGroup(v as Preset['group'])}
          />
        </label>
        <div>
          <div className="mb-1 text-2xs text-t3">Include</div>
          <div className="flex flex-wrap gap-1">
            {GROUP_OPTIONS.map((g) => (
              <Chip key={g} active={include.includes(g)} onClick={() => setInclude(include.includes(g) ? include.filter((x) => x !== g) : [...include, g])}>
                {g}
              </Chip>
            ))}
          </div>
        </div>
        <Switch checked label="Store as relative to defaults" description="Only the values that differ from a reset photo are saved." onChange={() => undefined} />
        <div className="mt-1 flex items-center gap-2">
          <Badge tone={Object.keys(params).length ? 'ok' : 'warn'}>
            {Object.keys(params).length} group{Object.keys(params).length === 1 ? '' : 's'} will be stored
          </Badge>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" icon="check" disabled={!name.trim() || !Object.keys(params).length}
              onClick={() => onSave({ id: uid('preset'), name: name.trim(), group, include, amount: 100, params })}>
              Create preset
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default PresetsPage;
