# Status

What is real, what is a labelled placeholder, and what is deliberately different from `docs/SPEC.md`.
Spec references are normative; this file is the honest ledger.

**Runtime:** Node 22, Vite 7, React 19, TypeScript strict, Zod 4, Vitest 3.
**Gates (all green):** typecheck 0 errors · `lint:borderless` 0 strokes / 97 files · `lint:shaders` 8/8
GLSL programs parse · `vitest run` **460 tests / 15 files** · `vite build` succeeds.

---

## Done (M0–M2)

| Area | State |
| --- | --- |
| Design system (§3) | Tokens, 40 primitives, motion springs, reduced-motion, icon layer + 10 custom icons |
| Shell & routing (§4, §10.1) | 10 routes with restored state, module rail, top/status bars, resizable panels |
| Overlays (§10.2, §6.7) | Command palette, activity centre, memory HUD, shortcuts sheet, models manager, info card, toasts |
| Engine (§5) | WebGL2 pass chain: linearize → removal → blur mips → mask atlas → develop → output, stats FBO at ≤15 Hz, capture, 1×1 eyedropper |
| Curves (§4.5, §5.5) | Point luma/RGB/R/G/B, parametric with 3 splits, 4 periodic hue curves, TAT, numeric table, 4096-entry LUTs, `.cube`/`.3dl` import |
| Layers & masks (§4.6) | ≤64 layers (8 GPU slots), groups, solo, clip, blends, brush/gradient/range/matte masks with Add/Subtract/Intersect/Invert |
| Remove & retouch (§4.7) | One-click background removal + background panel, shadows, mask views; diffusion/clone inpainting, spot heal, dust finder |
| Smart & search (§8) | Deterministic on-device analysis, detections as translucent fills, NL + metadata search, similar/by-example/by-colour, explanation chips, duplicate finder, index queue |
| Presets (§9) | 19 built-in presets, 11 profiles, amount 0–200 %, fragments only, snapshots, versions, branching history (120 entries + re-based base) |
| Export/print/settings (§4.10) | Export dialog with queue, soft proofing, print layouts, 14 settings cards mirrored to CSS vars |
| Data (§7) | Params v3 + migration registry, catalog DDL (21 tables), IndexedDB driver, persistence keys, autosave |

## Labelled placeholders

These work end-to-end but are **not** the shipped implementation, and say so in the UI:

1. **Subject/sky/people matting** runs a deterministic heuristic (`computeSubjectMatte`) instead of
   BiRefNet/SAM-class weights. The models manager lists the real manifests; downloads require a checksum
   and no weights ship in the repo (§8.5).
2. **Inpainting** is a diffusion/clone solver in `REMOVAL_FRAG`, not a LaMa ONNX model.
3. **OCR, face recognition and depth ranges** are UI-complete with heuristic or empty data sources.
4. **RAW decode** uses the browser's image decoder for the demo catalog; LibRaw via napi-rs is M3.
5. **Lens corrections** apply the param document; lensfun database lookup is M3.

## Deliberate deviations (§ also in `docs/ARCHITECTURE.md` §8)

1. **Web-first runtime.** `apps/desktop/electron/{main,preload,utility}` is real code but excluded from
   the app `tsconfig` and not bundled; everything runs in the browser preview until M3.
2. **Engine on the main thread** behind `EngineClient`, not in a hidden renderer process. The contract is
   already process-shaped (`EngineCommand`/`EngineEvent`), so the move is a boundary change.
3. **IndexedDB instead of SQLite** in the browser runtime, behind one driver interface.
4. **`MAX_LAYERS = 8`** GPU-addressable slots against a 64-layer document; surplus layers are flattened
   on the CPU before packing.
5. **`better-sqlite3`, `sharp`, `onnxruntime-node` and the Rust build are optional**, not required
   install-time dependencies, so `npm install` works on a 2-core container.

## Bugs the test suite found (all fixed)

Worth keeping as a record of what the tests are for:

