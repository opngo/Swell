# Render pipeline

What happens between "`DevelopParams` changed" and pixels on screen. All section references are to
`docs/SPEC.md`; the shader sources are in `packages/shaders/src/passes.ts`, the driver in
`apps/desktop/engine/engine.ts`, and the param → uniform baking in `apps/desktop/engine/uniforms.ts`.

---

## Orientation contract

**Every texture and FBO stores image space with `t = 0` at the image top.** Only `OUTPUT_FRAG` flips
once, when presenting to the canvas. Consequences:

- UI mask coordinates are normalised image space, origin top-left, y down — the same space the shaders
  sample in, so a brush dab at `(0.25, 0.75)` lands where the user clicked.
- `engine.capture()` row-flips when it builds an `ImageData`, because `readPixels` returns bottom-up.
- `preserveDrawingBuffer: true` is on, which is what makes the 1×1 eyedropper (`pickColor`) work.

## Pass chain

```
source (decoded bitmap, RGBA8)
  └─ srcTex
      │ LINEARIZE_FRAG            sRGB → linear Rec.2020, camera matrix, WB gains
      ▼ linTex (RGBA16F where supported, else RGBA8 + toast)
      │ REMOVAL_FRAG  ×N          inpaint ping-pong, hash-cached
      ▼ cleanTex                  (10 iterations, 3 when the caller asks for `fast`)
      │ gaussian(radius 1.4) → gaussian(radius 3.2)     two blurred mips
      ▼ blurSmall, blurLarge      clarity / texture / dehaze / glow / local contrast
      │ MASK_FRAG  per layer      gl.viewport(slot * 256, 0, 256, tileH)
      ▼ maskAtlas (R8, 2048 × tileH)
      │ DEVELOP_FRAG              tone, presence, mixer, grading, curves LUTs, layer stack
      ▼ workTex  (+ beforeTex for the unedited side of a before/after split)
      │ OUTPUT_FRAG               crop, zoom/pan, flips, overlays, soft proof, display transform
      ▼ canvas
```

Plus a **stats pass**: the same develop result re-rendered into a 176 × 132 FBO and read back with
`readPixels` to build the histogram and the clipping counts — throttled to `histogramHz = 15` (§5.2).

### Mask atlas

`MASK_TILES = 8` (= `MAX_LAYERS`, §5.7) tiles of `MASK_TILE_W = 256` px in one R8 texture, so a layer's
mask is addressed as `vec2((float(i) + uv.x) / 8.0, uv.y)`. Tile height follows the source aspect:
`round(256 * srcH / srcW)`, clamped to 16…512. The atlas is rebuilt only when a content hash of the
mask draws changes (`fnv1a` over slot, kind, vectors, stroke circles, tile height and source id), so
dragging an unrelated slider costs nothing here.

### Inpainting cache

`REMOVAL_FRAG` results are cached by a hash of the removal list plus the source id: re-rendering after a
tone change reuses the cleaned image instead of re-running ten iterations.

## Quality tiers (§5.3)

| Tier | Long edge | When |
| --- | --- | --- |
| proxy | `min(native, 2048)` | scrubbing, dragging, zoom animation |
| full | `min(native, 4096)` | ~120 ms after the last interaction |

`useEngine` owns the policy: it renders the proxy immediately on every param change and schedules the
refine with a debounce that is cancelled by the next change. Prefetch keeps ±2 neighbours decoded
(§6.3) so arrow-key navigation renders from a warm source.

## Coordinates (§4.4, `src/editor/coords.ts`)

Two mappings, both pure and both unit-tested:

- `fitCanvas(cssSize, sourceSize, zoom, dpr)` — 24 px padding, contain-fit, then × zoom; the backing
  buffer is `max(1, round(css * dpr))`.
- `viewRect(zoom, panX, panY)` — the visible window in normalised source space:
  `size = 1 / max(zoom, 1e-4)`, `x = min(clamp01(0.5 + pan − size/2), max(0, 1 − size))`, so panning
  is clamped at every zoom level and a sub-100 % zoom centres instead of drifting.

`canvasToSource` walks view → crop → rotate (`+angle`) → source with flips applied last;
`sourceToCanvas` is its exact inverse (asserted round-trip). `clientToSource` adds the canvas bounding
rect and an `inside` flag for brush work, and `brushRadiusSource` converts a screen-space brush size
into source space so a dab is the same physical size at any zoom.

In `OUTPUT_FRAG` the screen → source transform is:

```glsl
vec2 p   = uView + s * uViewSize;      // s = screen uv
vec2 rel = p - 0.5;
rel.x   *= uCropAspect;                // undo the non-square pixel space
rel      = rot(-uRotate) * rel;
rel.x   /= uCropAspect;
vec2 src = uCrop.xy + (rel + 0.5) * uCrop.zw;
// then flips
```

## Curves

