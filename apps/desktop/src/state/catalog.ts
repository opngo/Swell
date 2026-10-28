import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useMemo } from 'react';
import {
  emptyFilter,
  type Collection,
  type Detection,
  type FilterSpec,
  type Folder,
  type Keyword,
  type MetadataFacet,
  type Photo,
  type PhotoFeatures,
  type SmartRule,
  type SortSpec,
  type Task,
  type Volume,
} from '@swell/schema';
import {
  demoCollections,
  demoDetections,
  demoFolders,
  demoKeywordIndex,
  demoKeywords,
  demoPhotos,
  demoVolumes,
} from '@/lib/demoCatalog.ts';
import { idbAll, idbGet, idbSet, persistDebounced } from '@/lib/persist.ts';
import { fuzzyContains } from '@swell/shared';

/* -------------------------------------------------------------------------- */
/*  Catalog store (§7)                                                         */
/* -------------------------------------------------------------------------- */

export type SourceKind = 'library' | 'folder' | 'collection' | 'quick' | 'search' | 'recent' | 'flagged';

export interface SelectionSource {
  kind: SourceKind;
  id?: string;
  label: string;
}

interface CatalogState {
  ready: boolean;
  photos: Record<string, Photo>;
  order: string[];
  folders: Folder[];
  volumes: Volume[];
  collections: Collection[];
  keywords: Keyword[];
  keywordIndex: Record<string, string[]>;
  detections: Record<string, Detection[]>;
  features: Record<string, PhotoFeatures>;
  tasks: Task[];

  selection: string[];
  anchorId: string | null;
  source: SelectionSource;

  query: string;
  filter: FilterSpec;
  sort: SortSpec;
  gridSize: number;
  collapseStacks: boolean;
  showRejected: boolean;

  hydrate: () => Promise<void>;
  setSource: (s: SelectionSource) => void;
  select: (id: string, opts?: { additive?: boolean; range?: boolean; exclusive?: boolean }) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  activeId: () => string | null;

  updatePhoto: (id: string, patch: Partial<Photo>) => void;
  updateMany: (ids: string[], patch: Partial<Photo> | ((p: Photo) => Partial<Photo>)) => void;
  rate: (ids: string[], rating: number) => void;
  flag: (ids: string[], flag: Photo['flag']) => void;
  label: (ids: string[], color: Photo['colorLabel']) => void;
  addKeywords: (ids: string[], keywordIds: string[]) => void;
  removeKeyword: (id: string, keywordId: string) => void;
  /** Create (or find) a keyword and return its id. */
  createKeyword: (name: string, parentId?: string) => string;
  addPhotos: (photos: Photo[], opts?: { folderId?: string }) => void;
  deletePhotos: (ids: string[]) => void;
  stackWith: (ids: string[], stackId: string) => void;
  unstack: (ids: string[]) => void;
  toggleQuick: (ids: string[]) => void;

  createCollection: (name: string, kind?: Collection['kind'], rules?: SmartRule[]) => string;
  deleteCollection: (id: string) => void;
  renameCollection: (id: string, name: string) => void;
  addToCollection: (collectionId: string, photoIds: string[]) => void;
  removeFromCollection: (collectionId: string, photoIds: string[]) => void;

  setQuery: (q: string) => void;
  setFilter: (f: FilterSpec) => void;
  patchFilter: (p: Partial<FilterSpec>) => void;
  addFacet: (f: MetadataFacet) => void;
  removeFacet: (f: MetadataFacet) => void;
  setSort: (s: SortSpec) => void;
  setGridSize: (px: number) => void;
  setCollapseStacks: (v: boolean) => void;
  setShowRejected: (v: boolean) => void;

