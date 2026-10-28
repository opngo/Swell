# Swell — Product & Engineering Spec

**Version 0.1** · status: implemented to M0–M2 (see `docs/STATUS.md`)
**Section numbers in this document are normative.** Source comments cite them (`§5.2`, `§6.1`, …); if a
comment and this file disagree, this file wins and the comment gets fixed.

Swell is a local-first, non-destructive RAW photo catalog and editor: a credible alternative to
Lightroom Classic for people who want their library, their edits and their machine learning to stay on
their own hardware.

---

## §1 Vision & principles

1. **Local-first.** The catalog is a SQLite file next to the photos. Edits are JSON documents plus
   optional XMP sidecars. Nothing is required to leave the machine, and nothing does unless the user
   exports it.
2. **Non-destructive.** A photo is never rewritten. Every edit is a parameter document that can be
   re-rendered, diffed, branched, reverted or copied to another photo.
3. **Keyboard-first.** Every action reachable by mouse is reachable by a chord (§10.4). Culling a
   thousand frames must not require a single click.
4. **No borders.** Separation comes from tonal elevation, spacing, shadow, blur, shape and motion —
   never from a 1 px stroke (§3). This is enforced by a lint rule, not by taste (`npm run lint:borderless`).
5. **Memory is a first-class feature.** Every cache is byte-accounted with a budget and an eviction
   order (§6). The Memory HUD is a product surface, not a debug tool.
6. **Speed budgets are requirements.** 60 fps for UI, one param diff per frame while dragging, a
   histogram at ≤15 Hz, a proxy render inside a scrub and a refine ~120 ms after idle (§5.2, §5.3).
7. **Private by default.** Telemetry off. Face/people data opt-in with a single "delete all face data"
   action. On-device models only (§8, §12).
8. **Honest placeholders.** Anything not yet real is labelled as such in the UI and in `docs/STATUS.md`.
   No fake progress bars, no invented results.

**Non-goals for 1.0:** cloud sync, social/sharing, video editing (video sidecars are catalogued, never
developed), tethered capture, a plugin marketplace, and any web service Swell depends on to open a photo.

---

## §2 Platform & stack

### §2.1 Runtime targets

| Target | Status | Notes |
| --- | --- | --- |
| Browser (Vite dev/preview) | primary during development | the whole app runs here; IndexedDB stands in for SQLite |
| Electron desktop | scaffolded (`apps/desktop/electron/{main,preload,utility}`) | excluded from the app `tsconfig`; bundles in M3 |
| macOS / Windows / Linux | packaging via `electron-builder` (§13) | native module builds are optional at runtime |

The renderer never assumes Electron. Every platform capability is behind an interface with a browser
implementation, so the UI is testable headlessly.

### §2.2 Dependencies (required)

React 19 · TypeScript (strict) · Vite · Tailwind v4 · `iconoir-react` (icons only — **no shadcn/ui**) ·
React Aria Components (behaviour/a11y primitives) · Motion (spring animation) · Zustand + Immer
(durable state) · Jotai (per-frame editor state) · TanStack Virtual (grids/filmstrip) · Zod (every
document that crosses a boundary) · date-fns · better-sqlite3 + Drizzle (desktop catalog) ·
ONNX Runtime (on-device models) · Rust via napi-rs (decode/lensfun/ExifTool-adjacent native work).

Rules: no UI kit that ships its own visual language; no CSS-in-JS runtime; no dependency that phones
home; no model weights in the repository (§8.5).

### §2.3 Repository layout

```
apps/desktop/            Electron + Vite app
  electron/              main, preload, utility process (SQLite driver, decode)
  engine/                WebGL2 render engine (gl.ts, uniforms.ts, engine.ts)
  src/app/               shell, routes, overlays, keyboard bus
  src/editor/            stage, filmstrip, inspector, panels
  src/state/             zustand stores + jotai atoms
  src/lib/               persistence, loaders, analysis client, presets
  src/ui/                design-system primitives, icons, motion
  src/workers/           analysis worker pool
packages/schema/         Zod documents: params, catalog DDL, settings, export, engine protocol
packages/shared/         colour science, curves, memory, hashing, analysis, formatting
packages/shaders/        GLSL sources + LUT baking
packages/models/         ONNX manifests, registry, download & verify
packages/native/         Rust/napi-rs scaffold
scripts/                 check-borderless.mjs, check-shaders.mjs
docs/                    this file + ARCHITECTURE, PIPELINE, MEMORY, DESIGN_SYSTEM, STATUS
```

