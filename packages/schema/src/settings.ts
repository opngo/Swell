/** Application settings (§10.3) + the keyboard binding registry (§10). */

import { z } from 'zod';

export const DENSITIES = ['comfortable', 'compact', 'dense'] as const;
export type Density = (typeof DENSITIES)[number];

export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  comfortable: 36,
  compact: 30,
  dense: 26,
};

export const ACCENTS = [
  { id: 'sea-glass', label: 'Sea glass', oklch: 'oklch(0.78 0.12 200)' },
  { id: 'kelp', label: 'Kelp', oklch: 'oklch(0.76 0.13 155)' },
  { id: 'amber', label: 'Amber', oklch: 'oklch(0.80 0.13 78)' },
  { id: 'coral', label: 'Coral', oklch: 'oklch(0.74 0.15 30)' },
  { id: 'orchid', label: 'Orchid', oklch: 'oklch(0.74 0.14 330)' },
  { id: 'iris', label: 'Iris', oklch: 'oklch(0.72 0.14 285)' },
  { id: 'slate', label: 'Slate', oklch: 'oklch(0.78 0.03 250)' },
] as const;

export const settingsSchema = z.object({
  general: z
    .object({
      language: z.string().default('en'),
      startup: z.enum(['home', 'lastView', 'library']).default('lastView'),
      defaultCatalogId: z.string().optional(),
      notifications: z.boolean().default(true),
      confirmDelete: z.boolean().default(true),
      updateChannel: z.enum(['stable', 'beta']).default('stable'),
      shortcutPreset: z.enum(['swell', 'lrc']).default('swell'),
    })
    .prefault({}),
  appearance: z
    .object({
      theme: z.enum(['dark', 'light', 'auto']).default('dark'),
      accentId: z.string().default('sea-glass'),
      accentCustom: z.string().optional(),
      canvasBackdrop: z
        .enum(['neutral-dark', 'mid-gray', 'black', 'white', 'match-theme'])
        .default('neutral-dark'),
      density: z.enum(DENSITIES).default('compact'),
      uiScale: z.number().min(80).max(150).default(100),
      reduceMotion: z.boolean().default(false),
      highContrastFocus: z.boolean().default(false),
      uiFont: z.enum(['geist', 'inter', 'instrument-sans', 'manrope']).default('geist'),
      monoFont: z.enum(['geist-mono', 'jetbrains', 'plex', 'commit']).default('geist-mono'),
      displayFont: z.enum(['bricolage', 'sora', 'space-grotesk', 'jakarta']).default('bricolage'),
      animationIntensity: z.number().min(0).max(100).default(100),
      showFilmstrip: z.boolean().default(true),
      showLeftPanel: z.boolean().default(true),
      showRightPanel: z.boolean().default(true),
    })
    .prefault({}),
  performance: z
    .object({
      gpuBackend: z.enum(['webgl2', 'webgpu']).default('webgl2'),
      vramBudgetMB: z.number().min(256).max(12288).default(4096),
      ramBudgetMB: z.number().min(512).max(16384).default(1536),
      thumbCacheMB: z.number().min(64).max(2048).default(256),
      previewCacheMB: z.number().min(256).max(8192).default(768),
      decodedCacheMB: z.number().min(256).max(16384).default(1024),
      diskCacheGB: z.number().min(1).max(512).default(20),
      concurrency: z.number().min(1).max(32).default(0), // 0 = cores − 2
      memoryHud: z.boolean().default(false),
      powerMode: z.enum(['balanced', 'battery', 'performance']).default('balanced'),
      recycleEngineAfterHours: z.number().min(0).max(72).default(8),
      prefetchNeighbours: z.number().min(0).max(8).default(2),
      proxyLongEdge: z.number().min(1024).max(4096).default(2048),
    })
    .prefault({}),
  previews: z
    .object({
      standardLongEdge: z.number().min(1024).max(4096).default(1600),
      quality: z.number().min(40).max(100).default(86),
      buildOnImport: z
        .enum(['minimal', 'embedded', 'standard', '1to1', 'smart'])
        .default('standard'),
      discard1to1AfterDays: z.number().min(1).max(365).default(30),
      cacheLocation: z.string().default(''),
    })
    .prefault({}),
  catalog: z
    .object({
      path: z.string().default(''),
      backupSchedule: z.enum(['off', 'daily', 'weekly', 'onExit']).default('daily'),
      backupRetention: z.number().min(1).max(52).default(8),
      sidecarXmp: z.boolean().default(true),
      autoWriteSidecar: z.boolean().default(true),
      rawJpegHandling: z.enum(['stack', 'separate', 'rawOnly']).default('stack'),
      nameTemplate: z.string().default('{date}_{seq}_{original}'),
      optimizeOnExit: z.boolean().default(false),
    })
    .prefault({}),
  color: z
    .object({
      workingSpace: z.enum(['rec2020', 'prophoto']).default('rec2020'),
      displayProfile: z.string().default('sRGB IEC61966-2.1'),
      renderingIntent: z.enum(['perceptual', 'relative', 'saturation', 'absolute']).default('perceptual'),
      softProofProfile: z.string().default(''),
      blackPointCompensation: z.boolean().default(true),
      hdr: z.boolean().default(false),
      defaultSpace: z.enum(['srgb', 'displayP3', 'adobergb', 'prophoto', 'rec2020']).default('srgb'),
    })
    .prefault({}),
  ai: z
    .object({
      provider: z.enum(['auto', 'coreml', 'directml', 'cuda', 'cpu']).default('auto'),
      indexSchedule: z.enum(['always', 'idle', 'manual']).default('idle'),
      faceRecognition: z.boolean().default(false),
      offlineMode: z.boolean().default(false),
      unloadAfterIdleSec: z.number().min(0).max(3600).default(60),
      residentModels: z.number().min(0).max(3).default(1),
      autoKeywords: z.boolean().default(true),
      distractionDetection: z.boolean().default(true),
    })
    .prefault({}),
  privacy: z
    .object({
      telemetry: z.boolean().default(false),
      crashReports: z.boolean().default(false),
      localOnly: z.boolean().default(true),
    })
    .prefault({}),
  print: z
    .object({
      pageSize: z.string().default('A4'),
      marginsMm: z.number().default(10),
      cellsPerRow: z.number().min(1).max(12).default(4),
      gapMm: z.number().default(3),
      showFilenames: z.boolean().default(false),
      showRatings: z.boolean().default(true),
      printerProfile: z.string().default(''),
      sharpening: z.enum(['low', 'standard', 'high']).default('standard'),
    })
    .prefault({}),
});