  setFeatures: (photoId: string, f: PhotoFeatures) => void;
  setDetections: (photoId: string, d: Detection[]) => void;
  addTask: (t: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;
  deleteAllFaceData: () => void;
}

const QUICK = 'col-quick';
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

/* ------------------------------------------------------------ smart rules */

function ruleMatches(p: Photo, rule: SmartRule, features?: PhotoFeatures): boolean {
  const v = rule.value;
  const num = typeof v === 'number' ? v : Number(v);
  switch (rule.field) {
    case 'rating':
      return cmp(p.rating, rule.op, num);
    case 'flag':
      return p.flag === v;
    case 'label':
      return p.colorLabel === v;
    case 'camera':
      return String(v).toLowerCase() === p.camera.toLowerCase();
    case 'lens':
      return p.lens.toLowerCase().includes(String(v).toLowerCase());
    case 'iso':
      return cmp(p.iso, rule.op, num);
    case 'aperture':
      return cmp(p.aperture, rule.op, num);
    case 'shutter':
      return cmp(p.shutter, rule.op, num);
    case 'focal':
      return cmp(p.focalMm, rule.op, num);
    case 'aspect':
      return cmp(p.width / (p.height || 1), rule.op, num);
    case 'edited':
      return rule.op === 'is' ? p.hasEdits === !!v : !!p.hasEdits === (rule.op === 'isNot');
    case 'date':
      return String(v) ? p.captureTime.startsWith(String(v)) : true;
    case 'keyword':
      return false; // resolved by the caller (needs the keyword index)
    case 'detected':
    case 'scene':
    case 'person':
      return false; // resolved by the caller (needs detections)
    case 'sharpness':
      return features ? cmp(features.sharpness, rule.op, num) : false;
    case 'exposure':
      return features ? cmp(features.exposureScore, rule.op, num) : false;
    case 'clipping':
      return features ? cmp(Math.max(features.clippedHighlights, features.clippedShadows), rule.op, num) : false;
    default:
      return false;
  }
}

function cmp(a: number, op: SmartRule['op'], b: number): boolean {
  switch (op) {
    case 'is': return a === b;
    case 'isNot': return a !== b;
    case 'greaterThan': return a > b;
    case 'lessThan': return a < b;
    case 'between': return a >= b; // upper bound is carried by the caller's value2
    case 'exists':
    case 'notExists':
    case 'contains':
    case 'before':
    case 'after': return true;
    default: return false;
  }
}

export function evaluateCollection(
  c: Collection,
  photos: Record<string, Photo>,
  order: string[],
  keywordIndex: Record<string, string[]>,
  detections: Record<string, Detection[]>,
  features: Record<string, PhotoFeatures>,
): string[] {
  if (c.kind !== 'smart') return c.photoIds.filter((id) => photos[id]);
  const out: string[] = [];
  for (const id of order) {
    const p = photos[id];
    if (!p) continue;
    const kw = keywordIndex[id] ?? [];
    const det = detections[id] ?? [];
    const results = c.rules.map((rule) => {
      if (rule.field === 'keyword') {
        const want = String(rule.value).toLowerCase();
        return kw.some((k) => k.toLowerCase().includes(want));
      }
      if (rule.field === 'detected' || rule.field === 'scene' || rule.field === 'person') {
        const want = String(rule.value).toLowerCase();
        return det.some((d) => d.label.toLowerCase().includes(want));
      }
      return ruleMatches(p, rule, features[id]);
    });
    const ok = c.match === 'all' ? results.every(Boolean) : results.some(Boolean);
    if (ok) out.push(id);
  }
  return out;
}

/* ---------------------------------------------------------------- sorting */

export function sortIds(ids: string[], photos: Record<string, Photo>, sort: SortSpec): string[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  const key = (id: string): number | string => {
    const p = photos[id];
    if (!p) return '';
    switch (sort.field) {
      case 'captureTime': return Date.parse(p.captureTime) || 0;
      case 'addedTime': return p.addedTime;
      case 'filename': return p.filename.toLowerCase();
      case 'editedAt': return p.editedAt;
      case 'rating': return p.rating;
      case 'aspect': return p.width / (p.height || 1);
      case 'fileType': return p.ext;
      default: return 0;
    }
  };
  return [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return a.localeCompare(b);
  });
}

/* --------------------------------------------------------------- the store */

