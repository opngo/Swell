import { useEffect, useMemo, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Spinner } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { Menu, Tooltip } from '@/ui/Overlay.tsx';
import { SearchField, Select, Switch } from '@/ui/Controls.tsx';
import { PhotoGrid } from '@/components/PhotoGrid.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import { analysisClient, findDuplicates, findSimilar, searchByColor } from '@/lib/analysisClient.ts';
import { toast } from '@/state/toasts.ts';
import {
  CONCEPTS,
  CONCEPT_BY_ID,
  CONCEPT_GROUPS,
  cosine,
  embedQuery,
  explain,
  fuzzyContains,
  hexToRgb,
  lrgbToOklch,
  matchesFilters,
  parseQuery,
  photoVector,
  srgbToLinearRgb,
} from '@swell/shared';
import type { FilterTarget, ImageFeatures, PaletteColor } from '@swell/shared';
import type { Photo, PhotoFeatures } from '@swell/schema';

/**
 * Page 8 — Smart Detect & Search (§4.8).
 *
 * Everything here runs on this machine: concept scoring over the per-photo
 * feature vectors, perceptual hashing for duplicates, OKLCH distance for
 * colour search. No photo bytes and no faces ever leave the device.
 */
export function SmartPage() {
  const photos = useCatalog((s) => s.photos);
  const order = useCatalog((s) => s.order);
  const features = useCatalog((s) => s.features);
  const detections = useCatalog((s) => s.detections);
  const keywords = useCatalog((s) => s.keywords);
  const keywordIndex = useCatalog((s) => s.keywordIndex);
  const select = useCatalog((s) => s.select);
  const selectAll = useCatalog((s) => s.selectAll);
  const createCollection = useCatalog((s) => s.createCollection);
  const addToCollection = useCatalog((s) => s.addToCollection);
  const go = useUi((s) => s.go);
  const ai = useSettings((s) => s.settings.ai);
  const setAi = useSettings((s) => s.set);
  const deleteAllFaceData = useCatalog((s) => s.deleteAllFaceData);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'semantic' | 'similar' | 'color' | 'duplicates'>('semantic');
  const [colorTarget, setColorTarget] = useState('#3fa7c8');
  const [busy, setBusy] = useState(false);
  const [explanations, setExplanations] = useState<Record<string, { conceptId: string; label: string; score: number }[]>>({});

  const indexed = useMemo(() => order.filter((id) => features[id]), [order, features]);
  const parse = useMemo(() => parseQuery(query), [query]);

  /* ---------------------------------------------------- semantic search */
  const semanticResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = embedQuery(parse);
    const ranking = parse.concepts.length > 0;
    // Filter syntax (`iso>1600`, `camera:a7r`, `after:2024`) is not prose: keep
    // it out of the free-text match below.
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !/^[a-z]+[:<>=]/.test(w));
    const scored: { id: string; score: number; why: ReturnType<typeof explain> }[] = [];

    for (const id of order) {
      const p = photos[id];
      if (!p) continue;
      const f = features[id];
      const kw = (keywordIndex[id] ?? [])
        .map((k) => keywords.find((x) => x.id === k)?.name ?? '')
        .filter(Boolean);
      const dets = detections[id] ?? [];
      const target: FilterTarget = {
        iso: p.iso,
        focal: p.focalMm,
        aperture: p.aperture,
        rating: p.rating,
        shutter: p.shutter,
        exposure: f?.exposureScore,
        blur: f?.blurScore,
        sharpness: f?.sharpness,
        camera: p.camera,
        lens: p.lens,
        file: p.filename,
        ext: p.ext,
        label: p.colorLabel,
        keyword: [...kw, ...dets.map((d) => d.label)],
        person: [...kw, ...dets.filter((d) => d.kind === 'face').map((d) => d.label)],
        takenAt: p.captureTime || p.addedTime,
      };
      // Metadata filters are a hard gate — "sunset iso>1600" ranks by concept
      // but only ever returns photos that clear the ISO bound.
      if (!matchesFilters(target, parse)) continue;

      let score = 0;
      let why: ReturnType<typeof explain> = [];
      if (ranking && f) {
        const v = photoVector(toImageFeatures(f, p), kw);
        score = cosine(q, v.values);
        why = explain(v.values, q, 3);
      }
      const hay = `${p.filename} ${p.title} ${p.caption ?? ''} ${p.camera} ${p.lens} ${kw.join(' ')}`.toLowerCase();
      const textHit = words.length > 0 && words.every((w) => fuzzyContains(hay, w));
      if (textHit) score = Math.max(score, 0.55);
      else if (!ranking && words.length === 0) score = Math.max(score, 0.5); // filters only
      if (score > 0.08) scored.push({ id, score, why });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 240);
  }, [query, parse, features, photos, order, keywords, keywordIndex, detections]);

  const ids = useMemo(() => {
    if (mode === 'semantic') return semanticResults.map((r) => r.id);
    return [];
  }, [mode, semanticResults]);

  useEffect(() => {
    const map: Record<string, { conceptId: string; label: string; score: number }[]> = {};
    for (const r of semanticResults.slice(0, 60)) map[r.id] = r.why;
    setExplanations(map);
  }, [semanticResults]);

  /* --------------------------------------------------------- similar */
  const [similar, setSimilar] = useState<{ id: string; score: number; why: { label: string; score: number }[] }[]>([]);
  const runSimilar = async (photoId: string) => {
    setBusy(true);
    void photos;
    const f = features[photoId];
    const p = photos[photoId];
    if (!f || !p) {
      toast.warn('Not indexed yet', 'Wait for indexing to finish, then try again.');
      setBusy(false);
      return;
    }
    const hits = findSimilar(photoId, features, detections, 24);
    setSimilar(hits);
    selectAll(hits.map((h) => h.id));
    setBusy(false);
    toast.ok(`${hits.length} similar photos`, 'Selection updated — batch anything you like.');
  };

  /* ----------------------------------------------------------- colour */
  const [colorHits, setColorHits] = useState<{ id: string; score: number }[]>([]);
  const runColor = () => {
    const target = lrgbToOklch(srgbToLinearRgb(hexToRgb(colorTarget)));
    const hits = searchByColor({ h: target.h, c: target.c, l: target.l }, features, 32);
    setColorHits(hits);
    selectAll(hits.map((h) => h.id));
    toast.ok(`${hits.length} photos match that colour`, 'Sorted by OKLCH distance to the swatch.');
  };

  /* ------------------------------------------------------- duplicates */
  const [dupes, setDupes] = useState<{ ids: string[]; distance: number }[]>([]);
  const runDupes = () => {
    const pairs = findDuplicates(features, 10);
    // union-find the pairs into groups
    const parent = new Map<string, string>();
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const p of pairs) {
      for (const id of [p.a, p.b]) if (!parent.has(id)) parent.set(id, id);
      const ra = find(p.a);
      const rb = find(p.b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const groups = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      groups.set(root, [...(groups.get(root) ?? []), id]);
    }
    const out = [...groups.values()]
      .filter((ids) => ids.length > 1)
      .map((ids) => ({ ids, distance: pairs.find((p) => ids.includes(p.a) && ids.includes(p.b))?.distance ?? 0 }));
    setDupes(out);
    toast.ok(`${out.length} duplicate group${out.length === 1 ? '' : 's'}`, 'Matched on perceptual hash — same photo, different file.');
  };

  /* ---------------------------------------------------- detection map */
  const byLabel = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const id of order) {
      for (const d of detections[id] ?? []) {
        const arr = counts.get(d.label) ?? [];
        arr.push(id);
        counts.set(d.label, arr);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [order, detections]);

  const conceptCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of CONCEPTS) {
      let n = 0;
      for (const id of indexed) {
        const hit = features[id]?.concepts.find((x) => x.id === c.id);
        if (hit && hit.score > 0.34) n++;
      }
      out.set(c.id, n);
    }
    return out;
  }, [indexed, features]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* left: query + facets */}
      <div className="flex w-72 shrink-0 flex-col gap-1 overflow-y-auto bg-s1 p-2 no-scrollbar">
        <SearchField value={query} onChange={setQuery} placeholder="Describe the photo…" shortcut="" />
        <p className="px-1 pt-0.5 text-2xs text-t3">
          {parse.concepts.length > 0 || parse.filters.length > 0 ? (
            <>
              Parsed:{' '}
              {parse.concepts.map((c) => (
                <Chip key={c.id} active icon="smart" onClick={() => setQuery(CONCEPT_BY_ID.get(c.id)?.label ?? c.term)}>
                  {CONCEPT_BY_ID.get(c.id)?.label ?? c.term}
                </Chip>
              ))}
              {parse.filters.map((f) => (
                <Chip key={`${f.field}${f.value}`} icon="filter">
                  {f.field} {f.op} {f.value}
                </Chip>
              ))}
            </>
          ) : (
            <>Try “golden hour portraits by the lake”, “sharp dog photos 2024”, “blue sky”.</>
          )}
        </p>

        <div className="mt-1 flex flex-wrap gap-1 px-1">
          {(['semantic', 'similar', 'color', 'duplicates'] as const).map((m) => (
            <Chip key={m} active={mode === m} onClick={() => setMode(m)}>
              {m === 'semantic' ? 'Search' : m === 'similar' ? 'Similar' : m === 'color' ? 'By colour' : 'Duplicates'}
            </Chip>
          ))}
        </div>

        {mode === 'color' && (
          <div className="mt-1 rounded-[var(--radius-md)] bg-s2 p-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorTarget}
                onChange={(e) => setColorTarget(e.target.value)}
                aria-label="Target colour"
                className="h-8 w-12 cursor-pointer rounded-[var(--radius-sm)] bg-s3"
              />
              <Button size="xs" variant="primary" icon="search" onClick={runColor}>
                Find this colour
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {['#3fa7c8', '#e0a458', '#7fb069', '#c86b8a', '#8d86c9', '#e8e2d0'].map((c) => (
                <button key={c} type="button" onClick={() => setColorTarget(c)} aria-label={`Search ${c}`} className="size-5 rounded-[6px] shadow-[var(--e-inset)]" style={{ background: c }} />
              ))}
            </div>
          </div>
        )}

        {mode === 'similar' && (
          <div className="mt-1 rounded-[var(--radius-md)] bg-s2 p-2">
            <p className="text-2xs text-t3">Pick a photo in the grid, then:</p>
            <Button
              size="xs"
              variant="primary"
              icon="spark"
              className="mt-1"
              disabled={busy}
              onClick={() => {
                const id = useCatalog.getState().activeId();
                if (id) void runSimilar(id);
              }}
            >
              {busy ? <Spinner className="size-3" /> : 'Find similar to active'}
            </Button>
            {similar.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-0.5">
                {similar.slice(0, 8).map((h) => (
                  <button key={h.id} type="button" onClick={() => select(h.id)} className="flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left hover:bg-s3">
                    <img src={photos[h.id]?.src} alt="" className="size-6 rounded-[4px] object-cover" />
                    <span className="min-w-0 flex-1 truncate text-2xs text-t2">{photos[h.id]?.filename}</span>
                    <span className="numeric text-[10px] text-t3">{(h.score * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'duplicates' && (
          <div className="mt-1 rounded-[var(--radius-md)] bg-s2 p-2">
            <Button size="xs" variant="primary" icon="copy" onClick={runDupes}>
              Find duplicates
            </Button>
            {dupes.map((g, i) => (
              <div key={i} className="mt-1.5">
                <div className="numeric text-2xs text-t3">
                  Group {i + 1} · {g.ids.length} files · Δ{g.distance.toFixed(1)}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {g.ids.map((id) => (
                    <button key={id} type="button" onClick={() => select(id)} className="overflow-hidden rounded-[6px] transition-transform hover:scale-105">
                      <img src={photos[id]?.src} alt="" className="size-12 object-cover" />
                    </button>
                  ))}
                </div>
                <Button size="xs" variant="ghost" icon="stack" className="mt-0.5" onClick={() => useCatalog.getState().stackWith(g.ids, `dup-${Date.now()}`)}>
                  Stack group
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* concepts */}
        <Section title="Concepts" icon="smart" dense className="mt-1">
          {CONCEPT_GROUPS.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-1 text-[10px] tracking-wide text-t3 uppercase">{g}</div>
              <div className="flex flex-wrap gap-1 px-1">
                {CONCEPTS.filter((c) => c.group === g).map((c) => {
                  const n = conceptCounts.get(c.id) ?? 0;
                  return (
                    <Tooltip key={c.id} label={`${c.label}${c.synonyms?.length ? ` — ${c.synonyms.join(', ')}` : ''}`} placement="right">
                      <Chip active={parse.concepts.some((x) => x.id === c.id)} onClick={() => setQuery(query ? `${query} ${c.label}` : c.label)}>
                        {c.label}
                        <span className="numeric ml-1 text-t3">{n}</span>
                      </Chip>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </Section>

        {/* detections */}
        <Section title="Detected in these photos" icon="scan" dense defaultOpen={false}>
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {byLabel.map(([label, idsForLabel]) => (
              <Chip key={label} icon="scan" onClick={() => { selectAll(idsForLabel); toast.info(label, `${idsForLabel.length} photos selected.`); }}>
                {label}
                <span className="numeric ml-1 text-t3">{idsForLabel.length}</span>
              </Chip>
            ))}
            {!byLabel.length && <p className="px-1 py-1 text-2xs text-t3">Nothing detected yet — indexing runs in the background.</p>}
          </div>
        </Section>

        {/* people & privacy */}
        <Section title="People & privacy" icon="people" dense defaultOpen={false}>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Switch
              checked={ai.faceRecognition}
              label="Face recognition"
              description="Opt-in. Faces are embedded on this device and never uploaded."
              onChange={(v) => setAi('ai', { faceRecognition: v })}
            />
            <Switch checked={ai.autoKeywords} label="Auto keywords" onChange={(v) => setAi('ai', { autoKeywords: v })} />
            <Switch checked={ai.distractionDetection} label="Distraction detection" onChange={(v) => setAi('ai', { distractionDetection: v })} />
            <Select
              size="sm"
              ariaLabel="Index schedule"
              value={ai.indexSchedule}
              options={[
                { value: 'always', label: 'Index always' },
                { value: 'idle', label: 'When idle' },
                { value: 'manual', label: 'Manual only' },
              ]}
              onChange={(v) => setAi('ai', { indexSchedule: v as 'always' | 'idle' | 'manual' })}
            />
            <Button
              size="xs"
              variant="danger"
              icon="shield"
              onClick={() => {
                deleteAllFaceData();
                toast.ok('Face data deleted', 'Every face embedding and cluster was removed from this device.');
              }}
            >
              Delete all face data
            </Button>
            <Button size="xs" variant="subtle" icon="download" onClick={() => setUiModels(true)}>
              Models manager
            </Button>
          </div>
        </Section>

        {/* index queue */}
        <Section title="Index queue" icon="database" dense defaultOpen={false}>
          <div className="px-1 pb-1">
            <div className="numeric mb-1 text-2xs text-t3">
              {indexed.length}/{order.length} indexed
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-s3">
              <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${order.length ? (indexed.length / order.length) * 100 : 0}%` }} />
            </div>
            <div className="mt-1.5 flex gap-1">
              <Button size="xs" variant="subtle" icon="refresh" onClick={() => void reindex()}>
                Re-index all
              </Button>
              <Badge tone="muted">model_ver {indexed[0] ? features[indexed[0]]?.modelVer : '—'}</Badge>
            </div>
          </div>
        </Section>
      </div>

      {/* right: results */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 px-2">
          <span className="numeric text-2xs text-t3">
            {mode === 'similar' ? `${similar.length} similar` : mode === 'color' ? `${colorHits.length} colour matches` : mode === 'duplicates' ? `${dupes.length} groups` : `${ids.length} results`}
          </span>
          {ids.length > 0 && (
            <>
              <Button size="xs" variant="ghost" icon="check" onClick={() => selectAll(ids)}>
                Select all
              </Button>
              <Button size="xs" variant="ghost" icon="plus" onClick={() => {
                const cid = createCollection(query || 'Smart result', 'smart');
                addToCollection(cid, ids);
                toast.ok('Smart collection created', `"${query || 'Smart result'}" · ${ids.length} photos`);
              }}>
                Save as collection
              </Button>
              <Button size="xs" variant="subtle" icon="develop" onClick={() => go('develop')}>
                Develop
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Badge tone="ok">On-device</Badge>
            <IconButton name="settings" size={14} box="sm" label="Smart settings" onClick={() => go('export')} />
          </div>
        </div>

        {mode === 'semantic' && (
          <PhotoGrid
            ids={ids}
            className="px-2 pb-3"
            emptyLabel={query ? 'No matches — try fewer words or a concept chip.' : 'Type a description to search your catalog.'}
            cellFooter={(p) => <ExplanationRow id={p.id} why={explanations[p.id]} />}
          />
        )}
        {mode === 'similar' && <PhotoGrid ids={similar.map((h) => h.id)} className="px-2 pb-3" emptyLabel="Choose a photo and run “Find similar”." />}
        {mode === 'color' && <PhotoGrid ids={colorHits.map((h) => h.id)} className="px-2 pb-3" emptyLabel="Pick a colour and search." />}
        {mode === 'duplicates' && <PhotoGrid ids={dupes.flatMap((g) => g.ids)} className="px-2 pb-3" emptyLabel="Run the duplicate finder." />}
      </div>
    </div>
  );

  /* ------------------------------------------------------------ helpers */

  function setUiModels(v: boolean) {
    useUi.getState().setModels(v);
  }

  async function reindex() {
    const list = order.map((id) => photos[id]).filter((p): p is Photo => !!p);
    toast.info('Re-indexing', `${list.length} photos queued on-device.`);
    await analysisClient.reindexAll(list);
    toast.ok('Index complete', 'Concept scores refreshed.');
  }
}

function ExplanationRow({ id, why }: { id: string; why?: { conceptId: string; label: string; score: number }[] }) {
  if (!why || !why.length) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-0.5">
      {why.slice(0, 3).map((w) => (
        <Tooltip key={w.conceptId} label={`${CONCEPT_BY_ID.get(w.conceptId)?.label ?? w.label} · match ${(w.score * 100).toFixed(0)}%`} placement="top">
          <span className={cx('numeric rounded-[5px] px-1 text-[9px]', w.score > 0.6 ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'bg-s2 text-t3')}>
            {w.label}
          </span>
        </Tooltip>
      ))}
      <span className="sr-only">photo {id}</span>
    </div>
  );
}

/** Schema features → the richer shape the shared concept math expects. */
function toImageFeatures(f: PhotoFeatures, p: Photo): ImageFeatures {
  return {
    width: p.width,
    height: p.height,
    meanLuma: f.meanLuma,
    stdLuma: f.stdLuma,
    clippedHighlights: f.clippedHighlights,
    clippedShadows: f.clippedShadows,
    contrast: f.contrast,
    sharpness: f.sharpness,
    blurScore: f.blurScore,
    skinRatio: f.skinRatio,
    skyRatio: f.skyRatio,
    greenRatio: f.greenRatio,
    warmCool: f.warmCool,
    horizonTilt: f.horizonTilt,
    edgeDensity: f.edgeDensity,
    saturationMean: f.saturationMean,
    isMonochrome: f.isMonochrome,
    exposureScore: f.exposureScore,
    palette: f.palette.map((c) => ({ css: c.css, weight: c.weight, oklch: { l: c.l, c: c.c, h: c.h } }) as PaletteColor),
    lumaHistogram: new Float32Array(256),
    rgbHistogram: new Float32Array(768),
    dhash: f.dhash,
    ahash: f.ahash,
    ruleOfThirds: [],
    provider: 'heuristic',
  };
}

export default SmartPage;