export type Settings = z.output<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});

/* --------------------------------------------------------------------------
 * Keyboard shortcuts (§10)
 * ------------------------------------------------------------------------ */

export type ShortcutAction =
  | 'view.grid'
  | 'view.loupe'
  | 'view.survey'
  | 'view.compare'
  | 'view.develop'
  | 'view.curves'
  | 'view.layers'
  | 'view.retouch'
  | 'view.smart'
  | 'view.presets'
  | 'view.export'
  | 'view.home'
  | 'panels.toggleAll'
  | 'panels.toggleSides'
  | 'window.fullscreen'
  | 'window.lightsOut'
  | 'view.zoomToggle'
  | 'view.infoOverlay'
  | 'view.beforeAfterHold'
  | 'view.beforeAfter'
  | 'view.clipping'
  | 'rate.0'
  | 'rate.1'
  | 'rate.2'
  | 'rate.3'
  | 'rate.4'
  | 'rate.5'
  | 'flag.pick'
  | 'flag.reject'
  | 'flag.none'
  | 'label.red'
  | 'label.yellow'
  | 'label.green'
  | 'label.blue'
  | 'tool.crop'
  | 'tool.spot'
  | 'tool.mask'
  | 'tool.tat'
  | 'tool.overlay'
  | 'tool.wbDropper'
  | 'tool.spotVisualize'
  | 'tool.zoom'
  | 'tool.hand'
  | 'tool.softProof'
  | 'tool.removeBg'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copySettings'
  | 'edit.pasteSettings'
  | 'edit.copySettingsDialog'
  | 'edit.syncSettings'
  | 'edit.virtualCopy'
  | 'edit.resetParams'
  | 'edit.autoTone'
  | 'library.quickCollection'
  | 'library.stack'
  | 'library.filter'
  | 'library.delete'
  | 'library.next'
  | 'library.prev'
  | 'cull.autoAdvance'
  | 'export.dialog'
  | 'export.previous'
  | 'global.palette'
  | 'global.settings'
  | 'dev.memoryHud'
  | 'slider.increment'
  | 'slider.decrement';

export type Chord = { key: string; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean };

export const SWELL_SHORTCUTS: Record<ShortcutAction, string> = {
  'view.grid': 'g',
  'view.loupe': 'e',
  'view.survey': 'n',
  'view.compare': 'c',
  'view.develop': 'd',
  'view.curves': 'shift+d',
  'view.layers': 'shift+l',
  'view.retouch': 'shift+r',
  'view.smart': 'shift+s',
  'view.presets': 'shift+p',
  'view.export': 'mod+shift+e',
  'view.home': 'mod+shift+h',
  'panels.toggleAll': 'tab',
  'panels.toggleSides': 'shift+tab',
  'window.fullscreen': 'f',
  'window.lightsOut': 'l',
  'view.zoomToggle': 'z',
  'view.infoOverlay': 'i',
  'view.beforeAfterHold': '\\',
  'view.beforeAfter': 'y',
  'view.clipping': 'j',
  'rate.0': '0',
  'rate.1': '1',
  'rate.2': '2',
  'rate.3': '3',
  'rate.4': '4',
  'rate.5': '5',
  'flag.pick': 'p',
  'flag.reject': 'x',
  'flag.none': 'u',
  'label.red': '6',
  'label.yellow': '7',
  'label.green': '8',
  'label.blue': '9',
  'tool.crop': 'r',
  'tool.spot': 'q',
  'tool.mask': 'shift+m',
  'tool.tat': 't',
  'tool.overlay': 'o',
  'tool.wbDropper': 'w',
  'tool.spotVisualize': 'a',
  'tool.zoom': 'z',
  'tool.hand': 'h',
  'tool.softProof': 's',
  'tool.removeBg': 'mod+shift+b',
  'edit.undo': 'mod+z',
  'edit.redo': 'mod+shift+z',
  'edit.copySettings': 'mod+c',
  'edit.pasteSettings': 'mod+v',
  'edit.copySettingsDialog': 'mod+shift+c',
  'edit.syncSettings': 'mod+alt+v',
  'edit.virtualCopy': "mod+'",
  'edit.resetParams': 'mod+shift+r',
  'edit.autoTone': 'mod+u',
  'library.quickCollection': 'b',
  'library.stack': 'mod+g',
  'library.filter': 'mod+f',
  'library.delete': 'delete',
  'library.next': 'right',
  'library.prev': 'left',
  'cull.autoAdvance': 'shift+a',
  'export.dialog': 'mod+shift+e',
  'export.previous': 'mod+alt+shift+e',
  'global.palette': 'mod+k',
  'global.settings': 'mod+,',
  'dev.memoryHud': 'mod+alt+m',
  'slider.increment': 'up',
  'slider.decrement': 'down',
};

/** Lightroom-compatible alternates (Settings → Shortcuts → preset). */
export const LRC_SHORTCUTS: Partial<Record<ShortcutAction, string>> = {
  'view.curves': 'mod+shift+t',
  'view.layers': 'mod+shift+m',
  'view.retouch': 'q',
  'view.smart': 'mod+shift+f',
  'tool.removeBg': 'mod+shift+k',
};

export function resolveShortcutPreset(preset: 'swell' | 'lrc'): Record<ShortcutAction, string> {
  return preset === 'lrc' ? { ...SWELL_SHORTCUTS, ...LRC_SHORTCUTS } : { ...SWELL_SHORTCUTS };
}

/** Parse "mod+shift+e" into a Chord. `mod` maps to ⌘ on macOS, Ctrl elsewhere. */
export function parseChord(combo: string, isMac = false): Chord {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const chord: Chord = { key: '' };
  for (const p of parts) {
    if (p === 'mod') {
      if (isMac) chord.meta = true;
      else chord.ctrl = true;
    } else if (p === 'ctrl') chord.ctrl = true;
    else if (p === 'meta' || p === 'cmd' || p === 'super') chord.meta = true;
    else if (p === 'shift') chord.shift = true;
    else if (p === 'alt' || p === 'option') chord.alt = true;
    else chord.key = p;
  }
  return chord;
}

export function formatChord(combo: string, isMac = false): string {
  return combo
    .split('+')
    .map((p) => {
      const k = p.trim().toLowerCase();
      if (k === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (k === 'shift') return isMac ? '⇧' : 'Shift';
      if (k === 'alt') return isMac ? '⌥' : 'Alt';
      if (k === 'ctrl') return 'Ctrl';
      if (k === 'delete') return isMac ? '⌫' : 'Del';
      if (k === 'escape') return 'Esc';
      if (k === ' ') return 'Space';
      if (k === 'backslash') return '\\';
      if (k.length === 1) return k.toUpperCase();
      return k[0]!.toUpperCase() + k.slice(1);
    })
    .join(isMac ? '' : '+');
}

export function chordMatches(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, chord: Chord): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (key !== chord.key.toLowerCase()) return false;
  return (
    !!chord.ctrl === e.ctrlKey &&
    !!chord.meta === e.metaKey &&
    !!chord.shift === e.shiftKey &&
    !!chord.alt === e.altKey
  );
}