export const useCatalog = create<CatalogState>()(
  immer((set, get) => ({
    ready: false,
    photos: {},
    order: [],
    folders: demoFolders,
    volumes: demoVolumes,
    collections: demoCollections,
    keywords: demoKeywords,
    keywordIndex: { ...demoKeywordIndex },
    detections: (() => {
      const out: Record<string, Detection[]> = {};
      for (const d of demoDetections) (out[d.photoId] ??= []).push(d);
      return out;
    })(),
    features: {},
    tasks: [],

    selection: [],
    anchorId: null,
    source: { kind: 'library', label: 'All Photographs' },

    query: '',
    filter: emptyFilter(),
    sort: { field: 'captureTime', direction: 'desc' },
    gridSize: 168,
    collapseStacks: true,
    showRejected: true,

    hydrate: async () => {
      const stored = await idbGet<{ photos: Record<string, Photo>; order: string[]; collections: Collection[]; keywordIndex: Record<string, string[]> }>(
        'kv',
        'catalog.v1',
      ).catch(() => undefined);

      const featuresRows = await idbAll<PhotoFeatures>('features').catch(() => [] as { key: string; value: PhotoFeatures }[]);
      const features: Record<string, PhotoFeatures> = {};
      for (const { key, value } of featuresRows) features[key] = value;

      set((st) => {
        if (stored?.photos && Object.keys(stored.photos).length) {
          st.photos = stored.photos;
          st.order = stored.order ?? Object.keys(stored.photos);
          if (stored.collections?.length) st.collections = stored.collections;
          if (stored.keywordIndex) st.keywordIndex = stored.keywordIndex;
        } else {
          st.photos = Object.fromEntries(demoPhotos.map((p) => [p.id, p]));
          st.order = demoPhotos.map((p) => p.id);
        }
        st.features = features;
        st.ready = true;
      });

      // keep the persisted snapshot fresh
      const s = get();
      void idbSet('kv', 'catalog.v1', {
        photos: s.photos,
        order: s.order,
        collections: s.collections,
        keywordIndex: s.keywordIndex,
      }).catch(() => undefined);
    },

    setSource: (source) => set((st) => { st.source = source; }),

    select: (id, opts) =>
      set((st) => {
        const photo = st.photos[id];
        if (!photo) return;
        if (opts?.range && st.anchorId) {
          const list = currentVisible(st);
          const a = list.indexOf(st.anchorId);
          const b = list.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            st.selection = list.slice(lo, hi + 1);
            return;
          }
        }
        if (opts?.additive) {
          st.selection = st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id];
        } else {
          st.selection = [id];
        }
        st.anchorId = id;
      }),

    selectAll: (ids) => set((st) => { st.selection = ids; st.anchorId = ids[0] ?? null; }),
    clearSelection: () => set((st) => { st.selection = []; st.anchorId = null; }),
    activeId: () => {
      const s = get();
      return s.selection[s.selection.length - 1] ?? s.order[0] ?? null;
    },

    updatePhoto: (id, patch) =>
      set((st) => {
        const p = st.photos[id];
        if (!p) return;
        Object.assign(p, patch);
      }),

    updateMany: (ids, patch) =>
      set((st) => {
        for (const id of ids) {
          const p = st.photos[id];
          if (!p) continue;
          Object.assign(p, typeof patch === 'function' ? patch(p) : patch);
        }
        queuePersist();
      }),

    rate: (ids, rating) => {
      set((st) => {
        for (const id of ids) {
          const p = st.photos[id];
          if (p) p.rating = rating;
        }
      });
      queuePersist();
    },

    flag: (ids, flag) => {
      set((st) => {
        for (const id of ids) {
          const p = st.photos[id];
          if (p) p.flag = flag;
        }
      });
      queuePersist();
    },

    label: (ids, colorLabel) => {
      set((st) => {
        for (const id of ids) {
          const p = st.photos[id];
          if (p) p.colorLabel = colorLabel;
        }
      });
      queuePersist();
    },

    addKeywords: (ids, keywordIds) =>
      set((st) => {
        for (const id of ids) {
          const cur = st.keywordIndex[id] ?? [];
          st.keywordIndex[id] = [...new Set([...cur, ...keywordIds])];
        }
        queuePersist();
      }),

    removeKeyword: (id, keywordId) =>
      set((st) => {
        st.keywordIndex[id] = (st.keywordIndex[id] ?? []).filter((k) => k !== keywordId);
        queuePersist();
      }),

    createKeyword: (name, parentId) => {
      const clean = name.trim().toLowerCase();
      const existing = get().keywords.find((k) => k.name.toLowerCase() === clean);
      if (existing) return existing.id;
      const id = `kw-${clean.replace(/[^a-z0-9]+/g, '-')}`;
      set((st) => {
        st.keywords.push({ id, name: name.trim(), parentId, synonyms: [], exportFlag: true });
        queuePersist();
      });
      return id;
    },

    addPhotos: (photos, opts) =>
      set((st) => {
        for (const p of photos) {
          const withFolder = opts?.folderId ? { ...p, folderId: opts.folderId } : p;
          st.photos[withFolder.id] = withFolder;
          if (!st.order.includes(withFolder.id)) st.order.unshift(withFolder.id);
        }
        queuePersist();
      }),

    deletePhotos: (ids) =>
      set((st) => {
        for (const id of ids) {
          delete st.photos[id];
          st.order = st.order.filter((x) => x !== id);
          st.selection = st.selection.filter((x) => x !== id);
          delete st.features[id];
          delete st.detections[id];
          delete st.keywordIndex[id];
          for (const c of st.collections) c.photoIds = c.photoIds.filter((x) => x !== id);
        }
        queuePersist();
      }),

    stackWith: (ids, stackId) =>
      set((st) => {
        ids.forEach((id, i) => {
          const p = st.photos[id];
          if (p) {
            p.stackId = stackId;
            p.stackPosition = i;
          }
        });
        queuePersist();
      }),

    unstack: (ids) =>
      set((st) => {
        for (const id of ids) {
          const p = st.photos[id];
          if (p) {
            p.stackId = undefined;
            p.stackPosition = 0;
          }
        }
        queuePersist();
      }),

    toggleQuick: (ids) =>
      set((st) => {
        const q = st.collections.find((c) => c.id === QUICK);
        if (!q) return;
        for (const id of ids) {
          q.photoIds = q.photoIds.includes(id) ? q.photoIds.filter((x) => x !== id) : [...q.photoIds, id];
        }
        queuePersist();
      }),

    createCollection: (name, kind = 'manual', rules = []) => {
      const id = uid('col');
      set((st) => {
        st.collections.push({
          id,
          name,
          kind,
          rules,
          match: 'all',
          photoIds: kind === 'manual' ? [...st.selection] : [],
          sortOrder: 'manual',
          createdAt: Date.now(),
        });
        queuePersist();
      });
      return id;
    },

    deleteCollection: (id) =>
      set((st) => {
        if (id === QUICK) return;
        st.collections = st.collections.filter((c) => c.id !== id);
        queuePersist();
      }),

    renameCollection: (id, name) =>
      set((st) => {
        const c = st.collections.find((x) => x.id === id);
        if (c) c.name = name;
        queuePersist();
      }),

    addToCollection: (collectionId, photoIds) =>
      set((st) => {
        const c = st.collections.find((x) => x.id === collectionId);
        if (!c) return;
        c.photoIds = [...new Set([...c.photoIds, ...photoIds])];
        queuePersist();
      }),

    removeFromCollection: (collectionId, photoIds) =>
      set((st) => {
        const c = st.collections.find((x) => x.id === collectionId);
        if (!c) return;
        c.photoIds = c.photoIds.filter((id) => !photoIds.includes(id));
        queuePersist();
      }),

    setQuery: (query) => set((st) => { st.query = query; }),
    setFilter: (filter) => set((st) => { st.filter = filter; }),
    patchFilter: (p) => set((st) => { Object.assign(st.filter, p); }),
    addFacet: (f) =>
      set((st) => {
        if (!st.filter.facets.some((x) => x.field === f.field && x.value === f.value)) st.filter.facets.push(f);
      }),
    removeFacet: (f) =>
      set((st) => {
        st.filter.facets = st.filter.facets.filter((x) => !(x.field === f.field && x.value === f.value));
      }),
    setSort: (sort) => set((st) => { st.sort = sort; }),
    setGridSize: (px) => set((st) => { st.gridSize = Math.max(88, Math.min(420, px)); }),
    setCollapseStacks: (v) => set((st) => { st.collapseStacks = v; }),
    setShowRejected: (v) => set((st) => { st.showRejected = v; }),

    setFeatures: (photoId, f) =>
      set((st) => {
        st.features[photoId] = f;
        const p = st.photos[photoId];
        if (p && p.indexState !== 'indexed') p.indexState = 'indexed';
      }),

    setDetections: (photoId, d) =>
      set((st) => {
        st.detections[photoId] = d;
      }),

    addTask: (t) => set((st) => { st.tasks = [t, ...st.tasks].slice(0, 60); }),
    updateTask: (id, patch) =>
      set((st) => {
        const t = st.tasks.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
      }),
    removeTask: (id) => set((st) => { st.tasks = st.tasks.filter((t) => t.id !== id); }),

    deleteAllFaceData: () =>
      set((st) => {
        for (const id of Object.keys(st.detections)) {
          st.detections[id] = st.detections[id].filter((d) => d.kind !== 'face');
        }
        for (const p of Object.values(st.photos)) {
          // faces are stored separately; nothing else to strip
          void p;
        }
      }),
  })),
);

