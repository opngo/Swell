# Architecture

How Swell is put together, and why. Section references are to `docs/SPEC.md`.

---

## 1. The three renderers (§5, §6.5)

| Renderer | What it does | Where |
| --- | --- | --- |
| **UI renderer** | React tree, panels, overlays. Never touches pixels. | `apps/desktop/src/**` |
| **Engine renderer** | WebGL2 parametric pipeline: params in, pixels out. | `apps/desktop/engine/**` |
| **Worker pool** | CPU-heavy analysis, hashing, embeddings, matte post-processing. | `apps/desktop/src/workers/analysis.worker.ts` |

Two rules hold them apart:

- **No pixels over JSON IPC.** The UI sends `DevelopParams` diffs; the engine renders and, when asked,
  returns an `ImageData`/blob for export or a thumbnail — never a per-frame stream.
- **One param diff per frame.** `EngineClient` coalesces everything a drag produces into at most one
  `RenderRequest` per animation frame (§5.2).

In the desktop target the engine renderer moves to a hidden window/utility process and the worker pool
to a napi-rs thread pool; because the only contract is `EngineCommand`/`EngineEvent`
(`packages/schema/src/engine.ts`), that move does not touch UI code.

## 2. Repository map

```
packages/shared     colour science, curves, memory budgets, hashing, analysis, formatting, geometry
packages/schema     every Zod document: params (+migrations), catalog DDL, settings, export, engine protocol
packages/shaders    GLSL sources, LUT baking, .cube parsing
packages/models     ONNX manifests, registry, download + checksum verify, residency
packages/native     Rust/napi-rs scaffold (decode, lensfun) — not built in the browser runtime
apps/desktop/engine gl.ts (context + pooled textures), uniforms.ts (params → numbers), engine.ts (passes)
apps/desktop/src    app shell, editor, pages, state, lib, ui, workers, engine-client
scripts             check-borderless.mjs, check-shaders.mjs
```

Dependency direction is one-way: `shared` depends on nothing; `schema` on `shared`; `shaders` and
`models` on `shared`/`schema`; the app on all of them. The engine imports `schema` and `shared` but
never React.

## 3. State ownership

**Zustand + Immer — durable, coarse-grained state** (`src/state/`):

| Store | Owns | Persisted as |
| --- | --- | --- |
| `catalog` | photos, folders, collections, keywords, detections, features, selection | `catalog.v1` + IndexedDB |
| `develop` | committed params, base docs, history, presets, profiles, snapshots, versions | `params`, `history.v1`, `params.base.v1`, `presets.v1`, `snapshots.v1`, `versions.v1` |
| `settings` | the fourteen settings cards, shortcuts, density, UI scale, accent | `settings.v1`, mirrored to `<html>` as CSS vars |
| `ui` | route, panel tabs, view (zoom/pan/mode), overlays, restored per-route state | `ui.v1` |
| `toasts` | transient notifications | — |

**Jotai — per-frame editor state** (`src/state/atoms.ts`): `liveParamsAtom` holds the document while a
slider is being dragged so React never re-renders at 60 Hz; `editorStore` scopes it per editor;
`commitGestureAtom` folds the drag into a single `useDevelop.commit()` on release (Appendix A).

The rule: **if a value changes more than a few times a second, it is an atom; if it must survive a
restart, it is a store.**

## 4. The param document (§7.2)

`DevelopParams` is versioned (`v = 3`) and validated on every read. Three properties matter
architecturally:

1. **Clamping defaults.** Every number is `num(min, max, default)` ending in `.catch(default)`, so a
   corrupt or out-of-range field degrades instead of throwing mid-render.
2. **Fragments.** Presets and profiles store only the groups they touch. `paramFragmentSchema`
   validates against the real schema and then prunes back to the keys the author wrote — `.partial()`
   alone would materialise every default group, and a fragment carrying `layers: []` would wipe a
   user's stack.
3. **Diffs.** `diffParams(a, b)` produces dot-path scalars (`tone.exposure`), whole-array replacement
   for lists, and `$` for root scalars; `applyDiff` is copy-on-write and creates missing intermediates.
   History stores diffs (§7.2), the wire carries diffs (§5.2), and `labelForDiff` turns one into the
   human string shown in the History panel and the undo toast.

Migrations are pure (`cloneDoc()` before rewriting), registered per version step, and a document from
the future is returned untouched rather than downgraded.

## 5. Catalog driver

One interface, two implementations:

- **Browser:** in-memory maps + IndexedDB (`src/lib/persist.ts`) — used by the dev preview and tests.
- **Desktop:** better-sqlite3 + Drizzle in the utility process, DDL from `packages/schema/src/catalog.ts`
  (21 tables, 8 indexes, §7.1).

The store talks to the interface, so the ten pages are identical in both runtimes. Model weights live in
the IndexedDB `masks` store under `model:<id>` in the browser, and in the catalog directory on desktop.

## 6. Engine client contract

`src/engine-client/EngineClient.ts` is the only thing the UI talks to:

```
load(source) → setParams(diff) → render(tier) → histogram() / capture(w,h) / pickColor(x,y)
```

- `setParams` accepts a full document or a diff and coalesces to one render per frame.
- LUTs are rebuilt only when `signatureOf(params)` changes; callers that do not need curves pass
  `EMPTY_LUTS`.
- `capture(w, h)` renders into an RGBA8 FBO, `readPixels`, and row-flips (the pipeline stores images
  top-down; see `docs/PIPELINE.md`).
- A runtime shader-compile failure falls back to an unedited `<img>` plus a toast — a broken GPU never
  blanks the editor.

## 7. Analysis & models (§8)

`src/lib/analysisClient.ts` owns the worker pool (`cores − 2`, §6.5) and the index queue with
priorities `current → neighbour → background`. Results land in the catalog store as detections,
features, embeddings and hashes. `packages/models` holds manifests only: weights are downloaded on
demand, refuse to run without a checksum match, unload after 60 s idle (§6.2), and are gated by a
licence test that rejects RMBG-1.4 and Ultralytics YOLO tokens (§8.5).

## 8. Documented deviations from the spec

These are deliberate and tracked in `docs/STATUS.md`:

1. **Web-first runtime.** Electron main/preload/utility exist and are real code but are excluded from
   the app `tsconfig` and not bundled yet (M3). Everything runs in the browser preview today.
2. **Engine on the main thread** behind `EngineClient`, not in a hidden renderer process; CPU-heavy
   work already runs in workers, so the move is a process-boundary change, not a rewrite.
3. **IndexedDB instead of SQLite** in the browser runtime, behind the same driver interface.
4. **Heuristic subject matte** labelled as a placeholder in the UI until BiRefNet/SAM-class weights are
   wired through the models manager.
5. **`MAX_LAYERS = 8` GPU-addressable slots** while the document allows 64 layers (§4.6); the surplus is
   flattened on the CPU before packing.