### §2.4 Native & ML runtime

Native modules and ONNX Runtime are **optional at install time**: their absence degrades to the
browser paths (WebGL2 engine, Web Workers, heuristic analysis) rather than failing to start. Model
weights are fetched on demand, checksum-verified, and cached in IndexedDB (§8.5–§8.6).

### §2.5 Numbers & formatting

Every numeric readout uses `tabular-nums` so sliders never jitter. Formatting helpers live in
`packages/shared/src/format.ts` and are platform-aware: `mod` renders ⌘ on macOS and Ctrl elsewhere,
dates are formatted in local time, EXIF values get photographic formatting (f/2.8, 1/250 s, 35 mm,
ISO 400). Byte counts, percentages and coordinates all have one formatter each — no ad-hoc
`toFixed()` in components.

---

## §3 Design system — no borders

### §3.1 Shell metrics

| Element | Size |
| --- | --- |
| Module rail | 56 px |
| Side panel | 224 px (min 180) |
| Inspector column | 340 px (min 280, max 560) |
| Top bar | 46 px |
| Status bar | 26 px |
| Filmstrip | 96 px |

The rail and the status bar span the full window width; panels sit between them. Overlays portal to
`document.body` at z ≥ 9000 (info card 8800, activity centre 9060, memory HUD 9080, command palette
9210, toasts 9600).

### §3.2 Surfaces & elevation

**Zero border strokes.** No `border`, no dividers, no `outline`, no `ring-*`. The only sanctioned
1 px line in the whole product is the *luminance-adaptive guide overlay drawn on photo content*
(thirds, centre, golden ratio, custom guides) — that is image content, toggleable, and never UI chrome.

Separation is produced by:

- **Tonal elevation**: `--color-s0 … --color-s6` in OKLCH, dark-first. A raised panel is *lighter*,
  not outlined.
- **Spacing** and **shape**: radii `--radius-xs … --radius-pill` = 6 / 10 / 14 / 20 / 28 / 999 px.
- **Shadows** `--e1 … --e3` (soft, low-opacity, never a hard drop).
- **Blur** and **scrims** for overlays.
- **Motion** for state change.

Accent: `oklch(0.78 0.12 200)`. The canvas backdrop behind a photo is a dedicated neutral token —
it must never carry a colour cast, because users judge colour on it.

### §3.3 Typography

Geist Sans + Geist Mono (UI/numerics) and Bricolage Grotesque (display), all self-hosted. Type scale
**11 / 12 / 13 / 15 / 18 / 24 / 32 px**. Numeric readouts are tabular (§2.5). Labels are sentence case;
units are always shown.

### §3.4 Motion

Three springs, no durations:

| Preset | stiffness | damping | mass | Use |
| --- | --- | --- | --- | --- |
| `snappy` | 520 | 38 | 0.7 | controls, toggles, focus |
| `smooth` | 320 | 30 | 0.9 | panels, overlays, route changes |
| `swell` | 180 | 22 | 1.0 | expressive reveals, empty states |

`prefers-reduced-motion` **and** an in-app toggle both collapse every transition to instant.
**Never animate pixels**: the photo surface is not a motion target. Cropping, zooming and before/after
splits move the *view*, not an animated image; a render either is ready or shows the previous tier.

### §3.5 Density & UI scale

Row densities 36 / 30 / 26 px. UI scale 80–150 %, applied as a root font-size multiplier so rem-based
layout scales without re-measuring JavaScript.

### §3.6 Focus & accessibility

Focus is an **accent halo plus a surface lift** — never an outline. All interactive elements are
reachable by keyboard with a visible focus state; roles and names come from React Aria; sliders expose
`aria-valuetext` with units; grids are virtualised but keep a real roving tabindex; toasts are polite
live regions; contrast meets WCAG AA on every token pair; RTL is a layout flag, not a fork (§12).