/* the store keeps `persist` off the interface (internal helper) */
function queuePersist() {
  const s = useCatalog.getState();
  persistDebounced(
    'kv',
    'catalog.v1',
    { photos: s.photos, order: s.order, collections: s.collections, keywordIndex: s.keywordIndex },
    700,
  );
}

/** Ordered ids that belong to the current source, before filtering. */
function sourceIds(st: Pick<CatalogState, 'source' | 'order' | 'photos' | 'collections' | 'keywordIndex' | 'detections' | 'features'>): string[] {
  const { source } = st;
  if (source.kind === 'folder') return st.order.filter((id) => st.photos[id]?.folderId === source.id);
  if (source.kind === 'collection' || source.kind === 'quick') {
    const c = st.collections.find((x) => x.id === source.id);
    if (!c) return [];
    if (c.kind === 'set') {
      const out = new Set<string>();
      for (const childId of c.photoIds) {
        const child = st.collections.find((x) => x.id === childId);
        if (!child) continue;
        for (const id of evaluateCollection(child, st.photos, st.order, st.keywordIndex, st.detections, st.features)) out.add(id);
      }
      return [...out];
    }
    return evaluateCollection(c, st.photos, st.order, st.keywordIndex, st.detections, st.features);
  }
  if (source.kind === 'recent') return [...st.order].sort((a, b) => (st.photos[b]?.addedTime ?? 0) - (st.photos[a]?.addedTime ?? 0));
  if (source.kind === 'flagged') return st.order.filter((id) => (st.photos[id]?.flag ?? 'none') !== 'none');
  return st.order;
}

