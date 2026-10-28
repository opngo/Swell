# Third-party licences

Swell ships no model weights, no vendor camera profiles (DCP) and no proprietary assets. Everything
below is either a build/runtime dependency or a planned optional native dependency; items marked
**verify** must be confirmed against the exact artifact before it is bundled (§13 licensing checklist).

---

## Runtime dependencies (installed)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `react`, `react-dom` | ^19.3.0 | MIT | UI |
| `zod` | ^4.6.5 | MIT | every document that crosses a boundary |
| `zustand` | ^5.0.15 | MIT | durable stores |
| `immer` | ^11.0.0 | MIT | immutable store updates |
| `jotai` | ^3.0.1 | MIT | per-frame editor atoms |
| `motion` | ^14.0.0 | MIT | spring animation |
| `react-aria-components` | ^1.22.0 | Apache-2.0 | accessible behaviour primitives |
| `@tanstack/react-virtual` | ^3.14.13 | MIT | grid/filmstrip virtualisation |
| `date-fns` | ^4.1.0 | MIT | date formatting |
| `iconoir-react` | ^7.12.1 | MIT | the entire icon set |
| `tailwindcss`, `@tailwindcss/vite` | ^4.3.3 | MIT | styling |
| `@fontsource-variable/geist` | ^5.3.0 | MIT (package) / **OFL-1.1** (Geist Sans) | UI font |
| `@fontsource-variable/geist-mono` | ^5.3.0 | MIT (package) / **OFL-1.1** (Geist Mono) | numerics |
| `@fontsource-variable/bricolage-grotesque` | ^5.3.0 | MIT (package) / **OFL-1.1** | display font |
| `@fontsource-variable/fraunces` | ^5.3.0 | MIT (package) / **OFL-1.1** | editorial accent font |

## Development dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `vite`, `@vitejs/plugin-react` | ^7.3.7 / ^5.2.0 | MIT | dev server & build |
| `typescript` | 5.9.3 | Apache-2.0 | type system |
| `vitest` | 3.2.4 | MIT | unit tests |
| `@shaderfrog/glsl-parser` | ^7.0.1 | MIT | `npm run lint:shaders` |
| `@types/node`, `@types/react`, `@types/react-dom` | — | MIT | typings |

## Fonts

All four families are self-hosted under the **SIL Open Font License 1.1**, which permits bundling and
redistribution with the application provided the OFL text and copyright notices travel with them (the
`@fontsource-variable/*` packages ship both). Geist Sans and Geist Mono © Vercel Inc.; Bricolage
Grotesque © Mathieu Triay; Fraunces © Undercase Type (Phaedra Charles, Flavia Zimbardi). No font is
subsetting-modified, so no Reserved Font Name issue arises.

## Icons

Iconoir — MIT © Luca Burgio. The 1673-icon set is used unmodified through `iconoir-react`
(`strokeWidth={1.5}`, sizes 18/20/24, `currentColor`). The ten custom SVGs in
`apps/desktop/src/ui/icons/custom/` (Aperture, Brush, Contrast, Grain, Heal, Histogram, Layers,
Merge/Split, Red-eye, Stack) are **original work** created for Swell, drawn on Iconoir's grid and stroke
weight to match; they are not derived from any third-party artwork.

## Planned optional native dependencies (M3 — not installed here)

| Component | Licence | Notes |
| --- | --- | --- |
| Electron | MIT | bundles Chromium (BSD-3-Clause) and Node.js (MIT + additional notices) |
| `better-sqlite3` | MIT | SQLite itself is public domain |
| Drizzle ORM | Apache-2.0 | catalog driver |
| `onnxruntime-node` / `-web` | MIT | inference |
| napi-rs | MIT | Rust bindings |
| LibRaw | LGPL-2.1 **or** CDDL-1.0 (dual) | RAW decode — **verify** the chosen licence and ship the notice + relink terms |
| lensfun | LGPL-3.0 | lens profiles; its **database** is CC-BY-SA-3.0 — **verify** before bundling the DB |
| ExifTool | Perl licence (GPL-1+ or Artistic-2.0) | metadata read/write — **verify** which alternative is taken |
| libvips | LGPL-2.1+ | image I/O — **verify** |
| electron-builder | MIT | packaging |

LGPL components are dynamically linked and user-replaceable, with the relink instructions and the
license texts included in the packaged app's `LICENSES/` directory.

## Model weights — never redistributed

Weights are downloaded on demand by the models manager, checksum-verified, and cached locally. No weight
file is committed, and no download proceeds without a checksum (§8.5).

| Model class | Intended licence | Status |
| --- | --- | --- |
| BiRefNet-class matting | MIT (code) — **verify** the checkpoint | manifest present, not downloaded |
| Segment Anything (SAM/SAM 2) | Apache-2.0 — **verify** per checkpoint | manifest present |
| LaMa-style inpainting | Apache-2.0 (code); training data terms **verify** | heuristic substitute in use |
| ONNX model zoo detections | per-model — **verify each** | heuristic substitute in use |
| **RMBG-1.4 / BRIA-RMBG** | non-commercial — **excluded** | rejected by the licensing test |
| **Ultralytics YOLOv5/v8+** | AGPL-3.0 — **excluded** for a commercial desktop app | rejected by the licensing test |

`packages/models/src/__tests__/registry.test.ts` scans every shipped manifest for banned licence tokens
so a future addition cannot silently slip an AGPL or non-commercial weight into the catalog. Manifest
`notes` fields are excluded from that scan because they legitimately *name* the excluded models to
explain why they are not used.

## Data & profiles

- **No vendor DCP (Digital Camera Profile) files are redistributed.** Swell's camera and creative
  profiles are original parameter fragments authored for this app (§9.3).
- Demo catalog imagery in `apps/desktop/public/demo/photos/` is generated for this project and carries
  no third-party rights.

## Notice obligations summary

1. Ship the MIT and Apache-2.0 notices for the JS dependencies in the packaged app's `LICENSES/`.
2. Ship the OFL texts with the fonts.
3. For each LGPL component actually bundled: ship its licence text, the copyright notice, the source
   offer, and relink/replace instructions.
4. For each model checkpoint actually shipped or downloaded: record the verified licence in the manifest
   and surface it in the models manager.
5. Never bundle AGPL or non-commercial weights into a distributed build.
