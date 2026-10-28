# Swell

A local-first, non-destructive RAW photo catalog and editor — a Lightroom Classic alternative whose
library, edits and machine learning all stay on your own hardware.

Ten pages (Import · Library · Cull · Develop · Curves · Layers · Remove & Retouch · Smart Search ·
Presets · Export/Print/Settings), a real WebGL2 parametric render pipeline, curves that bake into LUTs,
vector masks, branching history, and a design system with **zero border strokes**.

---

## Quick start

```bash
npm install --no-audit --no-fund
npm run dev            # http://localhost:5173
```

`npm run verify` runs every gate: borderless lint, shader parse, typecheck, unit tests and the build.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | production build |
| `npm run test` / `test:watch` | Vitest (460 tests) |
| `npm run typecheck` | `tsc -b` across the app and all packages |
| `npm run lint:borderless` | zero border strokes (§3.2) — fails on any `border`/`outline`/`ring-*` |
| `npm run lint:shaders` | parses every GLSL program (no GL compiler in CI) |
| `npm run lint` / `verify` | the gates above, in order |
| `npm run package` | electron-builder packaging (M3) |

In-app: `⌘/Ctrl+K` command palette · `?` shortcut sheet · `⌘/Ctrl+Alt+M` memory HUD · `\` before/after ·
`S` soft proofing · `A` spot visualization.

## Layout

```
apps/desktop        Electron + Vite app: shell, editor, pages, state, engine client
  engine/           WebGL2 pipeline — gl.ts, uniforms.ts, engine.ts
  electron/         main / preload / utility process (M3)
packages/schema     Zod documents: params + migrations, catalog DDL, settings, export, engine protocol
packages/shared     colour science, curves, memory budgets, hashing, analysis, formatting
packages/shaders    GLSL sources + LUT baking
packages/models     ONNX manifests, registry, checksum-verified downloads
packages/native     Rust/napi-rs scaffold
scripts/            check-borderless.mjs, check-shaders.mjs
docs/               SPEC, ARCHITECTURE, PIPELINE, MEMORY, DESIGN_SYSTEM, STATUS
```

## Documentation

- **[`docs/SPEC.md`](docs/SPEC.md)** — the product & engineering spec. Its section numbers are normative;
  source comments cite them (`§5.2`, `§6.1`, …).
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — renderers, state ownership, the param document,
  catalog driver, and the documented deviations from the spec.
- **[`docs/PIPELINE.md`](docs/PIPELINE.md)** — the pass chain, orientation contract, coordinate maths,
  curve → LUT encoding, colour order of operations.
- **[`docs/MEMORY.md`](docs/MEMORY.md)** — byte-accounted pools, eviction order, caching rules, soak.
- **[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)** — tokens, primitives, motion, icons, checklist.
- **[`docs/STATUS.md`](docs/STATUS.md)** — what is real, what is a labelled placeholder, and the bug log.
- **[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md)** — attribution and the model-weights policy.

## Principles

1. **Local-first.** A SQLite file next to the photos; edits are JSON plus optional XMP sidecars.
2. **Non-destructive.** A photo is never rewritten; every edit is a re-renderable param document.
3. **Keyboard-first.** Everything the mouse can do has a chord.
4. **No borders.** Separation by tonal elevation, spacing, shadow, blur, shape and motion — lint-enforced.
5. **Memory is a feature.** Every cache is byte-accounted with a budget and an eviction order.
6. **Private by default.** Telemetry off, on-device models only, face data opt-in and deletable.
7. **Honest placeholders.** Anything not yet real says so in the UI and in `docs/STATUS.md`.

## Status

M0–M2 are implemented and gated green: typecheck 0 · borderless 0/97 · shaders 8/8 · 460 tests ·
build ✓. Subject matting, inpainting, OCR and RAW decode currently run labelled heuristic/browser
substitutes; the Electron bundle, SQLite driver and native decode land in M3. Details in
[`docs/STATUS.md`](docs/STATUS.md).
