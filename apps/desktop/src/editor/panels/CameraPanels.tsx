import { useMemo, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Keycap } from '@/ui/Button.tsx';
import { Section, FieldRow } from '@/ui/Panel.tsx';
import { KeyValue, NumberField, SearchField, TextField } from '@/ui/Controls.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { ParamSlider, ParamSwitch, ParamSelect, useLive, writeLive, commitLive, replaceLive } from './ParamControls.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop, useHistory } from '@/state/develop.ts';
import { useUi } from '@/state/ui.ts';
import { formatAperture, formatDate, formatDateTime, formatFocal, formatShutter, relativeTime, uid } from '@swell/shared';
import { guidedUpright, uprightToParams } from '@swell/shared';

/* ========================================================================== */
/*  LENS                                                                       */
/* ========================================================================== */

export function LensPanel() {
  const params = useLive();
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const profiles = useMemo(
    () => [
      { value: 'auto', label: `Auto — ${photo?.lens || 'unknown lens'}` },
      { value: 'manual', label: 'Manual' },
      { value: 'none', label: 'No correction' },
    ],
    [photo?.lens],
  );

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Lens corrections" icon="lens" dense>
        <ParamSwitch path="lens.enabled" label="Enable corrections" description="Distortion + vignetting from the lens profile" />
        <ParamSelect path="lens.profileId" label="Profile" options={profiles} />
        <ParamSlider path="lens.distortion" label="Distortion" min={0} max={200} step={1} unit="%" format={(v) => `${Math.round(v)}%`} />
        <ParamSlider path="lens.vignetting" label="Vignetting" min={0} max={200} step={1} unit="%" format={(v) => `${Math.round(v)}%`} />
        <p className="px-2 pt-1 text-2xs text-t3">
          Profiles come from an embedded lensfun-derived table in the desktop build. In this web build the profile is
          applied analytically from focal length and camera model.
        </p>
      </Section>

      <Section title="Chromatic aberration" icon="colourFilter" dense defaultOpen={false}>
        <ParamSwitch path="lens.removeCA" label="Remove CA" />
        <ParamSlider path="lens.caAmount" label="Amount" min={0} max={200} step={1} unit="%" />
        <ParamSlider path="lens.defringeAmount" label="Defringe" min={0} max={100} step={1} />
        <div className="px-2 pt-1 text-2xs text-t3">
          Hue range <span className="numeric">{params.lens.defringeHue[0]}°–{params.lens.defringeHue[1]}°</span>
        </div>
      </Section>
    </div>
  );
}

/* ========================================================================== */
/*  GEOMETRY / CROP                                                            */
/* ========================================================================== */

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: 'free', label: 'Free', ratio: 0 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '7:5', label: '7:5', ratio: 7 / 5 },
];