| # | Where | Bug |
| --- | --- | --- |
| 1 | `shared/analysis.ts` | Horizon tilt was 90° out of phase |
| 2 | `shared/analysis.ts` | Palette returned duplicate/empty clusters |
| 3 | `shared/analysis.ts` | Matte feather was inverted (more feather = harder edge) |
| 4 | `shared/analysis.ts` | Histograms were not normalised per plane; tilt had no confidence gate |
| 5 | `shared/curve.ts` | `parametricWeights` did not sum to 1 across the four bands |
| 6 | `shared/color.ts`, `spaces.ts` | OKLab inverses swapped; Bradford pair not exact inverses |
| 7 | `shared/fuzzy.ts` | Exact-match shortcut in `fuzzyScore` |
| 8 | `schema/params.ts` | Preset/profile `params` materialised all 17 groups → applying a preset reset untouched sliders |
| 9 | `schema/migrations.ts` | `migrate()` mutated the caller's document and downgraded future versions |
| 10 | `engine/uniforms.ts` | `wbGain` used the illuminant instead of its reciprocal → Temp slider and every WB preset ran backwards; the dropper's tint estimate saturated at ±150 |
| 11 | `engine/uniforms.ts` | `geometryMatrix` had perspective in the translation slot and vice versa → Vertical/Horizontal shifted the image, Offset X/Y keystoned it |
| 12 | `state/develop.ts` | `addPreset` stored the caller's object unpruned; `PresetInput.id` was ignored |
| 13 | `state/develop.ts` | `applyProfile` let `profile.params` clobber the merged profile key, dropping `lutId` |
| 14 | `state/develop.ts` | History truncation dropped the oldest diffs without re-basing, so deep undo rebuilt the wrong image |
| 15 | `pages/SmartPage.tsx` | Metadata filters rendered but were never applied to results |
| 16 | `editor/coords.ts` | Dead code in `viewRect` masking the pan-clamp intent |

## Test inventory (460)

| File | Tests | Covers |
| --- | --- | --- |
| `packages/shared/src/__tests__/curve.test.ts` | 39 | curve maths, monotone cubic, parametric, periodic hue, presets |
| `packages/shared/src/__tests__/concepts.test.ts` | 32 | vocabulary, embeddings, explanations, `matchesFilters` |
| `packages/shared/src/__tests__/color.test.ts` | 29 | sRGB/OKLab/Lab/XYZ, matrices, ΔE00, gamut map, colour spaces |
| `packages/shared/src/__tests__/analysis.test.ts` | 27 | palettes, histograms, tilt, matte, vectors |
| `packages/shared/src/__tests__/memory.test.ts` | 18 | budgets, priority LRU, disposers, relieve, hit rate |
| `packages/shared/src/__tests__/format.test.ts` | 17 | dates, EXIF, bytes, chord grammar, platform |
| `packages/shared/src/__tests__/hash.test.ts` | 13 | fnv1a, dhash/ahash, Hamming, near-duplicates |
| `packages/schema/src/__tests__/params.test.ts` | 30 | params v3, clamping, fragments, limits, bg removal |
| `packages/schema/src/__tests__/engine.test.ts` | 25 | wire format, `diffParams`, `applyDiff`, `labelForDiff` |
| `packages/schema/src/__tests__/migrations.test.ts` | 18 | v1→v3, purity, future versions, registry |
| `packages/shaders/src/__tests__/luts.test.ts` | 34 | LUT baking, encoding, composition, `.cube` parsing |
| `packages/models/src/__tests__/registry.test.ts` | 25 | manifests, download + checksum verify, residency, licensing gate |
| `apps/desktop/engine/__tests__/uniforms.test.ts` | 56 | WB, dropper, calibration, geometry homography, proofing, strokes, layer packing, mode tables |
| `apps/desktop/src/editor/__tests__/coords.test.ts` | 26 | fit/view rects, crop aspect, canvas↔source round trip, brush scaling |
| `apps/desktop/src/state/__tests__/develop.test.ts` | 71 | params, history + branching + 120-entry re-base, gestures, patch, reset, paste, presets, profiles, snapshots, versions, hydrate |

Not yet covered (M3 work): Playwright E2E, Storybook visual regression, golden-image ΔE00 comparisons
(no browser or GL compiler in this environment), and the perf/memory soak.

## Licensing

See `THIRD_PARTY_LICENSES.md` for the full attribution list. The rules that shape the code:

- **Model weights are never redistributed** and are fetched on demand with a mandatory checksum.
  `packages/models/src/__tests__/registry.test.ts` asserts that no manifest carries a banned licence
  token — **RMBG-1.4 (non-commercial) and Ultralytics YOLOv8+ (AGPL) are excluded** (§8.5, §13).
- Fonts are self-hosted under the **SIL Open Font License** (Geist, Geist Mono, Bricolage Grotesque,
  Fraunces).
- Icons are **Iconoir (MIT)**; the ten custom SVGs are original work drawn to match.
- Native imaging libraries (LibRaw, lensfun, ExifTool, libvips) are attributed with their own licences;
  all are optional at install time in this runtime.
- **No vendor DCP files are redistributed**; camera profiles in Swell are original param fragments.

## How to run

```bash
npm install --no-audit --no-fund   # node_modules is not committed
npm run dev                        # Vite on 0.0.0.0:5173
npm run verify                     # lint:borderless + lint:shaders + typecheck + tests + build
npm run test:watch                 # vitest in watch mode
```
