import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  defaultParams,
  diffParams,
  applyDiff,
  parseParams,
  paramFragmentSchema,
  type DevelopParams,
  type HistoryEntry,
  type ParamFragment,
  type Preset,
  type PresetInput,
  type Profile,
  type Snapshot,
} from '@swell/schema';
import { uid } from '@swell/shared';
import { idbAll, idbGet, idbSet, persistDebounced } from '@/lib/persist.ts';
import { BUILTIN_PRESETS, BUILTIN_PROFILES } from '@/lib/builtinPresets.ts';

/* -------------------------------------------------------------------------- */
/*  Develop store (§7.2, §9)                                                   */
/*                                                                             */
/*  Params live here as the committed truth. Live dragging happens in the      */
/*  Jotai `liveParamsAtom` (see state/atoms.ts) so a drag never walks the      */
/*  React tree; `commit()` folds the live value back in and writes exactly     */
/*  ONE history entry per gesture.                                             */
/* -------------------------------------------------------------------------- */

export interface Version {
  id: string;
  photoId: string;
  name: string;
  params: DevelopParams;
  ts: number;
}

interface DevelopState {
  ready: boolean;
  params: Record<string, DevelopParams>;
  /** the doc the first history entry for a photo was applied to */
  base: Record<string, DevelopParams>;
  history: Record<string, HistoryEntry[]>;
  /** index of the entry the photo is currently at (branching history) */
  head: Record<string, number>;
  presets: Preset[];
  profiles: Profile[];
  snapshots: Snapshot[];
  versions: Version[];
  /** gesture in flight: params captured when the drag started */
  gesture: { photoId: string; before: DevelopParams; startedAt: number } | null;

  hydrate: () => Promise<void>;
  getParams: (photoId: string) => DevelopParams;
  /** write params without a history entry (used by live drags + migrations) */
  setLive: (photoId: string, params: DevelopParams) => void;
  /** patch + commit in one step (programmatic changes, presets, batch) */
  commit: (photoId: string, next: DevelopParams | ((p: DevelopParams) => DevelopParams), label: string) => void;
  /** deep patch by dotted path: `patch(id, {'tone.exposure': 0.4}, 'Exposure')` */
  patch: (photoId: string, paths: Record<string, unknown>, label: string) => void;
  beginGesture: (photoId: string) => void;
  endGesture: (photoId: string, label: string) => void;
  cancelGesture: (photoId: string) => void;

  undo: (photoId: string) => string | null;
  redo: (photoId: string) => string | null;
  jumpTo: (photoId: string, index: number) => void;
  resetAll: (photoId: string) => void;
  resetGroup: (photoId: string, group: string) => void;
  copyParams: (from: string) => DevelopParams;
  pasteParams: (to: string[], params: DevelopParams, groups?: string[]) => void;

  addPreset: (input: PresetInput) => string;
  deletePreset: (id: string) => void;
  togglePresetFavorite: (id: string) => void;
  applyPreset: (photoIds: string[], presetId: string, amount: number) => void;
  applyProfile: (photoId: string, profileId: string) => void;

  addSnapshot: (photoId: string, name: string) => string;
  applySnapshot: (photoId: string, snapshotId: string) => void;
  deleteSnapshot: (id: string) => void;

  addVersion: (photoId: string, name: string) => string;
  applyVersion: (photoId: string, versionId: string) => void;
  deleteVersion: (id: string) => void;
}

function setPath(doc: DevelopParams, path: string, value: unknown): DevelopParams {
  const parts = path.split('.');
  const clone: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    cur[key] = typeof next === 'object' && next !== null ? { ...(next as Record<string, unknown>) } : {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return parseParams(clone);
}

/** Amount-scaled merge used by presets (0–200 %). */
function scalePreset(base: DevelopParams, patch: ParamFragment, amount: number): DevelopParams {
  const k = amount / 100;
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const cur = (base as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number' && typeof cur === 'number') {
      out[key] = cur + (value - cur) * k;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested: Record<string, unknown> = { ...(cur as Record<string, unknown> ?? {}) };
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        const cv = nested[nk];
        if (typeof nv === 'number' && typeof cv === 'number') nested[nk] = cv + (nv - cv) * k;
        else nested[nk] = nv;
      }
      out[key] = nested;
    } else {
      out[key] = value;
    }
  }
  return parseParams(out);
}