export function GeometryPanel() {
  const params = useLive();
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const crop = params.geometry.crop;
  const nativeAspect = photo ? photo.width / photo.height : 1.5;
  const [aspect, setAspect] = useState<string>(crop.aspect ?? 'original');

  const applyAspect = (id: string, ratio: number | null) => {
    setAspect(id);
    const target = ratio === null ? nativeAspect : ratio || nativeAspect;
    // keep the crop centred, fit inside the frame
    let w = 1;
    let h = (w * nativeAspect) / target;
    if (h > 1) {
      h = 1;
      w = target / nativeAspect;
    }
    const next = { ...params, geometry: { ...params.geometry, crop: { ...crop, aspect: id as (typeof crop)['aspect'], w: Math.min(1, w), h: Math.min(1, h), x: (1 - w) / 2, y: (1 - h) / 2 } } };
    replaceLive(next);
    commitLive(`Crop aspect ${id}`);
  };

  const upright = (mode: 'auto' | 'level' | 'vertical' | 'full' | 'off') => {
    const lines = params.geometry.guidedLines;
    let next = { ...params, geometry: { ...params.geometry, upright: mode } };
    if (mode !== 'off' && lines.length >= 2) {
      const p = uprightToParams(guidedUpright(lines));
      next = {
        ...next,
        geometry: { ...next.geometry, vertical: p.vertical, horizontal: p.horizontal, rotate: p.rotate },
      };
    }
    replaceLive(next);
    commitLive(`Upright ${mode}`);
  };

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Crop" icon="crop" dense>
        <div className="flex flex-wrap gap-1 px-1 pb-1.5">
          {ASPECTS.map((a) => (
            <Chip key={a.id} active={aspect === a.id} onClick={() => applyAspect(a.id, a.ratio)}>
              {a.label}
            </Chip>
          ))}
        </div>
        <ParamSlider
          path="geometry.crop.angle"
          label="Angle"
          min={-45}
          max={45}
          step={0.1}
          unit="°"
          format={(v) => `${v.toFixed(1)}°`}
        />
        <div className="flex items-center gap-1 px-1 py-1">
          <Button size="xs" variant="subtle" icon="angle" onClick={() => useUi.getState().setRightPanel('adjust')}>
            Draw straighten line
          </Button>
          <IconButton
            name="merge"
            label="Flip horizontal"
            size={14}
            box="sm"
            pressed={crop.flipH}
            onClick={() => {
              replaceLive({ ...params, geometry: { ...params.geometry, crop: { ...crop, flipH: !crop.flipH } } });
              commitLive('Flip horizontal');
            }}
          />
          <IconButton
            name="split"
            label="Flip vertical"
            size={14}
            box="sm"
            pressed={crop.flipV}
            onClick={() => {
              replaceLive({ ...params, geometry: { ...params.geometry, crop: { ...crop, flipV: !crop.flipV } } });
              commitLive('Flip vertical');
            }}
          />
          <IconButton
            name="restart"
            label="Reset crop"
            size={14}
            box="sm"
            onClick={() => {
              replaceLive({
                ...params,
                geometry: { ...params.geometry, crop: { ...crop, x: 0, y: 0, w: 1, h: 1, angle: 0, flipH: false, flipV: false } },
              });
              commitLive('Reset crop');
            }}
          />
        </div>
        <FieldRow label="Crop" hint="x · y · w · h">
          <span className="numeric text-2xs text-t3">
            {crop.x.toFixed(2)} {crop.y.toFixed(2)} {crop.w.toFixed(2)} {crop.h.toFixed(2)}
          </span>
        </FieldRow>
      </Section>

      <Section title="Upright" icon="ruler" dense>
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {(['off', 'auto', 'level', 'vertical', 'full'] as const).map((m) => (
            <Chip key={m} active={params.geometry.upright === m} onClick={() => upright(m)}>
              {m === 'off' ? 'Off' : m[0].toUpperCase() + m.slice(1)}
            </Chip>
          ))}
          <Chip
            active={params.geometry.upright === 'guided'}
            icon="angle"
            onClick={() => {
              if (params.geometry.guidedLines.length >= 2) upright('auto');
              else {
                replaceLive({
                  ...params,
                  geometry: {
                    ...params.geometry,
                    upright: 'guided',
                    guidedLines: [
                      { x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.32 },
                      { x0: 0.3, y0: 0.2, x1: 0.32, y1: 0.8 },
                    ],
                  },
                });
                commitLive('Guided upright (demo lines)');
              }
            }}
          >
            Guided
          </Chip>
        </div>
        <ParamSlider path="geometry.vertical" label="Vertical" min={-100} max={100} step={1} />
        <ParamSlider path="geometry.horizontal" label="Horizontal" min={-100} max={100} step={1} />
        <ParamSlider path="geometry.distortion" label="Distortion" min={-100} max={100} step={1} />
        <ParamSlider path="geometry.aspect" label="Aspect" min={50} max={150} step={1} unit="%" />
        <ParamSlider path="geometry.scale" label="Scale" min={50} max={200} step={1} unit="%" />
        <ParamSlider path="geometry.xOffset" label="Offset X" min={-100} max={100} step={1} />
        <ParamSlider path="geometry.yOffset" label="Offset Y" min={-100} max={100} step={1} />
        <ParamSlider path="geometry.rotate" label="Rotate" min={-180} max={180} step={0.5} unit="°" />
      </Section>
    </div>
  );
}

/* ========================================================================== */
/*  HISTORY · SNAPSHOTS · VERSIONS                                             */
/* ========================================================================== */

