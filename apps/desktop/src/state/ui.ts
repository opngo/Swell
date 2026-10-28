import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import type { BeforeAfterState, OverlayState, SoftProofState } from '@swell/schema';
import { emptyOverlays } from '@swell/schema';

/* -------------------------------------------------------------------------- */
/*  Route + shell state (§4, §10)                                              */
/* -------------------------------------------------------------------------- */

export const ROUTES = [
  'home',
  'library',
  'cull',
  'develop',
  'curves',
  'layers',
  'retouch',
  'smart',
  'presets',
  'export',
] as const;

export type RouteId = (typeof ROUTES)[number];

export const ROUTE_META: Record<RouteId, { label: string; icon: string; num: number; group: string }> = {
  home: { label: 'Home & Import', icon: 'home', num: 1, group: 'Ingest' },
  library: { label: 'Library', icon: 'library', num: 2, group: 'Organise' },
  cull: { label: 'Cull & Compare', icon: 'cull', num: 3, group: 'Organise' },
  develop: { label: 'Develop', icon: 'develop', num: 4, group: 'Edit' },
  curves: { label: 'Light & Curves', icon: 'curves', num: 5, group: 'Edit' },
  layers: { label: 'Layers & Masking', icon: 'layers', num: 6, group: 'Edit' },
  retouch: { label: 'Remove & Retouch', icon: 'retouch', num: 7, group: 'Edit' },
  smart: { label: 'Smart Detect & Search', icon: 'smart', num: 8, group: 'Discover' },
  presets: { label: 'Presets & History', icon: 'presets', num: 9, group: 'Discover' },
  export: { label: 'Export & Print', icon: 'export', num: 10, group: 'Output' },
};

/** Pages 4–7 share one editor shell (stage + right panel + filmstrip). */
export const EDITOR_ROUTES: RouteId[] = ['develop', 'curves', 'layers', 'retouch'];

export type RightPanel = 'adjust' | 'mask' | 'detail' | 'history' | 'meta' | 'background';

export interface ViewState {
  zoom: number; // 1 = fit, >1 = magnification
  panX: number;
  panY: number;
  mode: 'fit' | 'fill' | '100' | 'custom';
}

interface UiState {
  route: RouteId;
  prevRoute: RouteId;
  rightPanel: RightPanel;
  leftOpen: boolean;
  rightOpen: boolean;
  filmstripOpen: boolean;
  paletteOpen: boolean;
  activityOpen: boolean;
  memoryHudOpen: boolean;
  shortcutsOpen: boolean;
  modelsOpen: boolean;
  /** inspector tab inside the editor right panel */
  editorTab: string;
  overlays: OverlayState;
  beforeAfter: BeforeAfterState;
  softProof: SoftProofState;
  guidesVisible: boolean;
  view: ViewState;
  /** which photo the editor is showing (null = follow selection) */
  focusPhotoId: string | null;
  /** compare/cull layout */
  compareCount: number;
  surveyCount: number;
  /** last visited route per photo so "back" returns sensibly */
  routeHistory: RouteId[];
  spotlight: string | null;

  go: (r: RouteId) => void;
  back: () => void;
  setRightPanel: (p: RightPanel) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleFilmstrip: () => void;
  setPalette: (v: boolean) => void;
  setActivity: (v: boolean) => void;
  setMemoryHud: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setModels: (v: boolean) => void;
  setEditorTab: (t: string) => void;
  patchOverlays: (p: Partial<OverlayState>) => void;
  patchBeforeAfter: (p: Partial<BeforeAfterState>) => void;
  patchSoftProof: (p: Partial<SoftProofState>) => void;
  setView: (v: Partial<ViewState>) => void;
  setFocus: (id: string | null) => void;
  setCompareCount: (n: number) => void;
  setSurveyCount: (n: number) => void;
  setGuides: (v: boolean) => void;
  setSpotlight: (id: string | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    immer((set, get) => ({
      route: 'home',
      prevRoute: 'home',
      rightPanel: 'adjust',
      leftOpen: true,
      rightOpen: true,
      filmstripOpen: true,
      paletteOpen: false,
      activityOpen: false,
      memoryHudOpen: false,
      shortcutsOpen: false,
      modelsOpen: false,
      editorTab: 'light',
      overlays: emptyOverlays(),
      beforeAfter: { mode: 'off', split: 0.5, params: null },
      softProof: {
        enabled: false,
        profile: 'srgb',
        intent: 'perceptual',
        blackPoint: true,
        simulatePaper: false,
        paperWhite: '#f5f5f2',
      },
      guidesVisible: false,
      view: { zoom: 1, panX: 0, panY: 0, mode: 'fit' },
      focusPhotoId: null,
      compareCount: 2,
      surveyCount: 4,
      routeHistory: ['home'],
      spotlight: null,

      go: (r) =>
        set((st) => {
          if (st.route === r) return;
          st.prevRoute = st.route;
          st.route = r;
          st.routeHistory = [...st.routeHistory.slice(-19), r];
        }),
      back: () =>
        set((st) => {
          const h = st.routeHistory.slice(0, -1);
          const prev = h[h.length - 1] ?? 'home';
          st.routeHistory = h.length ? h : ['home'];
          st.prevRoute = st.route;
          st.route = prev;
        }),
      setRightPanel: (p) => set((st) => { st.rightPanel = p; st.rightOpen = true; }),
      toggleLeft: () => set((st) => { st.leftOpen = !st.leftOpen; }),
      toggleRight: () => set((st) => { st.rightOpen = !st.rightOpen; }),
      toggleFilmstrip: () => set((st) => { st.filmstripOpen = !st.filmstripOpen; }),
      setPalette: (v) => set((st) => { st.paletteOpen = v; }),
      setActivity: (v) => set((st) => { st.activityOpen = v; }),
      setMemoryHud: (v) => set((st) => { st.memoryHudOpen = v; }),
      setShortcuts: (v) => set((st) => { st.shortcutsOpen = v; }),
      setModels: (v) => set((st) => { st.modelsOpen = v; }),
      setEditorTab: (t) => set((st) => { st.editorTab = t; }),
      patchOverlays: (p) => set((st) => { Object.assign(st.overlays, p); }),
      patchBeforeAfter: (p) => set((st) => { Object.assign(st.beforeAfter, p); }),
      patchSoftProof: (p) => set((st) => { Object.assign(st.softProof, p); }),
      setView: (v) =>
        set((st) => {
          Object.assign(st.view, v);
          if (v.zoom !== undefined) st.view.mode = v.zoom === 1 ? 'fit' : 'custom';
        }),
      setFocus: (id) => set((st) => { st.focusPhotoId = id; }),
      setCompareCount: (n) => set((st) => { st.compareCount = Math.max(2, Math.min(6, n)); }),
      setSurveyCount: (n) => set((st) => { st.surveyCount = Math.max(2, Math.min(9, n)); }),
      setGuides: (v) => set((st) => { st.guidesVisible = v; }),
      setSpotlight: (id) => set((st) => { st.spotlight = id; }),
    })),
    {
      name: 'swell.ui.v1',
      version: 1,
      // restore layout + route, never transient overlay state
      partialize: (s) => ({
        route: s.route,
        rightPanel: s.rightPanel,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        filmstripOpen: s.filmstripOpen,
        editorTab: s.editorTab,
        compareCount: s.compareCount,
        surveyCount: s.surveyCount,
        guidesVisible: s.guidesVisible,
      }) as Partial<UiState>,
    },
  ),
);

export const isEditorRoute = (r: RouteId) => EDITOR_ROUTES.includes(r);
export const getUi = () => useUi.getState();