export const useDevelop = create<DevelopState>()(
  immer((set, get) => ({
    ready: false,
    params: {},
    base: {},
    history: {},
    head: {},
    presets: [...BUILTIN_PRESETS],
    profiles: [...BUILTIN_PROFILES],
    snapshots: [],
    versions: [],
    gesture: null,

    hydrate: async () => {
      const stored = await idbGet<Record<string, unknown>>('kv', 'develop.v1').catch(() => undefined);
      const paramRows = await idbAll<DevelopParams>('params').catch(() => [] as { key: string; value: DevelopParams }[]);
      const presetRows = await idbGet<Preset[]>('kv', 'presets.v1').catch(() => undefined);
      const snapshotRows = await idbGet<Snapshot[]>('kv', 'snapshots.v1').catch(() => undefined);
      const versionRows = await idbGet<Version[]>('kv', 'versions.v1').catch(() => undefined);
      const historyRows = await idbGet<Record<string, HistoryEntry[]>>('kv', 'history.v1').catch(() => undefined);
      const baseRows = await idbGet<Record<string, DevelopParams>>('kv', 'params.base.v1').catch(() => undefined);

      set((st) => {
        st.params = {};
        for (const { key, value } of paramRows) {
          try {
            st.params[key] = parseParams(value);
          } catch {
            st.params[key] = defaultParams();
          }
        }
        if (stored && Object.keys(st.params).length === 0) {
          for (const [k, v] of Object.entries(stored)) {
            try {
              st.params[k] = parseParams(v);
            } catch {
              /* skip corrupt rows */
            }
          }
        }
        if (historyRows) {
          st.history = historyRows;
          for (const [k, v] of Object.entries(historyRows)) st.head[k] = v.length - 1;
        }
        if (baseRows) st.base = baseRows;
        if (presetRows?.length) st.presets = [...presetRows, ...BUILTIN_PRESETS.filter((p) => p.group !== 'user')];
        if (snapshotRows) st.snapshots = snapshotRows;
        if (versionRows) st.versions = versionRows;
        st.ready = true;
      });
    },

    getParams: (photoId) => get().params[photoId] ?? defaultParams(),

    setLive: (photoId, params) =>
      set((st) => {
        st.params[photoId] = params;
      }),

    commit: (photoId, next, label) =>
      set((st) => {
        const before = st.params[photoId] ?? defaultParams();
        const value = typeof next === 'function' ? next(before) : next;
        const diff = diffParams(before, value) as Record<string, unknown>;
        if (Object.keys(diff).length === 0) return;
        st.params[photoId] = value;
        pushHistory(st, photoId, label, diff, before);
        queuePersistParams(photoId, value);
        persistMeta(st);
      }),

    patch: (photoId, paths, label) =>
      set((st) => {
        let doc = st.params[photoId] ?? defaultParams();
        for (const [path, value] of Object.entries(paths)) doc = setPath(doc, path, value);
        const before = st.params[photoId] ?? defaultParams();
        const diff = diffParams(before, doc) as Record<string, unknown>;
        st.params[photoId] = doc;
        if (Object.keys(diff).length) pushHistory(st, photoId, label, diff, before);
        queuePersistParams(photoId, doc);
        persistMeta(st);
      }),

    beginGesture: (photoId) =>
      set((st) => {
        st.gesture = { photoId, before: st.params[photoId] ?? defaultParams(), startedAt: Date.now() };
      }),

    endGesture: (photoId, label) =>
      set((st) => {
        const g = st.gesture;
        st.gesture = null;
        if (!g || g.photoId !== photoId) return;
        const after = st.params[photoId] ?? defaultParams();
        const diff = diffParams(g.before, after) as Record<string, unknown>;
        if (Object.keys(diff).length === 0) return;
        pushHistory(st, photoId, label, diff, g.before);
        queuePersistParams(photoId, after);
        persistMeta(st);
      }),

    cancelGesture: (photoId) =>
      set((st) => {
        const g = st.gesture;
        st.gesture = null;
        if (g && g.photoId === photoId) st.params[photoId] = g.before;
      }),

    undo: (photoId) => {
      let label: string | null = null;
      set((st) => {
        const list = st.history[photoId];
        const head = st.head[photoId] ?? -1;
        if (!list || head < 0) return;
        const entry = list[head]!;
        const doc = fold(st.base[photoId] ?? defaultParams(), list.slice(0, head));
        st.params[photoId] = doc;
        st.head[photoId] = head - 1;
        label = entry.label;
        queuePersistParams(photoId, st.params[photoId]);
        persistMeta(st);
      });
      return label;
    },

    redo: (photoId) => {
      let label: string | null = null;
      set((st) => {
        const list = st.history[photoId];
        const head = st.head[photoId] ?? -1;
        if (!list || head >= list.length - 1) return;
        const entry = list[head + 1]!;
        const doc = applyDiff(st.params[photoId] as unknown as Record<string, unknown>, entry.diff as Record<string, unknown>);
        st.params[photoId] = parseParams(doc);
        st.head[photoId] = head + 1;
        label = entry.label;
        queuePersistParams(photoId, st.params[photoId]);
        persistMeta(st);
      });
      return label;
    },

    jumpTo: (photoId, index) =>
      set((st) => {
        const list = st.history[photoId];
        if (!list) return;
        const clamped = Math.max(-1, Math.min(list.length - 1, index));
        st.params[photoId] = fold(st.base[photoId] ?? defaultParams(), list.slice(0, clamped + 1));
        st.head[photoId] = clamped;
        queuePersistParams(photoId, st.params[photoId]);
        persistMeta(st);
      }),

    resetAll: (photoId) =>
      set((st) => {
        const before = st.params[photoId] ?? defaultParams();
        const fresh = defaultParams();
        const diff = diffParams(before, fresh) as Record<string, unknown>;
        st.params[photoId] = fresh;
        if (Object.keys(diff).length) pushHistory(st, photoId, 'Reset all', diff, before);
        queuePersistParams(photoId, fresh);
        persistMeta(st);
      }),

    resetGroup: (photoId, group) =>
      set((st) => {
        const before = st.params[photoId] ?? defaultParams();
        const fresh = defaultParams();
        const next = { ...(before as unknown as Record<string, unknown>), [group]: (fresh as unknown as Record<string, unknown>)[group] };
        const value = parseParams(next);
        const diff = diffParams(before, value) as Record<string, unknown>;
        st.params[photoId] = value;
        if (Object.keys(diff).length) pushHistory(st, photoId, `Reset ${group}`, diff, before);
        queuePersistParams(photoId, value);
        persistMeta(st);
      }),

    copyParams: (from) => get().params[from] ?? defaultParams(),

    pasteParams: (to, params, groups) =>
      set((st) => {
        for (const id of to) {
          const before = st.params[id] ?? defaultParams();
          let next: DevelopParams;
          if (groups?.length) {
            const merged: Record<string, unknown> = { ...(before as unknown as Record<string, unknown>) };
            const src = params as unknown as Record<string, unknown>;
            for (const g of groups) merged[g] = src[g];
            next = parseParams(merged);
          } else {
            next = { ...params, layers: before.layers, removals: before.removals };
          }
          const diff = diffParams(before, next) as Record<string, unknown>;
          st.params[id] = next;
          if (Object.keys(diff).length) pushHistory(st, id, groups?.length ? `Paste ${groups.join(', ')}` : 'Paste settings', diff, before);
          queuePersistParams(id, next);
        }
        persistMeta(st);
      }),

    addPreset: (input) => {
      const id = input.id || uid('preset');
      // Store only the groups the author actually touched: a fragment carrying
      // every default group would reset untouched sliders when it is applied.
      const fragment = paramFragmentSchema.safeParse(input.params ?? {});
      set((st) => {
        st.presets.unshift({
          id,
          name: input.name,
          group: input.group ?? 'user',
          favorite: input.favorite ?? false,
          description: input.description,
          include: input.include?.length ? input.include : ['tone', 'presence', 'curves', 'grading'],
          amount: 100,
          params: fragment.success ? fragment.data : {},
          createdAt: Date.now(),
          thumb: input.thumb,
        });
      });
      void idbSet('kv', 'presets.v1', get().presets.filter((p) => p.group === 'user')).catch(() => undefined);
      return id;
    },

    deletePreset: (id) =>
      set((st) => {
        st.presets = st.presets.filter((p) => p.id !== id);
        void idbSet('kv', 'presets.v1', st.presets.filter((p) => p.group === 'user')).catch(() => undefined);
      }),

    togglePresetFavorite: (id) =>
      set((st) => {
        const p = st.presets.find((x) => x.id === id);
        if (p) p.favorite = !p.favorite;
      }),

    applyPreset: (photoIds, presetId, amount) =>
      set((st) => {
        const preset = st.presets.find((p) => p.id === presetId);
        if (!preset) return;
        for (const id of photoIds) {
          const before = st.params[id] ?? defaultParams();
          const next = scalePreset(before, preset.params, amount);
          const diff = diffParams(before, next) as Record<string, unknown>;
          st.params[id] = next;
          if (Object.keys(diff).length) {
            pushHistory(st, id, `Preset: ${preset.name}${amount !== 100 ? ` ${amount}%` : ''}`, diff, before);
          }
          queuePersistParams(id, next);
        }
        persistMeta(st);
      }),

    applyProfile: (photoId, profileId) =>
      set((st) => {
        const profile = st.profiles.find((p) => p.id === profileId);
        if (!profile) return;
        const before = st.params[photoId] ?? defaultParams();
        const next = parseParams({
          ...(before as unknown as Record<string, unknown>),
          ...(profile.params as Record<string, unknown>),
          // Last, so the profile's own `params.profile` cannot drop the id,
          // display name or LUT binding we just resolved from the catalogue.
          profile: { ...(profile.params.profile ?? before.profile), id: profile.id, name: profile.name, lutId: profile.lutId },
        });
        const diff = diffParams(before, next) as Record<string, unknown>;
        st.params[photoId] = next;
        if (Object.keys(diff).length) pushHistory(st, photoId, `Profile: ${profile.name}`, diff, before);
        queuePersistParams(photoId, next);
        persistMeta(st);
      }),

    addSnapshot: (photoId, name) => {
      const id = uid('snap');
      set((st) => {
        st.snapshots.unshift({
          id,
          photoId,
          name,
          params: st.params[photoId] ?? defaultParams(),
          ts: Date.now(),
        });
      });
      void idbSet('kv', 'snapshots.v1', get().snapshots).catch(() => undefined);
      return id;
    },

    applySnapshot: (photoId, snapshotId) =>
      set((st) => {
        const snap = st.snapshots.find((s) => s.id === snapshotId);
        if (!snap) return;
        const before = st.params[photoId] ?? defaultParams();
        const diff = diffParams(before, snap.params) as Record<string, unknown>;
        st.params[photoId] = snap.params;
        if (Object.keys(diff).length) pushHistory(st, photoId, `Snapshot: ${snap.name}`, diff, before);
        queuePersistParams(photoId, snap.params);
        persistMeta(st);
      }),

    deleteSnapshot: (id) =>
      set((st) => {
        st.snapshots = st.snapshots.filter((s) => s.id !== id);
        void idbSet('kv', 'snapshots.v1', st.snapshots).catch(() => undefined);
      }),

    addVersion: (photoId, name) => {
      const id = uid('ver');
      set((st) => {
        st.versions.unshift({ id, photoId, name, params: st.params[photoId] ?? defaultParams(), ts: Date.now() });
      });
      void idbSet('kv', 'versions.v1', get().versions).catch(() => undefined);
      return id;
    },

    applyVersion: (photoId, versionId) =>
      set((st) => {
        const v = st.versions.find((x) => x.id === versionId);
        if (!v) return;
        const before = st.params[photoId] ?? defaultParams();
        const diff = diffParams(before, v.params) as Record<string, unknown>;
        st.params[photoId] = v.params;
        if (Object.keys(diff).length) pushHistory(st, photoId, `Version: ${v.name}`, diff, before);
        queuePersistParams(photoId, v.params);
        persistMeta(st);
      }),

    deleteVersion: (id) =>
      set((st) => {
        st.versions = st.versions.filter((v) => v.id !== id);
        void idbSet('kv', 'versions.v1', st.versions).catch(() => undefined);
      }),
  })),
);

