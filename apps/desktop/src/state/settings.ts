import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  ACCENTS,
  DENSITIES,
  SWELL_SHORTCUTS,
  defaultSettings,
  resolveShortcutPreset,
  type Density,
  type Settings,
  type ShortcutAction,
} from '@swell/schema';

export { ACCENTS, DENSITIES };

/* -------------------------------------------------------------------------- */
/*  Settings store (§10.3) — persisted, and mirrored onto <html> as CSS vars   */
/* -------------------------------------------------------------------------- */

export function accentColor(id: string, custom?: string): string {
  if (custom && custom.trim()) return custom.trim();
  return ACCENTS.find((a) => a.id === id)?.oklch ?? ACCENTS[0].oklch;
}

export function applySettingsToDom(s: Settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const accent = accentColor(s.appearance.accentId, s.appearance.accentCustom);
  root.style.setProperty('--swell-accent', accent);
  root.style.setProperty('--swell-accent-soft', `color-mix(in oklch, ${accent} 22%, transparent)`);
  root.style.setProperty('--swell-accent-deep', `color-mix(in oklch, ${accent} 82%, black)`);
  root.style.setProperty('--ui-scale', String(s.appearance.uiScale / 100));
  root.dataset.density = s.appearance.density;
  root.dataset.backdrop = s.appearance.canvasBackdrop;
  root.dataset.reduceMotion = String(s.appearance.reduceMotion);
  root.dataset.contrastFocus = String(s.appearance.highContrastFocus);
  root.dataset.theme = s.appearance.theme;
  root.dataset.motionLevel = String(s.appearance.animationIntensity);
  root.classList.toggle('light', s.appearance.theme === 'light');
  root.classList.toggle('dark', s.appearance.theme !== 'light');
  document.body.style.fontSize = `calc(13px * ${s.appearance.uiScale / 100})`;
}

export interface SettingsState {
  settings: Settings;
  shortcuts: Record<ShortcutAction, string>;
  /** resolved values used all over the UI */
  accent: string;
  density: Density;
  reduceMotion: boolean;
  uiScale: number;

  /** `set('appearance', { accentId: 'amber' })` */
  set: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void;
  setShortcutPreset: (preset: 'swell' | 'lrc') => void;
  rebind: (action: ShortcutAction, combo: string) => void;
  resetShortcuts: () => void;
  reset: () => void;
}

const initial = defaultSettings();

export const useSettings = create<SettingsState>()(
  persist(
    immer((set, get) => ({
      settings: initial,
      shortcuts: { ...SWELL_SHORTCUTS },
      accent: accentColor(initial.appearance.accentId),
      density: initial.appearance.density,
      reduceMotion: initial.appearance.reduceMotion,
      uiScale: initial.appearance.uiScale / 100,

      set: (section, patch) =>
        set((st) => {
          Object.assign(st.settings[section] as object, patch);
          st.accent = accentColor(st.settings.appearance.accentId, st.settings.appearance.accentCustom);
          st.density = st.settings.appearance.density;
          st.reduceMotion = st.settings.appearance.reduceMotion;
          st.uiScale = st.settings.appearance.uiScale / 100;
          applySettingsToDom(st.settings);
        }),

      setShortcutPreset: (preset) =>
        set((st) => {
          st.settings.general.shortcutPreset = preset;
          st.shortcuts = resolveShortcutPreset(preset);
        }),

      rebind: (action, combo) =>
        set((st) => {
          st.shortcuts[action] = combo;
        }),

      resetShortcuts: () =>
        set((st) => {
          st.shortcuts = resolveShortcutPreset(st.settings.general.shortcutPreset);
        }),

      reset: () =>
        set((st) => {
          st.settings = defaultSettings();
          st.shortcuts = resolveShortcutPreset('swell');
          st.accent = accentColor(st.settings.appearance.accentId);
          st.density = st.settings.appearance.density;
          st.reduceMotion = st.settings.appearance.reduceMotion;
          st.uiScale = st.settings.appearance.uiScale / 100;
          applySettingsToDom(st.settings);
        }),
    })),
    {
      name: 'swell.settings.v1',
      version: 1,
      partialize: (s) => ({ settings: s.settings, shortcuts: s.shortcuts }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined;
        if (!p) return current;
        // deep-merge so newly added settings keys keep their defaults
        const merged = { ...current, ...p } as SettingsState;
        merged.settings = { ...defaultSettings(), ...(p.settings ?? {}) } as Settings;
        for (const key of Object.keys(defaultSettings()) as (keyof Settings)[]) {
          (merged.settings as Record<string, unknown>)[key] = {
            ...(defaultSettings()[key] as object),
            ...((p.settings?.[key] ?? {}) as object),
          };
        }
        merged.shortcuts = { ...SWELL_SHORTCUTS, ...(p.shortcuts ?? {}) };
        merged.accent = accentColor(merged.settings.appearance.accentId, merged.settings.appearance.accentCustom);
        merged.density = merged.settings.appearance.density;
        merged.reduceMotion = merged.settings.appearance.reduceMotion;
        merged.uiScale = merged.settings.appearance.uiScale / 100;
        return merged;
      },
      onRehydrateStorage: () => (state) => {
        if (state) applySettingsToDom(state.settings);
      },
    },
  ),
);

/** Non-reactive read for code outside React (engine, workers, shortcut bus). */
export const getSettings = (): Settings => useSettings.getState().settings;
export const getShortcuts = () => useSettings.getState().shortcuts;

applySettingsToDom(initial);

/** Convenience selectors used by many components. */
export const useDensity = () => useSettings((s) => s.density);
export const useAccent = () => useSettings((s) => s.accent);
