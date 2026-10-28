/**
 * Versioned param migrations (§7.2).
 *
 * A migration registry upgrades older `DevelopParams` documents on load. Every
 * migration is a pure function so it can be unit-tested and replayed in order.
 *
 *     migrate(params) → { params: current, applied: ['1→2', '2→3'] }
 */

import { PARAMS_VERSION, developParamsSchema, type DevelopParams } from './params.ts';

export type Migration = {
  from: number;
  to: number;
  label: string;
  run: (p: Record<string, unknown>) => Record<string, unknown>;
};

export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    label: '1→2 curves.tone → curves.luma, hue curve split',
    run: (p) => {
      const curves = (p['curves'] ?? {}) as Record<string, unknown>;
      if (curves['tone'] && !curves['luma']) curves['luma'] = curves['tone'];
      delete curves['tone'];
      // v1 stored a single `hue` array used for H↔H; split into hh/hs/hl.
      const hue = curves['hue'] as unknown[] | undefined;
      if (hue && !curves['hueCurves']) {
        curves['hueCurves'] = { hh: hue, hs: [], hl: [], ls: [], ss: [] };
      }
      delete curves['hue'];
      p['curves'] = curves;
      return p;
    },
  },
  {
    from: 2,
    to: 3,
    label: '2→3 local adjustments → layer stack',
    run: (p) => {
      // v2 kept `locals: [{ mask, exposure, ... }]`; v3 uses `layers`.
      const locals = p['locals'] as Record<string, unknown>[] | undefined;
      if (locals && Array.isArray(locals) && !p['layers']) {
        p['layers'] = locals.map((l, i) => ({
          id: `layer_${i}_${(l['id'] as string) ?? ''}`.replace(/__+$/, ''),
          kind: 'adjustment',
          name: (l['name'] as string) ?? `Local ${i + 1}`,
          visible: true,
          locked: false,
          opacity: 100,
          fill: 100,
          blend: 'normal',
          masks: l['mask'] ? [l['mask']] : [],
          adjust: {
            exposure: l['exposure'] ?? 0,
            contrast: l['contrast'] ?? 0,
            highlights: l['highlights'] ?? 0,
            shadows: l['shadows'] ?? 0,
            whites: l['whites'] ?? 0,
            blacks: l['blacks'] ?? 0,
            texture: l['texture'] ?? 0,
            clarity: l['clarity'] ?? 0,
            dehaze: l['dehaze'] ?? 0,
            temp: l['temp'] ?? 0,
            tint: l['tint'] ?? 0,
            vibrance: l['vibrance'] ?? 0,
            saturation: l['saturation'] ?? 0,
            sharpness: 0,
            noise: 0,
            moire: 0,
            defringe: 0,
            grain: 0,
            glow: 0,
            halation: 0,
            soften: 0,
            curvesLuma: [],
            curvesR: [],
            curvesG: [],
            curvesB: [],
            gradeHue: 0,
            gradeSat: 0,
          },
        }));
      }
      delete p['locals'];
      // `bgRemoval` used to live at `removeBackground`
      if (p['removeBackground'] && !p['bgRemoval']) p['bgRemoval'] = p['removeBackground'];
      delete p['removeBackground'];
      return p;
    },
  },
];

export type MigrateResult = { params: DevelopParams; applied: string[]; fromVersion: number };

/** Deep copy so migrations never touch the caller's document (§7.2: pure). */
function cloneDoc(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  try {
    return structuredClone(raw) as Record<string, unknown>;
  } catch {
    return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  }
}

export function migrate(raw: unknown): MigrateResult {
  const applied: string[] = [];
  let doc = cloneDoc(raw);
  let version = typeof doc['v'] === 'number' ? (doc['v'] as number) : 1;
  const fromVersion = version;

  if (version > PARAMS_VERSION) {
    // A document written by a newer build: parse what this version understands
    // but keep its stamp, so re-saving cannot claim (and flatten) newer fields.
    return { params: developParamsSchema.parse(doc), applied, fromVersion };
  }

  // Guard against a runaway registry.
  let guard = 0;
  while (version < PARAMS_VERSION && guard++ < 64) {
    const m = MIGRATIONS.find((x) => x.from === version);
    if (!m) break;
    doc = m.run(doc);
    applied.push(m.label);
    version = m.to;
  }
  doc['v'] = PARAMS_VERSION;
  return { params: developParamsSchema.parse(doc), applied, fromVersion };
}

/** Register a new migration at runtime (plugins, future versions). */
export function registerMigration(m: Migration): void {
  MIGRATIONS.push(m);
  MIGRATIONS.sort((a, b) => a.from - b.from);
}
