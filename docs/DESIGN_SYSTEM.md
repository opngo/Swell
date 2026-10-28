# Design system

The visual and interaction contract for every surface in Swell. Section references are to
`docs/SPEC.md` §3; tokens live in `apps/desktop/src/styles/tokens.css`, primitives in
`apps/desktop/src/ui/`.

---

## 1. The one rule: no borders

There is no `border`, no divider, no `outline`, no `ring-*` anywhere in UI chrome. Separation is
produced by six things, in this order of preference:

1. **Tonal elevation** — a raised surface is *lighter*, not outlined.
2. **Spacing** — `--pad-panel`, `--pad-section`, and the `Gap` primitive.
3. **Shadow** — `--e1` (resting), `--e2` (floating), `--e3` (modal), `--e-inset` (pressed wells).
4. **Blur + scrim** — overlays and popovers.
5. **Shape** — radius steps and pill forms.
6. **Motion** — a state change is animated rather than annotated.

The single sanctioned exception is the **guide overlay drawn on photo content** (thirds, centre, golden
ratio, custom lines): that is image content, luminance-adaptive, toggleable, and never chrome.

This is enforced mechanically: `npm run lint:borderless` scans `apps/desktop/src`, `apps/desktop/engine`,
`apps/desktop/electron` and `packages`, strips comments, looks only at quoted spans, distinguishes CSS
rules from class names, ignores `-none`/`-0` resets, skips prose (3+ word hyphen-free spans), and honours
an explicit `borderless-allow:` comment. CI fails on any hit.

## 2. Tokens

### Surfaces (`--color-s0 … --color-s6`, OKLCH, dark-first)

`s0` is the window floor, `s1` a panel, `s2` a raised card, `s3` a control, `s4`–`s6` hover/active/high
emphasis. Text is `--color-t1` (primary), `--color-t2` (secondary), `--color-t3` (tertiary/disabled).
`--canvas` is the backdrop behind a photo and must stay neutral — users judge colour on it.

### Accent & status

`--color-accent` (default `oklch(0.78 0.12 200)`, user-overridable via `--swell-accent`),
`--color-accent-soft` (16 % halo), `--color-accent-deep`, `--color-on-accent`, plus
`--color-ok / --color-warn / --color-danger / --color-info`. Status colours are used for meaning only —
never as decoration, and never as the sole channel (always paired with an icon or label).

### Shape

`--radius-xs 6 · --radius-sm 10 · --radius-md 14 · --radius-lg 20 · --radius-xl 28 · --radius-pill 999`.

### Type

Geist Sans (`--font-sans`), Geist Mono (`--font-mono`, all numerics), Bricolage Grotesque
(`--font-display`), Fraunces (`--font-accent`, editorial moments). Scale
`--text-2xs 11 · xs 12 · sm/base 13 · md 15 · lg 18 · xl 24 · 2xl 32`. All self-hosted (OFL). Every
numeric readout uses `tabular-nums` (§2.5) so a slider value never reflows its row.

### Density & scale

`--row-h` is 30 px at default density, 36 comfortable, 26 compact; `--pad-panel`/`--pad-section` follow.
`--ui-scale` (80–150 %) multiplies the root font size so rem layout scales without JS re-measurement.

### Focus

`--halo` = a 3 px accent-soft ring **plus** a surface lift; `--halo-strong` for high-emphasis contexts
and for the reduced-contrast safety case. Focus is never an `outline` and never a border — but it is
always visible.

## 3. Primitives

`Button`, `IconButton`, `Toolbar`, `Panel`, `PanelHeader`, `Section`, `GroupTitle`, `FieldRow`,
`KeyValue`, `Stat`, `Badge`, `Chip`, `Keycap`, `Rating`, `PickState`, `Switch`, `SegmentedControl`,
`Select`, `Tabs`, `Slider`, `NumberField`, `TextField`, `SearchField`, `ColorField`, `Menu`, `MenuList`,
`ContextMenu`, `Popover`, `Tooltip`, `Modal` (+`ModalHeader/Body/Footer`), `Sheet`, `Overlay`,
`Progress`, `Spinner`, `EmptyState`, `Histogram`, `HistogramStats`, `ToastHost`, `Gap`, `SwIcon`.

Conventions:

- Behaviour (focus management, keyboard semantics, ARIA) comes from **React Aria Components**; the
  primitive only supplies visuals. Never hand-roll a listbox or a dialog.
- `Modal` takes `label` + `size`; overlays portal to `document.body` at z ≥ 9000
  (info card 8800, activity centre 9060, memory HUD 9080, palette 9210, toasts 9600).
- `cx.ts` is the class joiner. Class strings are literal so the borderless lint can read them.
- No primitive accepts a `border`/`outline` prop; if a design needs an edge, it needs a shadow or a
  tonal step instead.

## 4. Motion (`ui/motion.ts`)

Three springs, no durations: `snappy` (520/38/0.7) for controls and focus, `smooth` (320/30/0.9) for
panels, overlays and route changes, `swell` (180/22/1.0) for expressive reveals. Two easing curves
(`--ease-out-soft`, `--ease-in-out-soft`) exist for non-spring transitions such as progress fills.

`useReducedMotion()` is **OS preference OR the in-app toggle**; every animated component reads it, and
both collapse transitions to instant. **Never animate pixels**: the photo surface is not a motion
target — crop, zoom and before/after move the *view*, and a render either is ready or shows the previous
tier (§3.4, §5.3).

## 5. Iconography (§11)

Iconoir only, `strokeWidth={1.5}`, sizes 18 / 20 / 24, colour `currentColor`. Concepts Iconoir lacks get
custom SVGs in `ui/icons/custom/` drawn on the same 24 px grid and stroke weight: `Aperture`, `Brush`,
`Contrast`, `Grain`, `Heal`, `Histogram`, `Layers`, `Merge`/`Split`, `RedEye`, `Stack`. `ui/icons.tsx`
holds the concept → component map (`ICONS`) plus late aliases; `SwIcon` is the single entry point, so a
concept name is used everywhere instead of an import.

## 6. Layout & shell (§3.1)

Module rail 56 px · side panel 224 (min 180) · inspector 340 (min 280, max 560) · top bar 46 · status
bar 26 · filmstrip 96. The rail and status bar span the full window width. Pages 4–7 share one editor
shell so switching tools never re-decodes.

## 7. Writing

Sentence case for labels, title case only for page names. Values always carry units. Errors say what
happened and what to do ("Model download failed the checksum — try again"), never an error code alone.
Toasts are for completions and recoverable failures; anything long-running belongs in the activity
centre (§6.7). Placeholders are labelled as placeholders (§1.8).

## 8. Checklist for a new surface

- [ ] No border/divider/outline/ring — separation via tone, space, shadow, shape or motion.
- [ ] Tokens only: no hex/rgb literals, no px radii, no ad-hoc `toFixed()`.
- [ ] Keyboard reachable, with a visible `--halo` focus state and a real role/name.
- [ ] `tabular-nums` on every numeric readout.
- [ ] Motion uses a spring preset and honours `useReducedMotion()`.
- [ ] Icons are 18/20/24, `strokeWidth={1.5}`, `currentColor`.
- [ ] `npm run lint:borderless` passes without a new allow comment.