/* ------------------------------------------------------------------ helpers */

/** History entries kept per photo (§7.2). Older diffs fold into `base`. */
const HISTORY_LIMIT = 120;

/**
 * Branching history: entries after the head are kept as an alternative branch
 * (visible in the History panel) until a new edit replaces them.
 */
function pushHistory(
  st: { history: Record<string, HistoryEntry[]>; head: Record<string, number>; base: Record<string, DevelopParams> },
  photoId: string,
  label: string,
  diff: Record<string, unknown>,
  before: DevelopParams,
) {
  if (!st.base[photoId]) st.base[photoId] = before;
  const list = st.history[photoId] ?? [];
  const head = st.head[photoId] ?? list.length - 1;
  const parent = head >= 0 ? list[head] : undefined;
  const entry: HistoryEntry = {
    id: uid('h'),
    photoId,
    label,
    ts: Date.now(),
    diff,
    parentId: parent?.id,
    branch: (parent?.branch ?? 0) + 1,
  };
  const next = [...list.slice(0, head + 1), entry];
  const kept = next.slice(-HISTORY_LIMIT);
  if (kept.length < next.length) {
    // The oldest diffs are about to fall off the front. `undo`/`jumpTo` rebuild
    // a doc by folding the kept diffs onto `base`, so fold the dropped ones
    // into the base first — otherwise a long session undoes to the wrong image.
    st.base[photoId] = fold(st.base[photoId] ?? before, next.slice(0, next.length - kept.length));
  }
  st.history[photoId] = kept;
  st.head[photoId] = kept.length - 1;
}