---

## §4 The ten pages

Ten routes, each restoring its own state (filters, sort, scroll offset, selection, panel tabs) when
revisited (§10.1). Pages 4–7 share **one editor shell**: tool bar + stage + inspector + filmstrip, so
switching between them never re-decodes or re-renders from scratch.

### §4.1 Page 1 — Home & Import

Import from folders/volumes/cards with previews, a destination picker, file renaming templates,
metadata presets, keyword entry, duplicate detection during import, and a progress queue that survives
navigation. Recent catalogs, "resume where you left off", and the demo catalog on first run (§14 M0).

### §4.2 Page 2 — Library

The whole catalog: grid/loupe/survey/compare views, filter bar (rating, flag, colour label, keywords,
collections, folders, dates, camera, lens, metadata), sort orders, batch operations (rating, keywords,
collections, metadata, presets), stacks, collections and the Quick Collection (`B`). Virtualised with
TanStack Virtual at every density.

### §4.3 Page 3 — Cull & Compare

Fast reject/pick flow with auto-advance (`Shift+A`), side-by-side compare with zoom-locked pairs,
survey of the selection, rating/flagging/colour labels without leaving the keyboard, and a
focus-peaking-ish magnifier for critical sharpness checks.

### §4.4 Page 4 — Develop

The full parametric editor: white balance (dropper + presets + Temp/Tint), tone, presence, HSL/colour
mixer, split toning/colour grading, detail (sharpening, noise), effects (grain, glow, dehaze),
calibration, lens corrections, geometry/upright, crop & rotate, and the treatment switch (colour/B&W).
Histogram with clipping display, before/after (hold `\`), soft proofing (`S`), and every slider
behaving per Appendix A.

### §4.5 Page 5 — Light Curves

The flagship editor. Point curves for luma and for RGB/R/G/B (≤16 points, monotone cubic with
smooth/linear per point), a parametric curve with three split handles, and four hue curves
(Hh, Hs, Hl, Ls) that are periodic in OKLCH hue. Targeted Adjustment Tool (`T`) drags directly on the
photo; a numeric table shows exact values; the histogram sits behind the curve grid; every curve bakes
into a 4096-entry LUT (§5.5). Local curves ride on layers (§4.6).

### §4.6 Page 6 — Layers & Masking

≤64 layers: adjustment, image, fill, cutout, group (text layers are 1.1). Per layer: opacity, blend
mode, visibility, lock, solo, reorder, clip to the layer below, merge/flatten. Masks are **vector
parameters** (§6.4): brush (size, feather, flow, density, auto-mask, erase), linear and radial
gradients, colour/luminance/depth ranges, and AI mattes (subject, sky, background, people parts,
objects) with edge refinement. Mask booleans: Add, Subtract, Intersect, Invert.

### §4.7 Page 7 — Remove & Retouch

**Remove Background** is one click: segment → matte → edge refine → a background panel (transparent,
solid, gradient, blurred original, image, studio presets) with shadows, relight matching and mask
views, batch application, and PNG/WebP/AVIF/TIFF export. **Object removal** is LaMa-style inpainting
with click-to-remove, a distraction finder and wire removal. **Heal/clone/content-aware** brushes with
Spot Visualization (`A`) and a dust map across the whole catalog (§7.4). Plus portrait retouch
(skin, eyes, teeth, frequency-separation-style tools) and red-eye/pet-eye.

### §4.8 Page 8 — Smart Detect & Search

On-device detection rendered as **translucent fills, never stroked rectangles** (§8.3): subjects, sky,
people and body parts, objects, text (optional OCR). Faces/people are opt-in with "delete all face
data". Search combines natural language with metadata filters (`matchesFilters`), plus similar-image,
search-by-example and search-by-colour, each with match-explanation chips. Auto keywords, auto stacks,
smart rules and a duplicate finder feed the index queue (§8.2).

### §4.9 Page 9 — Presets, Profiles & History

Preset browser with live thumbnails, hover preview and an amount slider 0–200 %; `.swellpreset`
import/export; `.cube`/`.3dl` LUT import; camera and creative profiles; snapshots; **branching
history**; batch operations; named versions with diff (§9).

### §4.10 Page 10 — Export, Print & Settings

Export dialog: presets, destination, file settings, colour space/bit depth, sizing, output sharpening,
metadata, watermark, background, post-processing actions and a queue. Print: contact sheet, picture
package, PDF or the system printer. Settings: fourteen tonal cards covering general, appearance,
performance, catalog, previews, editing, AI, privacy, shortcuts, export, plugins, diagnostics,
about (§10.3).

---

## §5 The render pipeline

### §5.1 Curve model

Curves live in a perceptual domain `K = 12` (not raw 0–1 code values). A curve holds **≤16 points**, each `{x, y}`, with a
global interpolation and per-point smooth/linear. `y` is clamped to **−0.5 … 1.5** so a curve can pull
below black or above white without producing an invalid LUT. Hue-curve points are *normalised deltas*
(±0.5 = ±180°) sampled periodically — a hue curve with fewer than two points is a no-op by design.

### §5.2 Param flow — one diff per frame

`DevelopParams` is the single source of truth. While dragging, the live document lives in a Jotai atom
(`liveParamsAtom`) so React never re-renders per frame; the engine receives **coalesced param diffs —
at most one per frame — and never pixels over JSON IPC**. On release, `endGesture()` folds the whole
drag into exactly one history entry (§7.2, Appendix A).

### §5.3 Preview tiers & quality policy

| Tier | Long edge |
| --- | --- |
| Thumb | 256 px |
| Standard | 1440–2048 px |
| Smart preview | 2560 px |
| 1:1 | native |
| Edit proxy | `min(native, 2048)` |
| Full | `min(native, 4096)` |

While scrubbing or dragging, render the proxy tier; ~120 ms after idle, refine to full. Tiles are
512 px with mipmaps; linear buffers are RGBA16F where the device supports half-float render targets,
otherwise they fall back with a toast rather than failing.

### §5.4 LUT budget

A curve → LUT rebuild must cost **< 0.2 ms**; rebuilds are skipped when the curve signature is
unchanged (cache-by-hash, §6.2). LUT textures are RGBA8; `.cube` LUTs upload as WebGL2 `TEXTURE_3D`.

### §5.5 Curves → LUT

`uLutHue` packs the four hue curves as RGBA (Hh, Hs, Hl, Ls) encoded `v * 0.5 + 0.5`, `uLutHue2`
carries the saturation curve, and the RGB curve LUT packs `(r, g, b)` per texel. Luma curves apply as
`rgb *= f(Y) / Y` so hue is preserved. Hue curves index OKLCH hue and wrap periodically. Composition
of point + parametric curves is exact where the parametric band has zero weight (§5.1).

### §5.6 Colour management

Working space is **linear Rec.2020**. sRGB ↔ linear, OKLab/OKLCH, Lab/XYZ and the display primaries
all live in `packages/shared/src/{color,spaces}.ts`; matrices are flat row-major `Mat3` tuples and are
uploaded column-major via `toGlMat3`. Chromatic adaptation uses a Bradford pair derived by exact
matrix inversion, never rounded constants from a table. Soft proofing (`S`) routes the develop pass
through the proof space and back to the display, and the round trip is asserted in tests.

### §5.7 Params → uniforms contract

`apps/desktop/engine/uniforms.ts` is the only place a parameter becomes a number the GPU sees:

- **White balance** is computed on the CPU as `uWbGain`. `TEMP_TO_RGB(k)` returns the *illuminant*,
  so the correction is its **reciprocal**: a warm (low-K) illuminant yields a blue-heavy gain. Gains
  are luma-normalised to 1.0 and clamped 0.2 … 4. Tint convention: **positive = magenta**.
- **Geometry** is one homography `T(offset) · R(rotate) · S(scale, aspect) · P(kx, ky)` applied as
  `M · (uv − 0.5, 1)` then divided by `w`. Perspective lives in the third **row**, translation in the
  third **column**. Upright modes fold the detected horizon tilt into `rotate`; Guided Upright solves
  from ≤4 user lines.
- **Calibration** is a CPU `mat3` from primary hue/sat shifts plus a shadows-tint diagonal bias.
- **Layers** pack into fixed arrays sized `MAX_LAYERS = 8` GPU-addressable slots (`op`, `adjA…adjD`,
  `fill`, `fill2`, `img`, `img2`) plus one mask draw per masked layer; the document may hold 64 layers
  and the extra ones are flattened on the CPU.
- **Brush strokes** pack into circle arrays (48 add / 16 subtract) with radius and feather per dab.
- Enum → integer tables (`BLEND_INDEX`, `MASK_KIND_INDEX`, `CLIPPING_MODE`, `BG_KIND`,
  `BEFORE_AFTER_MODE`) mirror the shader `switch` statements exactly and are asserted in tests.

**Orientation contract:** every texture and FBO stores image space with `t = 0` at the **image top**;
only `output.frag` flips once. UI mask coordinates are normalised image space, origin top-left, y down.

---

## §6 Memory & performance

### §6.1 Budgets

Total working budget **4 GB**, byte-accounted per pool:

| Pool | Budget |
| --- | --- |
| `thumbs` | 256 MB |
| `standard` | 768 MB |
| `decoded` | 1 GB |
| `tiles` | 2 GB |
| `mattes` | 128 MB |
| `ml` | 1 GB |
| `embeddings` | 64 MB |

Every cached bitmap or buffer is allocated through `MemoryBudget`; nothing caches itself privately.
The Memory HUD (`Ctrl/⌘+Alt+M`) shows per-pool bytes, hit rates, eviction counts and the pressure log.

### §6.2 Caches, eviction, pooling, model residency

Eviction priority (first to go → last): **embeddings → thumbs → standard → mattes → decoded → tiles →
ml**. GPU textures and framebuffers are **reused by size class** from a pool rather than reallocated.
LUT rebuilds and inpaint results are cached by content hash. Undo stores **param deltas**, never
documents or pixels. Loaded models unload after **60 s idle** (configurable), and residency obeys the
`ml` budget.

### §6.3 Prefetch & navigation

Prefetch ±2 neighbours of the active photo so arrow-key navigation never stalls; prefetch is
cancelled on direction change and yields to the active render.

### §6.4 Masks are vectors

A mask is parameters: strokes (points, radius, feather, flow), gradient handles, range endpoints, or a
matte reference. Rasterised masks are stored as RLE or PNG in the `mattes` pool and are always
re-derivable from the vectors — so a mask stays editable forever and costs nothing until rendered.

### §6.5 Concurrency

Worker concurrency is `cores − 2`, clamped to ≥1. The UI renderer, the hidden engine renderer and the
worker pool never compete for the same frame budget.

### §6.6 Pressure & hidden tabs

On `memoryPressure` or a hidden tab, caches are trimmed in priority order and the engine frees
everything except the source texture. Nothing is freed that would cost a re-decode of the visible photo.

### §6.7 Activity centre

Long work (import, export, indexing, model download, inpaint) reports into the activity centre with
real progress, cancellability, and a toast on completion or failure. No spinner may run without an
entry there.

---

## §7 Data

### §7.1 SQLite schema

One database per catalog. Tables: `volumes`, `folders`, `photos`, `collections`, `collection_photos`,
`keywords`, `photo_keywords`, `develop_settings`, `history`, `snapshots`, `presets`, `profiles`,
`detections`, `features`, `embeddings`, `people`, `faces`, `previews`, `imports`, `mattes`, `settings`
(DDL in `packages/schema/src/catalog.ts`, indexed on folder, capture time, rating, stack, hash,
photo/label for detections, and history per photo). Video files are catalogued but never developed.
In the browser runtime the same shape is served from IndexedDB behind one driver interface.

### §7.2 DevelopParams, migrations, history

`DevelopParams` is a versioned JSON document (`v`, currently **3**) validated by Zod on every read.
Numbers are clamped with a documented default, so a corrupt field degrades instead of throwing.
A migration registry maps `n → n+1`, migrations are **pure** (they clone, never mutate the caller's
document), a document from the future is returned untouched rather than downgraded, and an unknown
older version raises rather than silently passing through.

`history` stores `params_diff_json` — a diff, never a full document (§5.2). Diffs use dot paths for
scalars (`tone.exposure`), whole-array replacement for lists, and `$` for root scalars. The store keeps
a `base` document plus up to **120** entries per photo; when the window slides, the dropped diffs are
folded into `base` so deep undo still lands on the right image. Labels are human-readable
(`Exposure +0.35`, `Preset: Swell Punch 50%`, `Reset tone`) and drive both the History panel and the
undo/redo toast.

### §7.3 Sidecars & the background-removal document

XMP sidecars are written **by default** (setting, off-able) carrying the develop params, rating, labels,
keywords and collections so the catalog survives losing the database. `bgRemoval` is an *optional*
group — absent from `defaultParams()`, present only once the user removes a background — holding output
kind/colour/gradient/blur/image, edge refinement (feather, shift, smooth, hair refine, decontaminate,
glow match), shadow parameters, relight matching, mask view, subject list, model id and matte id.

### §7.4 Integrity, dust, backups

Checksums guard model downloads and catalog backups; an integrity check runs on demand and after a
crash; `VACUUM`/optimise runs on a schedule. The dust map indexes sensor-dust candidates across the
catalog so one heal fixes the same spot on every frame. Autosave writes through a crash-recovery path:
on start, an unfinished session is offered, never silently applied.

---

## §8 On-device AI

### §8.1 Analysis

Deterministic, on-device image analysis produces the features search runs on: colour palette and
histograms (normalised per plane), edge/orientation energy, horizon tilt (with a confidence gate — no
bin holding >15 % of gradient energy means "no tilt"), skin/scene heuristics, rule-of-thirds weights,
perceptual hashes (`dhash`/`ahash`, 16-char lowercase hex) and a normalised concept vector.

### §8.2 Index queue & workers

Indexing is a queue with priorities (`current → neighbour → background`), runs in the worker pool
(§6.5), reports progress to the activity centre (§6.7), and is resumable after a restart.

### §8.3 Detections & concepts

Detections are bounding boxes **and** masks, drawn as translucent fills — never stroked rectangles.
Concepts are a fixed vocabulary with synonyms; matching is embedding similarity plus metadata filters
(`matchesFilters`), and every result carries an explanation ("sky 0.42 · warm palette · 3 people").

### §8.4 Duplicates, similar, by-colour

Near-duplicates: Hamming distance ≤ 6 on the perceptual hash. Similar-by-example and search-by-colour
run over the same stored features, with a limit and a similarity score for the UI to threshold.

### §8.5 Models & licensing

Models ship as manifests (id, task, version, size, execution providers, checksum, licence, notes) —
**weights are never in the repository**. Downloads refuse to run without a checksum match. Only
permissively licensed weights may be shipped: **RMBG-1.4 and Ultralytics YOLOv8+ are excluded**, and a
test asserts no banned licence token appears in any manifest. Subject segmentation currently runs a
labelled heuristic placeholder until BiRefNet/SAM-class weights are wired in.

### §8.6 Models manager & re-index

A models manager lists every manifest with state (`not downloaded / downloading / ready / failed /
resident`), size, licence and notes; residency obeys the idle-unload rule (§6.2). Bumping `model_ver`
invalidates and re-indexes affected detections, queued at background priority.

---

## §9 Presets, profiles, snapshots, versions

### §9.1 Preset browser

Live thumbnails, hover preview on the current photo, amount 0–200 %, favourites, groups
(`swell / portrait / landscape / film / bw / local / user`), `.swellpreset` import/export.

**A preset stores only the groups it touches.** `paramFragmentSchema` validates a fragment against the
real schema and then prunes back to the keys the author wrote, because `.partial()` alone would
materialise every default group — and merging a fragment containing `layers: []` would wipe the user's
layer stack. Amount scales numerically from the *current* document toward the preset value, so 0 % is a
no-op and 200 % overshoots.

### §9.2 LUT import

`.cube` and `.3dl` files are parsed, validated (size header, monotone domain), stored, and applied as
a creative profile with its own amount. A LUT profile binds by `lutId` in the document.

### §9.3 Camera & creative profiles

Profiles are param fragments plus an id and an optional LUT; groups are `swell / camera / creative /
lut`. Applying a profile binds its id and LUT and merges its groups without discarding other edits;
the display name lives in the catalog, not in the photo document.

### §9.4 Batch, snapshots, versions

Sync/copy-paste settings across selections with a group filter (layers and removals are never pasted
blindly). Snapshots are named point-in-time documents; versions are a named timeline per photo; both
apply as one undoable history entry. No vendor DCP files are redistributed.

---

## §10 Global capabilities & shortcuts

### §10.1 Routes & restored state

Every route restores its own state on return: filters, sort, scroll offset, selection, panel tabs,
zoom/pan and the active photo. Crash recovery offers the last autosaved session (§7.4).

### §10.2 Palette, undo, toasts

`Ctrl/⌘+K` opens the command palette (tiered fuzzy match: prefix > substring > subsequence, then
score, then alphabetical; recent commands when the query is empty). Undo/redo are labelled everywhere
they appear. Toasts are transient; anything long-running belongs in the activity centre (§6.7).
Multi-window, OS drag-and-drop of files out of the app, and the Quick Collection (`B`) are global.

### §10.3 Settings

Fourteen tonal cards (§4.10), persisted, mirrored onto `<html>` as CSS variables (density, UI scale,
accent, reduce-motion, canvas backdrop) so a change applies without a reload.

### §10.4 Shortcut table

Bindings live in `SWELL_SHORTCUTS` and are user-rebindable; a chord may be bound to two actions when
both resolve to the same behaviour (`z`, `mod+shift+e`), and the dispatcher keeps one binding per chord.

| Action | Chord | Action | Chord |
| --- | --- | --- | --- |
| Grid / Loupe / Survey / Compare | `G` / `E` / `N` / `C` | Develop | `D` |
| Curves / Layers / Retouch | `⇧D` / `⇧L` / `⇧R` | Smart / Presets | `⇧S` / `⇧P` |
| Export / Home | `⌘⇧E` / `⌘⇧H` | Hide all panels / hide sides | `Tab` / `⇧Tab` |
| Fullscreen / Lights out | `F` / `L` | Zoom toggle / Zoom tool | `Z` |
| Info overlay / Before-after (hold) / Before-after | `I` / `\` / `Y` | Clipping display | `J` |
| Rating 0–5 | `0`…`5` | Pick / Reject / Unflag | `P` / `X` / `U` |
| Colour labels red/yellow/green/blue | `6` `7` `8` `9` | Crop / Spot | `R` / `Q` |
| Mask / TAT / Overlay | `⇧M` / `T` / `O` | WB dropper / Spot visualize | `W` / `A` |
| Hand tool / Soft proof / Remove background | `H` / `S` / `⌘⇧B` | Undo / Redo | `⌘Z` / `⌘⇧Z` |
| Copy / Paste settings | `⌘C` / `⌘V` | Copy dialog / Sync | `⌘⇧C` / `⌘⌥V` |
| Virtual copy / Reset params / Auto tone | `⌘'` / `⌘⇧R` / `⌘U` | Quick collection / Stack | `B` / `⌘G` |
| Filter / Delete / Next / Previous | `⌘F` / `Del` / `→` / `←` | Auto-advance cull | `⇧A` |
| Command palette / Settings | `⌘K` / `⌘,` | Memory HUD | `⌘⌥M` |
| Slider increment / decrement | `↑` / `↓` | Shortcuts sheet | `?` |

### §10.5 Export & print queue

Exports and prints are queued jobs with real progress, cancellation, retry, and a post-processing hook
(open in, show in folder). Print supports contact sheets, picture packages, PDF output and the system
printer.

---

## §11 Iconography

Iconoir only (`iconoir-react`), `strokeWidth={1.5}`, sizes **18 / 20 / 24**, colour `currentColor`.
Concepts Iconoir lacks get custom SVGs in `src/ui/icons/custom/` drawn to match Iconoir's grid and
stroke exactly (Layers, Brush, Aperture, Histogram, Contrast, Merge/Split, Grain, Stack, Heal, Red-eye).
`ui/icons.tsx` holds the concept → component map; icons are never resized off the sanctioned steps and
never carry their own colour.

---

## §12 Privacy, i18n, scripting

Telemetry is off by default and has no code path that sends photo data. Face/people indexing is opt-in
with a single destructive "delete all face data" action that also clears embeddings and detections.
Strings are externalised for i18n with RTL as a layout direction, not a separate design. A scripting
API (1.1) exposes the catalog, the param document and the export queue — never raw pixels.

---

## §13 Testing, packaging & licensing

- **Vitest unit tests** for curve maths, migrations, colour conversions, memory eviction, param →
  uniform packing, coordinate mapping, hashing and analysis. Anything that turns a number into another
  number is tested at its boundary values.
- **Testing Library + Storybook** visual regression for the design system.
- **Playwright** end-to-end flows (import → cull → develop → export).
- **Golden images** compared with ΔE00 tolerances for the render pipeline.
- **Performance and memory soak** runs against the §6.1 budgets.
- **Lint gates**: `npm run lint:borderless` (zero border strokes, §3.2) and `npm run lint:shaders`
  (every GLSL program parses, since no GL compiler exists in CI).
- **Packaging** via `electron-builder` for macOS/Windows/Linux.
- **Licensing checklist**: attribute LibRaw, lensfun, ExifTool, libvips; verify model **weights**
  licences (exclude RMBG-1.4 and Ultralytics YOLO); fonts under OFL; Iconoir MIT; no vendor DCP
  redistribution. Result recorded in `THIRD_PARTY_LICENSES.md`.

---

## §14 Roadmap

| Milestone | Scope |
| --- | --- |
| **M0** | Shell, design system, demo catalog, all ten routes navigable with real state |
| **M1** | WebGL2 develop pipeline: WB, tone, presence, curves → LUT, crop/geometry, histogram |
| **M2** | Layers & masks, local curves, brush/gradient/range masks, AI matte placeholders |
| **M3** | Electron packaging, SQLite driver, native decode, sidecar XMP, export queue |
| **M4** | Remove & Retouch: background removal, inpainting, dust map, portrait tools |
| **M5** | Smart Detect & Search on real model weights, models manager, re-index |
| **1.0** | All ten pages complete to Appendix B, golden-image parity, soak-tested budgets |
| **1.x** | Text layers, scripting API, tethering, more profiles, collaborative review |
| **2.0** | Video, cloud-optional sync, plugin surface |

---

## Appendix A — Slider behaviour

| Behaviour | Spec |
| --- | --- |
| Default interaction | **row scrub**: press anywhere on the row and drag horizontally |
| While dragging | `onChange` fires per frame; the live value goes to the engine, not to history |
| On release | `onCommit` — exactly **one history entry per gesture** |
| Double-click | reset to the parameter's default |
| Click the value | type a number directly (units optional, clamped on blur) |
| Arrow keys | ±1 step; `Shift` coarse ×10; `Alt`/`Option` fine ×0.1 |
| `Home` / `End` | minimum / maximum |
| Screen readers | `aria-valuetext` with value **and** unit |
| Numeric readout | `tabular-nums`, fixed decimals per parameter |

## Appendix B — Definition of done (every page)

1. Full keyboard coverage; every control has a name, role and visible focus state.
2. **Zero border strokes** — verified by the lint rule, not by review.
3. 60 fps interaction and adherence to the §6.1 memory budgets under a soak.
4. Undo/redo with labels for every mutation the page can make.
5. State persists across reloads and restarts (§10.1).
6. `prefers-reduced-motion` and the in-app toggle both collapse motion.
7. Tests for the page's own logic, plus any new pure function it introduces.
8. Any placeholder is labelled in the UI and listed in `docs/STATUS.md`.