export function HistoryPanel() {
  const photoId = useCatalog((s) => s.activeId());
  const { entries, head } = useHistory(photoId);
  const jumpTo = useDevelop((s) => s.jumpTo);
  const undo = useDevelop((s) => s.undo);
  const redo = useDevelop((s) => s.redo);
  const snapshots = useDevelop((s) => s.snapshots);
  const versions = useDevelop((s) => s.versions);
  const addSnapshot = useDevelop((s) => s.addSnapshot);
  const applySnapshot = useDevelop((s) => s.applySnapshot);
  const deleteSnapshot = useDevelop((s) => s.deleteSnapshot);
  const addVersion = useDevelop((s) => s.addVersion);
  const applyVersion = useDevelop((s) => s.applyVersion);
  const deleteVersion = useDevelop((s) => s.deleteVersion);
  const [naming, setNaming] = useState<'snapshot' | 'version' | null>(null);
  const [name, setName] = useState('');

  const list = photoId ? snapshots.filter((s) => s.photoId === photoId) : [];
  const vlist = photoId ? versions.filter((v) => v.photoId === photoId) : [];

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="History" icon="history" dense right={
        <span className="flex items-center gap-0.5">
          <IconButton name="undo" size={13} box="sm" label="Undo" disabled={head < 0} onClick={() => photoId && undo(photoId)} />
          <IconButton name="redo" size={13} box="sm" label="Redo" disabled={head >= entries.length - 1} onClick={() => photoId && redo(photoId)} />
        </span>
      }>
        <div className="max-h-64 overflow-y-auto px-1">
          <button
            type="button"
            onClick={() => photoId && jumpTo(photoId, -1)}
            className={cx(
              'flex h-7 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left text-2xs',
              head < 0 ? 'bg-s3 text-t1' : 'text-t3 hover:bg-s2',
            )}
          >
            <SwIcon name="restart" size={12} className="opacity-70" />
            Import (original)
          </button>
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => photoId && jumpTo(photoId, i)}
              className={cx(
                'group flex h-7 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left text-2xs transition-colors',
                i === head ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-t2 hover:bg-s2 hover:text-t1',
                i > head && 'opacity-45',
              )}
            >
              <span className="numeric w-4 shrink-0 text-t3">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              <span className="numeric shrink-0 text-[10px] text-t3">{relativeTime(e.ts)}</span>
            </button>
          ))}
          {!entries.length && <p className="px-2 py-2 text-2xs text-t3">No edits yet — this photo is untouched.</p>}
        </div>
        {entries.some((_, i) => i > head) && (
          <p className="px-2 py-1 text-2xs text-t3">
            Entries after the head are an alternative branch. Editing now replaces them.
          </p>
        )}
      </Section>

      <Section title="Snapshots" icon="camera" dense defaultOpen={false}>
        {list.map((s) => (
          <div key={s.id} className="group flex h-8 items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => photoId && applySnapshot(photoId, s.id)}
              className="min-w-0 flex-1 truncate rounded-[6px] px-2 py-1 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
            >
              {s.name}
              <span className="numeric ml-2 text-t3">{formatDate(s.ts)}</span>
            </button>
            <IconButton name="trash" size={12} box="sm" label={`Delete ${s.name}`} className="opacity-0 group-hover:opacity-100" onClick={() => deleteSnapshot(s.id)} />
          </div>
        ))}
        <Button
          size="xs"
          variant="subtle"
          icon="camera"
          className="mx-1 my-1"
          disabled={!photoId}
          onClick={() => {
            setNaming('snapshot');
            setName(`Snapshot ${list.length + 1}`);
          }}
        >
          Create snapshot
        </Button>
      </Section>

      <Section title="Versions" icon="copy" dense defaultOpen={false}>
        {vlist.map((v) => (
          <div key={v.id} className="group flex h-8 items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => photoId && applyVersion(photoId, v.id)}
              className="min-w-0 flex-1 truncate rounded-[6px] px-2 py-1 text-left text-2xs text-t2 hover:bg-s2 hover:text-t1"
            >
              {v.name}
              <span className="numeric ml-2 text-t3">{formatDate(v.ts)}</span>
            </button>
            <IconButton name="trash" size={12} box="sm" label={`Delete ${v.name}`} className="opacity-0 group-hover:opacity-100" onClick={() => deleteVersion(v.id)} />
          </div>
        ))}
        <Button
          size="xs"
          variant="subtle"
          icon="copy"
          className="mx-1 my-1"
          disabled={!photoId}
          onClick={() => {
            setNaming('version');
            setName(`Version ${vlist.length + 1}`);
          }}
        >
          New version
        </Button>
        {vlist.length > 1 && (
          <Button
            size="xs"
            variant="ghost"
            icon="split"
            className="mx-1"
            onClick={() => {
              const [a, b] = vlist;
              const diff = countDiffs(a!.params, b!.params);
              window.alert(`${a!.name} ↔ ${b!.name}: ${diff} differing values`);
            }}
          >
            Diff two versions
          </Button>
        )}
      </Section>

      {naming && (
        <div className="mx-1 mb-2 rounded-[var(--radius-md)] bg-s2 p-2">
          <TextField
            autoFocus
            size="sm"
            label={naming === 'snapshot' ? 'Snapshot name' : 'Version name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && photoId) {
                if (naming === 'snapshot') addSnapshot(photoId, name || `Snapshot ${uid('').slice(0, 4)}`);
                else addVersion(photoId, name || `Version`);
                setNaming(null);
              }
              if (e.key === 'Escape') setNaming(null);
            }}
          />
          <div className="mt-1.5 flex gap-1">
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                if (!photoId) return;
                if (naming === 'snapshot') addSnapshot(photoId, name || 'Snapshot');
                else addVersion(photoId, name || 'Version');
                setNaming(null);
              }}
            >
              Save
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Section title="Copy / paste" icon="paste" dense defaultOpen={false}>
        <div className="flex flex-wrap gap-1 px-1">
          <Button size="xs" variant="subtle" icon="copy" onClick={() => photoId && navigator.clipboard?.writeText(JSON.stringify(useDevelop.getState().copyParams(photoId)))}>
            Copy settings
          </Button>
          <Button size="xs" variant="subtle" icon="paste" onClick={() => pasteFromClipboard(photoId ?? '')}>
            Paste
          </Button>
        </div>
        <p className="px-2 pt-1 text-2xs text-t3">
          Paste applies to every selected photo — that is batch editing without a dialog.
        </p>
      </Section>
    </div>
  );
}