/** Rebuild a doc by folding history diffs onto the captured base. */
function fold(base: DevelopParams, entries: HistoryEntry[]): DevelopParams {
  const doc = entries.reduce<Record<string, unknown>>(
    (acc, e) => applyDiff(acc, e.diff as Record<string, unknown>),
    base as unknown as Record<string, unknown>,
  );
  return parseParams(doc);
}

function queuePersistParams(photoId: string, params: DevelopParams) {
  persistDebounced('params', photoId, params, 500);
}

function persistMeta(st: { history: Record<string, HistoryEntry[]>; base: Record<string, DevelopParams> }) {
  persistDebounced('kv', 'history.v1', st.history, 800);
  persistDebounced('kv', 'params.base.v1', st.base, 800);
}

/* ------------------------------------------------------------- selectors */

export const useParams = (photoId: string | null | undefined): DevelopParams => {
  const params = useDevelop((s) => (photoId ? s.params[photoId] : undefined));
  return params ?? FALLBACK_PARAMS;
};
const FALLBACK_PARAMS = defaultParams();

export const useHistory = (photoId: string | null | undefined) => {
  const history = useDevelop((s) => (photoId ? s.history[photoId] : undefined));
  const head = useDevelop((s) => (photoId ? s.head[photoId] : undefined));
  return { entries: history ?? [], head: head ?? -1 };
};

export const getDevelop = () => useDevelop.getState();