Curves are evaluated **on the CPU into LUTs**, then sampled in `DEVELOP_FRAG` — a 4096-entry 1D LUT is
cheaper and more predictable than evaluating a monotone cubic per pixel (§5.4, §5.5).

Encoding:

| Uniform | Contents |
| --- | --- |
| `uLutRgb` | one texel per input luma/code value, packing `(r, g, b)` for the RGB and per-channel point curves |
| `uLutHue` | RGBA = Hh, Hs, Hl, Ls — the four hue curves, encoded `v * 0.5 + 0.5` because the values are signed deltas |
| `uLutHue2` | R = the saturation curve |
| `uLutCube` | a `.cube`/`.3dl` LUT uploaded as WebGL2 `TEXTURE_3D` with its own amount |

Domain and range:

- Curve space is perceptual with `K = 12`; point `y` is clamped to **−0.5 … 1.5** so a curve can pull
  below black or above white without producing an invalid LUT.
- **Luma curves apply as `rgb *= f(Y) / Y`** — a ratio, not a per-channel remap — so hue is preserved
  and a highlight lift cannot desaturate.
- **Hue curves are periodic in OKLCH hue.** `samplePeriodic` needs at least two points; with fewer it
  uses an all-zero table, i.e. a no-op. A single-point hue curve therefore does nothing by design.
- The **parametric curve** is a four-band partition of unity over shadows/midtones/highlights with
  three split handles; composing it with a point curve is exact wherever the parametric band has zero
  weight (the composition test samples the toe, `x ≈ 0.12`, not the middle).
- Interpolation between points is **monotone cubic** (no overshoot, so a tone curve cannot invert) with
  per-point smooth/linear flags.
- Local curves ride on layers (§4.6): each adjustment layer carries its own curve set and bakes its own
  LUT, which is why the LUT rebuild budget is per-layer-signature and cached by hash.

Rebuilds are skipped when `signatureOf(params)` is unchanged, and `EngineClient` only fills
`luts.cube`/`cubeAmount` after `buildCurveLuts(params)`; callers that do not need curves pass
`EMPTY_LUTS`.

## Colour (§5.6, §5.7)

Order of operations inside `DEVELOP_FRAG` / `LINEARIZE_FRAG`:

1. Decode → **linear Rec.2020** (working space).
2. White balance: CPU-computed `uWbGain` — the *reciprocal* of the illuminant colour, luma-normalised,
   clamped 0.2…4. Positive tint is magenta.
3. Exposure multiplies in linear light.
4. Contrast, highlights, shadows, whites, blacks act in the **encoded luma domain**.
5. Curves LUTs (§Curves).
6. Vibrance/saturation and the grading wheels in **OKLab**.
7. HSL mixer: 8 triangular bands (centres .080 .150 .262 .400 .540 .690 .815 .920, width .118).
8. Calibration primaries and geometry as CPU `mat3`s.
9. Soft proof: `proofMatrices(space, enabled)` gives `{proof: 2020 → space, display: space → sRGB}`;
   disabled it is `{identity, 2020 → sRGB}`. The invariant
   `spaceToSrgb(s) · from2020(s) ≈ from2020('srgb')` is asserted in tests.
10. Display transform + gamma in `OUTPUT_FRAG`, after the crop/zoom maths.

## Layers on the GPU (§4.6, §5.7)

`packLayers(params, aspect)` walks the root layers, skips hidden ones, multiplies a group's opacity into
its children, applies solo, and then packs at most `MAX_LAYERS = 8` slots into fixed arrays:

| Array | Contents |
| --- | --- |
| `op[i]` | `(opacity, blendIndex, hasMask, kind)` — kind 0 adjustment, 1/2 image slot, 3 fill |
| `adjA…adjD[i]` | the 16 adjustment sliders, four per vec4 |
| `img[slot]` / `img2[slot]` | `(x, y, scale, rotation)` and `(aspectRatio, flipH, flipV, fill)` |
| `fill[i]` / `fill2[i]` | working-space colour + kind index, and the second colour + gradient angle |
| `maskDraws[]` | one draw per masked layer: kind, `maskA/B/C`, `range`, matte mode, stroke circles |

Blend modes, mask kinds, clipping modes, background kinds and before/after modes are integer tables
mirroring the shader `switch` statements; both sides are pinned by `engine/__tests__/uniforms.test.ts`.

## Failure behaviour

- No half-float render target → fall back to RGBA8 with a toast (banding is better than a blank canvas).
- Shader compile/link failure at runtime → unedited `<img>` fallback plus a toast, and the engine
  reports itself unavailable so the UI stops sending renders.
- `MIN_FRAGMENT_UNIFORM_VECTORS` is 224, so `DEVELOP_FRAG` is kept under ~160 `vec4` uniforms; adding a
  slider array means checking that budget.
- GLSL has no compiler in CI, so `npm run lint:shaders` parses every exported program with
  `@shaderfrog/glsl-parser`. Reserved-word collisions (`smooth`, `patch`, `fixed`) are the classic
  failure this catches.