async function pasteFromClipboard(photoId: string) {
  const ids = useCatalog.getState().selection.length ? useCatalog.getState().selection : photoId ? [photoId] : [];
  if (!ids.length) return;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    useDevelop.getState().pasteParams(ids, parsed);
  } catch {
    const src = useDevelop.getState().copyParams(photoId);
    useDevelop.getState().pasteParams(ids, src);
  }
}

function countDiffs(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    out.push(path || '$');
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    countDiffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

/* ========================================================================== */
/*  METADATA                                                                   */
/* ========================================================================== */

export function MetaPanel() {
  const photo = useCatalog((s) => s.photos[s.activeId() ?? '']);
  const updatePhoto = useCatalog((s) => s.updatePhoto);
  const keywords = useCatalog((s) => s.keywords);
  const index = useCatalog((s) => s.keywordIndex);
  const addKeywords = useCatalog((s) => s.addKeywords);
  const removeKeyword = useCatalog((s) => s.removeKeyword);
  const features = useCatalog((s) => (photo ? s.features[photo.id] : undefined));
  const [kwQuery, setKwQuery] = useState('');

  if (!photo) return null;
  const assigned = (index[photo.id] ?? []).map((id) => keywords.find((k) => k.id === id)).filter(Boolean);
  const suggestions = keywords.filter(
    (k) => !assigned.some((a) => a?.id === k.id) && (!kwQuery || k.name.toLowerCase().includes(kwQuery.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="File" icon="page" dense>
        <div className="px-2">
          <KeyValue k="Filename" v={photo.filename} mono />
          <KeyValue k="Dimensions" v={`${photo.width} × ${photo.height}`} mono />
          <KeyValue k="Size" v={`${(photo.size / 1024 / 1024).toFixed(2)} MB`} mono />
          <KeyValue k="Captured" v={formatDateTime(photo.captureTime)} />
          <KeyValue k="Added" v={relativeTime(photo.addedTime)} />
          <KeyValue k="Path" v={photo.src} mono />
        </div>
      </Section>

      <Section title="Camera" icon="camera" dense>
        <div className="px-2">
          <KeyValue k="Camera" v={photo.camera} />
          <KeyValue k="Lens" v={photo.lens} />
          <KeyValue k="Focal" v={formatFocal(photo.focalMm)} mono />
          <KeyValue k="Aperture" v={formatAperture(photo.aperture)} mono />
          <KeyValue k="Shutter" v={formatShutter(photo.shutter)} mono />
          <KeyValue k="ISO" v={String(photo.iso)} mono />
          {photo.gps && <KeyValue k="GPS" v={`${photo.gps.place ?? ''} ${photo.gps.lat.toFixed(4)}, ${photo.gps.lon.toFixed(4)}`} mono />}
        </div>
      </Section>

      {features && (
        <Section title="Analysis" icon="smart" dense defaultOpen={false}>
          <div className="px-2">
            <KeyValue k="Sharpness" v={features.sharpness.toFixed(3)} mono />
            <KeyValue k="Exposure score" v={features.exposureScore.toFixed(2)} mono />
            <KeyValue k="Clipping" v={`−${(features.clippedShadows * 100).toFixed(2)}% / +${(features.clippedHighlights * 100).toFixed(2)}%`} mono />
            <KeyValue k="Horizon tilt" v={`${features.horizonTilt.toFixed(1)}°`} mono />
            <KeyValue k="Skin / sky" v={`${(features.skinRatio * 100).toFixed(0)}% / ${(features.skyRatio * 100).toFixed(0)}%`} mono />
            <KeyValue k="Warm ↔ cool" v={features.warmCool.toFixed(2)} mono />
          </div>
          <div className="flex flex-wrap gap-1 px-2 py-1">
            {features.palette.slice(0, 6).map((c) => (
              <Tooltip key={c.css} label={`${c.css} · ${(c.weight * 100).toFixed(0)}%`} placement="top">
                <span className="size-5 rounded-[6px] shadow-[var(--e-inset)]" style={{ background: c.css }} />
              </Tooltip>
            ))}
          </div>
        </Section>
      )}

      <Section title="IPTC" icon="text" dense defaultOpen={false}>
        <div className="flex flex-col gap-1.5 px-1">
          <TextField size="sm" label="Title" value={photo.title} onChange={(e) => updatePhoto(photo.id, { title: e.target.value })} />
          <TextField size="sm" label="Caption" value={photo.caption} onChange={(e) => updatePhoto(photo.id, { caption: e.target.value })} />
          <TextField size="sm" label="Creator" value={photo.creator} onChange={(e) => updatePhoto(photo.id, { creator: e.target.value })} />
          <TextField size="sm" label="Copyright" value={photo.copyright} onChange={(e) => updatePhoto(photo.id, { copyright: e.target.value })} />
        </div>
      </Section>

      <Section title="Keywords" icon="label" dense>
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {assigned.map((k) => (
            <Chip key={k!.id} icon="close" onClick={() => removeKeyword(photo.id, k!.id)}>
              {k!.name}
            </Chip>
          ))}
          {!assigned.length && <span className="text-2xs text-t3">No keywords yet.</span>}
        </div>
        <SearchField value={kwQuery} onChange={setKwQuery} placeholder="Add keyword…" shortcut="" className="px-1" />
        <div className="flex flex-wrap gap-1 px-1 pt-1">
          {suggestions.slice(0, 14).map((k) => (
            <Chip key={k.id} icon="plus" onClick={() => addKeywords([photo.id], [k.id])}>
              {k.name}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Sidecar" icon="pageEdit" dense defaultOpen={false}>
        <FieldRow label="XMP sidecar" hint={`${photo.filename.replace(/\.[^.]+$/, '.xmp')}`}>
          <Badge tone="ok">Synced</Badge>
        </FieldRow>
        <p className="px-2 py-1 text-2xs text-t3">
          Develop settings are written to the sidecar by default, so the edit travels with the file even if the catalog
          is lost.
        </p>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- utilities */

export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return <NumberField label={label} value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} />;
}

export { Keycap };