function currentVisible(st: CatalogState): string[] {
  return applyFilters(sourceIds(st), st);
}

export function applyFilters(ids: string[], st: CatalogState): string[] {
  const { photos, query, filter, keywordIndex, detections, showRejected } = st;
  let out = ids.filter((id) => photos[id]);

  if (!showRejected) out = out.filter((id) => photos[id]?.flag !== 'reject');

  const attr = filter.attribute;
  if (attr) {
    if (attr.flags?.length) out = out.filter((id) => attr.flags!.includes(photos[id].flag));
    if (attr.minRating) out = out.filter((id) => photos[id].rating >= attr.minRating!);
    if (attr.labels?.length) out = out.filter((id) => attr.labels!.includes(photos[id].colorLabel));
    if (attr.editState === 'edited') out = out.filter((id) => photos[id].hasEdits);
    if (attr.editState === 'unedited') out = out.filter((id) => !photos[id].hasEdits);
    if (attr.fileType && attr.fileType !== 'any') {
      out = out.filter((id) => {
        const ext = photos[id].ext.toLowerCase();
        if (attr.fileType === 'raw') return ['cr2', 'cr3', 'nef', 'arw', 'raf', 'dng', 'orf'].includes(ext);
        if (attr.fileType === 'jpeg') return ext === 'jpg' || ext === 'jpeg';
        return ext === attr.fileType;
      });
    }
  }

  if (filter.range?.from || filter.range?.to) {
    const from = filter.range.from ? Date.parse(filter.range.from) : -Infinity;
    const to = filter.range.to ? Date.parse(filter.range.to) : Infinity;
    out = out.filter((id) => {
      const t = Date.parse(photos[id].captureTime);
      return t >= from && t <= to;
    });
  }

  for (const facet of filter.facets) {
    out = out.filter((id) => {
      const p = photos[id];
      switch (facet.field) {
        case 'camera': return p.camera.toLowerCase().includes(facet.value.toLowerCase());
        case 'lens': return p.lens.toLowerCase().includes(facet.value.toLowerCase());
        case 'iso': return String(p.iso) === facet.value;
        case 'aperture': return String(p.aperture) === facet.value;
        case 'focal': return String(p.focalMm) === facet.value;
        case 'date': return p.captureTime.startsWith(facet.value);
        case 'keyword': return (keywordIndex[id] ?? []).some((k) => k.toLowerCase().includes(facet.value.toLowerCase()));
        case 'detected':
        case 'scene':
          return (detections[id] ?? []).some((d) => d.label.toLowerCase().includes(facet.value.toLowerCase()));
        case 'person':
          return (detections[id] ?? []).some((d) => d.kind === 'face' && d.label.toLowerCase().includes(facet.value.toLowerCase()));
        default: return true;
      }
    });
  }

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    out = out.filter((id) => {
      const p = photos[id];
      const kws = (keywordIndex[id] ?? []).map((k) => k.replace('kw-', '').replace(/_/g, ' '));
      const dets = (detections[id] ?? []).map((d) => d.label);
      const hay = [p.filename, p.title, p.caption, p.camera, p.lens, p.creator, p.gps?.place ?? '', ...kws, ...dets];
      if (hay.some((h) => fuzzyContains(h, q))) return true;
      // natural-language-ish: "sunset dog beach" → every term must hit somewhere
      const terms = q.split(/\s+/).filter(Boolean);
      return terms.length > 1 && terms.every((t) => hay.some((h) => h.toLowerCase().includes(t)));
    });
  }

  // stacks collapse to their top member
  if (st.collapseStacks) {
    const seen = new Set<string>();
    out = out.filter((id) => {
      const p = photos[id];
      if (!p.stackId) return true;
      if (seen.has(p.stackId)) return false;
      seen.add(p.stackId);
      return true;
    });
  }

  return sortIds(out, photos, st.sort);
}

/* ------------------------------------------------------------- selectors */

/** Reactive list of visible photo ids for the current source + filters. */
export function useVisibleIds(): string[] {
  const st = useCatalog();
  return useMemo(
    () => applyFilters(sourceIds(st), st),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      st.order, st.photos, st.collections, st.keywordIndex, st.detections, st.features,
      st.source, st.query, st.filter, st.sort, st.collapseStacks, st.showRejected,
    ],
  );
}

export function usePhoto(id: string | null | undefined): Photo | undefined {
  const photos = useCatalog((s) => s.photos);
  return id ? photos[id] : undefined;
}

export function useStackMembers(stackId: string | undefined): string[] {
  const photos = useCatalog((s) => s.photos);
  return useMemo(
    () =>
      stackId
        ? Object.values(photos)
            .filter((p) => p.stackId === stackId)
            .sort((a, b) => a.stackPosition - b.stackPosition)
            .map((p) => p.id)
        : [],
    [photos, stackId],
  );
}

export const getCatalog = () => useCatalog.getState();
