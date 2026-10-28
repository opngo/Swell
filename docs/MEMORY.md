# Memory & performance

Swell treats memory as a product feature (§6). This document is the operating manual: what the budgets
are, what is allowed to cache, and how to prove a change did not regress either. Implementation:
`packages/shared/src/memory.ts`; the HUD: `apps/desktop/src/app/MemoryHud.tsx`.

---

## 1. Budgets (§6.1)

Total working budget **4 GB**, byte-accounted per pool:

| Pool | Budget | Holds | Eviction order |
| --- | --- | --- | --- |
| `embeddings` | 64 MB | concept/feature vectors for search | 1st |
| `thumbs` | 256 MB | 256 px grid thumbnails | 2nd |
| `standard` | 768 MB | 1440–2048 px previews | 3rd |
| `mattes` | 128 MB | rasterised masks (RLE/PNG) | 4th |
| `decoded` | 1 GB | decoded source bitmaps | 5th |
| `tiles` | 2 GB | 512 px tiles + mipmaps | 6th |
| `ml` | 1 GB | resident ONNX sessions | last |

Nothing caches itself privately. Every cached bitmap, buffer, tensor or session goes through
`MemoryBudget.pool(id)` (each pool is an `LruPool`), and `budget.totalBytes` / `budget.snapshot()` are
what the HUD reads — which is how it can tell the truth.

## 2. `LruPool`

LRU with **priority classes and exact byte accounting**:

```ts
pool.set(key, value, bytes, PRIORITY.current | .neighbour | .background)
pool.get(key)          // promotes recency
pool.trim(target)      // evicts by (priority, lastUsed) until under target, fires dispose hooks
pool.stats()           // { id, bytes, budget, items, hits, misses, evictions, hitRate }
```

Eviction picks the worst priority first, then the least recently used, so a `current` entry survives a
`background` flood. Replacing a key frees its old bytes **without** firing the disposer (that is not an
eviction); `trim` and `delete` do fire it, which is where GPU textures and ONNX sessions get released.

`MemoryBudget.relieve(target = 80 % of total, reason)` walks the pools in the §6.2 order and returns the
bytes freed; `onPressure(listener)` is what the HUD and the engine subscribe to.

## 3. Caching rules (§6.2)

- **GPU textures and framebuffers are reused by size class** from a pool (`engine/gl.ts`) instead of
  being reallocated per render. A tier change reuses the closest larger buffer.
- **Undo stores param deltas**, never documents and never pixels (§7.2). History keeps a `base` doc plus
  ≤120 diffs per photo; when the window slides, dropped diffs are folded into `base`.
- **LUT rebuilds and inpaint results are cached by content hash** (`fnv1a` / `signatureOf`), so dragging
  an unrelated slider does not re-bake curves or re-run removal iterations.
- **Masks are vectors** (§6.4): strokes, gradient handles and range endpoints live in the param
  document. The rasterised atlas is a derived cache in `mattes`, always rebuildable, and is evicted
  before anything that would cost a re-decode.
- **Models unload after 60 s idle** (configurable in Settings → AI) and residency obeys the `ml` budget.

## 4. Navigation & prefetch (§6.3)

Prefetch ±2 neighbours of the active photo so arrow-key navigation never stalls. Prefetch is cancelled
on direction change and always yields to the active render: a neighbour thumbnail is never allowed to
delay the photo the user is looking at.

## 5. Quality policy (§5.3)

| Situation | Tier |
| --- | --- |
| Scrubbing, dragging a slider, zoom animation | proxy, long edge `min(native, 2048)` |
| ~120 ms after the last interaction | full, long edge `min(native, 4096)` |
| Grid / filmstrip | thumb 256, standard 1440–2048 on demand |
| Offline / missing source | smart preview 2560 |

The histogram is read back from a 176 × 132 stats FBO at **≤15 Hz**, never per frame (§5.2).

## 6. Concurrency (§6.5)

Worker concurrency is `cores − 2`, clamped to ≥1. The index queue has three priorities
(`current → neighbour → background`) so re-indexing a library never competes with the visible photo.
The UI renderer, the engine and the worker pool never share a frame budget.

## 7. Pressure & hidden tabs (§6.6)

On `memoryPressure`, or when the tab/window is hidden, caches are trimmed in priority order and the
engine frees everything except the source texture (`engine.trimCaches()`, which drains the GPU texture pool). Nothing is freed that
would cost a re-decode of the photo currently on screen.

## 8. Proving it

- `packages/shared/src/__tests__/memory.test.ts` — 18 tests: byte accounting, priority-then-LRU
  eviction, disposer firing on `trim`/`delete` but not on replace, `relieve()` walking pools in order,
  hit-rate maths, and the documented default budgets (§6.1) themselves.
- **Memory HUD** (`Ctrl/⌘+Alt+M`) — per-pool bytes, budget bars, items, hit rate, evictions and the
  pressure log. If a change cannot be seen in the HUD, it is not instrumented.
- **Soak**: navigate a large catalog, drag sliders, apply masks and run removals while watching total
  bytes; the curve must return to baseline after idle. A monotonic climb is a leak, not a cache.

## 9. Adding a cache — checklist

- [ ] Pick an existing pool; a new `PoolId` needs a budget here and in `DEFAULT_BUDGETS`.
- [ ] Pass an accurate `bytes` (use `byteSizeOf` for plain data; width × height × channels for images).
- [ ] Set a priority: `current` for the visible photo, `neighbour` for prefetch, `background` for the rest.
- [ ] Supply a disposer if the value owns GPU/ML resources.
- [ ] Make it derivable — anything that cannot be rebuilt from the param document or the source file
      does not belong in a cache.
- [ ] Add a test that evicts it.
