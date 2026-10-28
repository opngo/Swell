/**
 * Develop store (§7.2 params + history, §9 presets/profiles/snapshots/versions).
 *
 * The store is the committed truth for edits: one history entry per gesture,
 * diffs rather than whole documents, branching undo, and presets that scale.
 * Persistence is mocked — this file is about the state machine, not IndexedDB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/persist.ts', () => ({
  openDb: vi.fn(async () => ({})),
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => undefined),
  idbDel: vi.fn(async () => undefined),
  idbAll: vi.fn(async () => []),
  persistDebounced: vi.fn(),
}));

import { idbAll, idbGet, idbSet, persistDebounced } from '@/lib/persist.ts';
import { BUILTIN_PRESETS, BUILTIN_PROFILES } from '@/lib/builtinPresets.ts';
import { useDevelop } from '@/state/develop.ts';
import { defaultParams, parseParams, type DevelopParams } from '@swell/schema';

const PHOTO = 'p1';
const OTHER = 'p2';

const store = () => useDevelop.getState();
const params = (id = PHOTO) => store().getParams(id);
const labels = (id = PHOTO) => (store().history[id] ?? []).map((h) => h.label);
const head = (id = PHOTO) => store().head[id] ?? -1;

/** Commit a tone edit; the workhorse for history tests. */
function editTone(exposure: number, label = `Exposure ${exposure}`) {
  store().commit(PHOTO, (p) => parseParams({ ...p, tone: { ...p.tone, exposure } }), label);
}

beforeEach(() => {
  vi.mocked(idbGet).mockReset();
  vi.mocked(idbGet).mockResolvedValue(undefined as never);
  vi.mocked(idbAll).mockReset();
  vi.mocked(idbAll).mockResolvedValue([] as never);
  vi.mocked(idbSet).mockReset();
  vi.mocked(idbSet).mockResolvedValue(undefined as never);
  vi.mocked(persistDebounced).mockReset();
  useDevelop.setState({
    ready: false,
    params: {},
    base: {},
    history: {},
    head: {},
    presets: [...BUILTIN_PRESETS],
    profiles: [...BUILTIN_PROFILES],
    snapshots: [],
    versions: [],
    gesture: null,
  });
});

describe('params', () => {
  it('returns defaults for a photo it has never seen', () => {
    expect(params()).toEqual(defaultParams());
  });

  it('hands out a fresh default document each time', () => {
    const a = params();
    const b = params();
    expect(a).not.toBe(b);
    a.tone.exposure = 1.5;
    expect(params().tone.exposure).toBe(0);
  });

  it('setLive replaces the working document without touching history', () => {
    const next = parseParams({ tone: { exposure: 0.8 } });
    store().setLive(PHOTO, next);
    expect(params().tone.exposure).toBe(0.8);
    expect(store().history[PHOTO]).toBeUndefined();
    expect(head()).toBe(-1);
  });

  it('persists params and metadata through the debounced writer', () => {
    editTone(0.5);
    const calls = vi.mocked(persistDebounced).mock.calls;
    expect(calls.some((c) => c[0] === 'params' && c[1] === PHOTO)).toBe(true);
    expect(calls.some((c) => c[1] === 'history.v1')).toBe(true);
    expect(calls.some((c) => c[1] === 'params.base.v1')).toBe(true);
  });
});

describe('commit and history', () => {
  it('writes one labelled entry per commit', () => {
    editTone(0.4, 'Brighten');
    expect(labels()).toEqual(['Brighten']);
    expect(head()).toBe(0);
    expect(store().history[PHOTO]![0]!.photoId).toBe(PHOTO);
    expect(store().history[PHOTO]![0]!.diff).toEqual({ 'tone.exposure': 0.4 });
  });

  it('captures the base document only once', () => {
    editTone(0.4);
    editTone(0.9);
    expect(store().base[PHOTO]).toEqual(defaultParams());
  });

  it('accepts an updater function', () => {
    store().commit(PHOTO, (p) => parseParams({ ...p, presence: { ...p.presence, clarity: 22 } }), 'Clarity');
    expect(params().presence.clarity).toBe(22);
  });

  it('ignores a commit that changes nothing', () => {
    store().commit(PHOTO, defaultParams(), 'No-op');
    expect(store().history[PHOTO]).toBeUndefined();
    editTone(0.3);
    store().commit(PHOTO, params(), 'Still nothing');
    expect(labels()).toEqual(['Exposure 0.3']);
  });

  it('records array groups wholesale instead of per element', () => {
    store().commit(
      PHOTO,
      (p) => parseParams({ ...p, layers: [{ id: 'l1', kind: 'adjustment', name: 'Dodge' }] }),
      'Add layer',
    );
    const diff = store().history[PHOTO]![0]!.diff as Record<string, unknown>;
    expect(Object.keys(diff)).toEqual(['layers']);
    const layers = diff.layers as { id: string; name: string }[];
    expect(layers).toHaveLength(1);
    expect(layers[0]!.id).toBe('l1');
    expect(layers[0]!.name).toBe('Dodge');
  });

  it('undo returns the label it undid and restores the previous document', () => {
    editTone(0.4, 'One');
    editTone(0.9, 'Two');
    expect(store().undo(PHOTO)).toBe('Two');
    expect(params().tone.exposure).toBe(0.4);
    expect(head()).toBe(0);
    expect(store().undo(PHOTO)).toBe('One');
    expect(params()).toEqual(defaultParams());
    expect(head()).toBe(-1);
  });

  it('undo at the start and redo at the end return null', () => {
    expect(store().undo(PHOTO)).toBeNull();
    editTone(0.4);
    expect(store().redo(PHOTO)).toBeNull();
  });

  it('redo replays the diff and returns its label', () => {
    editTone(0.4, 'One');
    editTone(0.9, 'Two');
    store().undo(PHOTO);
    expect(store().redo(PHOTO)).toBe('Two');
    expect(params().tone.exposure).toBe(0.9);
    expect(head()).toBe(1);
  });

  it('round-trips a whole editing session', () => {
    const edits = [0.2, -0.6, 1.1, 0.05];
    for (const e of edits) editTone(e);
    const final = params();
    for (let i = 0; i < edits.length; i++) store().undo(PHOTO);
    expect(params()).toEqual(defaultParams());
    for (let i = 0; i < edits.length; i++) store().redo(PHOTO);
    expect(params()).toEqual(final);
  });

  it('a new edit replaces the redo branch', () => {
    editTone(0.4, 'One');
    editTone(0.9, 'Two');
    store().undo(PHOTO);
    editTone(-0.3, 'Three');
    expect(labels()).toEqual(['One', 'Three']);
    expect(head()).toBe(1);
    expect(store().redo(PHOTO)).toBeNull();
  });

  it('chains parentId and branch depth', () => {
    editTone(0.1);
    editTone(0.2);
    editTone(0.3);
    const list = store().history[PHOTO]!;
    expect(list[0]!.parentId).toBeUndefined();
    expect(list[1]!.parentId).toBe(list[0]!.id);
    expect(list[2]!.parentId).toBe(list[1]!.id);
    expect(list.map((h) => h.branch)).toEqual([1, 2, 3]);
  });

  it('jumpTo walks the timeline and clamps out-of-range indices', () => {
    editTone(0.1);
    editTone(0.2);
    editTone(0.3);
    store().jumpTo(PHOTO, 1);
    expect(params().tone.exposure).toBe(0.2);
    expect(head()).toBe(1);
    store().jumpTo(PHOTO, -1);
    expect(params()).toEqual(defaultParams());
    store().jumpTo(PHOTO, 99);
    expect(params().tone.exposure).toBe(0.3);
    expect(head()).toBe(2);
  });

  it('jumpTo for an unknown photo is a no-op', () => {
    store().jumpTo('nope', 3);
    expect(store().params.nope).toBeUndefined();
  });

  it('keeps 120 entries and re-bases so deep undo still lands on the right image', () => {
    for (let i = 1; i <= 130; i++) editTone(i / 100, `Edit ${i}`);
    const list = store().history[PHOTO]!;
    expect(list).toHaveLength(120);
    expect(list[0]!.label).toBe('Edit 11'); // the oldest ten folded into base
    expect(head()).toBe(119);
    expect(params().tone.exposure).toBeCloseTo(1.3);
    store().jumpTo(PHOTO, 0);
    expect(params().tone.exposure).toBeCloseTo(0.11);
    store().jumpTo(PHOTO, -1);
    expect(params().tone.exposure).toBeCloseTo(0.1); // base = doc after edit 10
    store().jumpTo(PHOTO, 119);
    expect(params().tone.exposure).toBeCloseTo(1.3);
  });

  it('keeps separate histories per photo', () => {
    editTone(0.5, 'A');
    store().commit(OTHER, (p) => parseParams({ ...p, tone: { ...p.tone, exposure: -0.5 } }), 'B');
    expect(labels(PHOTO)).toEqual(['A']);
    expect(labels(OTHER)).toEqual(['B']);
    store().undo(PHOTO);
    expect(params(OTHER).tone.exposure).toBe(-0.5);
  });
});

describe('patch', () => {
  it('sets nested dot paths and records one entry', () => {
    store().patch(PHOTO, { 'tone.contrast': 30, 'presence.clarity': 12 }, 'Contrast +30');
    expect(params().tone.contrast).toBe(30);
    expect(params().presence.clarity).toBe(12);
    expect(labels()).toEqual(['Contrast +30']);
    expect(store().history[PHOTO]![0]!.diff).toEqual({ 'tone.contrast': 30, 'presence.clarity': 12 });
  });

  it('creates missing groups and validates the result', () => {
    store().patch(PHOTO, { 'bgRemoval.enabled': true }, 'Remove background');
    expect(params().bgRemoval?.enabled).toBe(true);
    store().patch(PHOTO, { 'tone.exposure': 99 }, 'Clamped');
    expect(params().tone.exposure).toBeLessThanOrEqual(5);
  });

  it('records nothing when the patch is a no-op', () => {
    store().patch(PHOTO, { 'tone.exposure': 0 }, 'Same');
    expect(store().history[PHOTO]).toBeUndefined();
  });
});

describe('gestures — one history entry per drag (§10, Appendix A)', () => {
  it('folds every live frame of a drag into a single entry', () => {
    store().beginGesture(PHOTO);
    expect(store().gesture?.photoId).toBe(PHOTO);
    for (let i = 1; i <= 30; i++) {
      store().setLive(PHOTO, parseParams({ tone: { exposure: i / 30 } }));
    }
    expect(store().history[PHOTO]).toBeUndefined(); // no entry mid-drag
    store().endGesture(PHOTO, 'Exposure');
    expect(labels()).toEqual(['Exposure']);
    expect(params().tone.exposure).toBeCloseTo(1);
    expect(store().history[PHOTO]![0]!.diff).toEqual({ 'tone.exposure': 1 });
    expect(store().gesture).toBeNull();
  });

  it('undo after a gesture reverts the whole drag, not the last frame', () => {
    editTone(0.5, 'Before');
    store().beginGesture(PHOTO);
    store().setLive(PHOTO, parseParams({ tone: { exposure: 0.6 } }));
    store().setLive(PHOTO, parseParams({ tone: { exposure: -0.9 } }));
    store().endGesture(PHOTO, 'Drag');
    expect(store().undo(PHOTO)).toBe('Drag');
    expect(params().tone.exposure).toBe(0.5);
  });

  it('a gesture that ends where it started writes nothing', () => {
    store().beginGesture(PHOTO);
    store().setLive(PHOTO, parseParams({ tone: { exposure: 0.7 } }));
    store().setLive(PHOTO, defaultParams());
    store().endGesture(PHOTO, 'Wiggle');
    expect(store().history[PHOTO]).toBeUndefined();
    expect(store().gesture).toBeNull();
  });

  it('cancel restores the pre-gesture document', () => {
    editTone(0.25, 'Setup');
    const before = params();
    store().beginGesture(PHOTO);
    store().setLive(PHOTO, parseParams({ tone: { exposure: 1.4 } }));
    store().cancelGesture(PHOTO);
    expect(params()).toEqual(before);
    expect(labels()).toEqual(['Setup']);
    expect(store().gesture).toBeNull();
  });

  it('endGesture for a different photo does nothing', () => {
    store().beginGesture(PHOTO);
    store().setLive(PHOTO, parseParams({ tone: { exposure: 0.9 } }));
    store().endGesture(OTHER, 'Wrong photo');
    expect(store().history[PHOTO]).toBeUndefined();
    expect(store().history[OTHER]).toBeUndefined();
    expect(store().gesture).toBeNull();
  });
});

describe('reset', () => {
  it('resetAll returns to defaults as one undoable step', () => {
    editTone(0.8);
    store().patch(PHOTO, { 'presence.clarity': 40 }, 'Clarity');
    store().resetAll(PHOTO);
    expect(params()).toEqual(defaultParams());
    expect(labels().at(-1)).toBe('Reset all');
    expect(store().undo(PHOTO)).toBe('Reset all');
    expect(params().presence.clarity).toBe(40);
  });

  it('resetAll on a clean photo records nothing', () => {
    store().resetAll(PHOTO);
    expect(store().history[PHOTO]).toBeUndefined();
  });

  it('resetGroup only resets the named group', () => {
    store().patch(PHOTO, { 'tone.exposure': 0.9, 'presence.clarity': 40 }, 'Both');
    store().resetGroup(PHOTO, 'tone');
    expect(params().tone.exposure).toBe(0);
    expect(params().presence.clarity).toBe(40);
    expect(labels().at(-1)).toBe('Reset tone');
    expect(store().history[PHOTO]!.at(-1)!.diff).toEqual({ 'tone.exposure': 0 });
  });
});

describe('copy and paste', () => {
  it('copyParams returns the source document', () => {
    editTone(0.6);
    expect(store().copyParams(PHOTO).tone.exposure).toBe(0.6);
    expect(store().copyParams('unknown')).toEqual(defaultParams());
  });

  it('a full paste keeps the destination layers and removals', () => {
    editTone(0.6);
    store().commit(
      OTHER,
      (p) => parseParams({ ...p, layers: [{ id: 'keep', kind: 'adjustment', name: 'Local' }] }),
      'Layer',
    );
    store().pasteParams([OTHER], store().copyParams(PHOTO));
    expect(params(OTHER).tone.exposure).toBe(0.6);
    expect(params(OTHER).layers.map((l) => l.id)).toEqual(['keep']);
    expect(labels(OTHER).at(-1)).toBe('Paste settings');
  });

  it('a filtered paste copies only the chosen groups', () => {
    store().patch(PHOTO, { 'tone.exposure': 0.7, 'presence.clarity': 33 }, 'Source');
    store().patch(OTHER, { 'presence.clarity': 5 }, 'Destination');
    store().pasteParams([OTHER], store().copyParams(PHOTO), ['tone']);
    expect(params(OTHER).tone.exposure).toBe(0.7);
    expect(params(OTHER).presence.clarity).toBe(5);
    expect(labels(OTHER).at(-1)).toBe('Paste tone');
  });

  it('pastes to many photos at once, each with its own history', () => {
    editTone(0.5);
    store().pasteParams([OTHER, 'p3'], store().copyParams(PHOTO));
    expect(params(OTHER).tone.exposure).toBe(0.5);
    expect(params('p3').tone.exposure).toBe(0.5);
    expect(labels(OTHER)).toEqual(['Paste settings']);
    expect(labels('p3')).toEqual(['Paste settings']);
  });

  it('an identical paste records nothing', () => {
    store().pasteParams([OTHER], defaultParams());
    expect(store().history[OTHER]).toBeUndefined();
  });
});

describe('presets (§9)', () => {
  it('ships the built-in library', () => {
    expect(store().presets.length).toBe(BUILTIN_PRESETS.length);
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.group))).toEqual(
      new Set(['swell', 'portrait', 'landscape', 'film', 'bw']),
    );
    // A preset must never carry a layer stack or removals — applying it would
    // wipe the user's own.
    for (const preset of BUILTIN_PRESETS) {
      expect(Object.keys(preset.params)).not.toContain('layers');
      expect(Object.keys(preset.params)).not.toContain('removals');
      expect(preset.include).toEqual(Object.keys(preset.params));
    }
  });

  it('addPreset unshifts a user preset and returns its id', () => {
    const id = store().addPreset({ name: 'My look', params: { tone: { exposure: 0.4 } } });
    const preset = store().presets[0]!;
    expect(preset.id).toBe(id);
    expect(preset.name).toBe('My look');
    expect(preset.group).toBe('user');
    expect(preset.favorite).toBe(false);
    expect(preset.amount).toBe(100);
    expect(preset.include).toEqual(['tone', 'presence', 'curves', 'grading']);
    expect(preset.createdAt).toBeGreaterThan(0);
    expect(store().presets).toHaveLength(BUILTIN_PRESETS.length + 1);
  });

  it('keeps a caller-supplied id so re-importing updates instead of duplicating', () => {
    const id = store().addPreset({ id: 'preset-imported', name: 'Imported', params: { tone: { exposure: 0.2 } } });
    expect(id).toBe('preset-imported');
    expect(store().presets[0]!.id).toBe('preset-imported');
  });

  it('stores exactly the fragment it was given — no invented defaults', () => {
    store().addPreset({ name: 'Sparse', params: { tone: { exposure: 0.4 } } });
    const stored = store().presets[0]!.params as Record<string, Record<string, unknown>>;
    expect(Object.keys(stored)).toEqual(['tone']);
    expect(Object.keys(stored.tone!)).toEqual(['exposure']);
  });

  it('drops keys that are not param groups', () => {
    store().addPreset({
      name: 'Junk',
      params: { tone: { exposure: 0.2 }, notAGroup: 5, bogus: { deep: true } } as never,
    });
    expect(Object.keys(store().presets[0]!.params)).toEqual(['tone']);
  });

  it('keeps the author group, favourite flag and include list', () => {
    store().addPreset({
      name: 'Filmic',
      group: 'film',
      favorite: true,
      description: 'Test',
      include: ['tone'],
      params: { tone: { contrast: 20 }, presence: { clarity: 10 } },
    });
    const preset = store().presets[0]!;
    expect(preset.group).toBe('film');
    expect(preset.favorite).toBe(true);
    expect(preset.description).toBe('Test');
    expect(preset.include).toEqual(['tone']);
  });

  it('applies a preset at 100 %', () => {
    const id = store().addPreset({ name: 'Punch', params: { tone: { exposure: 0.6, contrast: 40 } } });
    store().applyPreset([PHOTO], id, 100);
    expect(params().tone.exposure).toBeCloseTo(0.6);
    expect(params().tone.contrast).toBeCloseTo(40);
    expect(labels()).toEqual(['Preset: Punch']);
  });

  it('scales with the amount slider: 0 % is a no-op, 200 % overshoots', () => {
    const id = store().addPreset({ name: 'Half', params: { tone: { exposure: 0.8 } } });
    store().applyPreset([PHOTO], id, 0);
    expect(params().tone.exposure).toBe(0);
    expect(store().history[PHOTO]).toBeUndefined();
    store().applyPreset([PHOTO], id, 50);
    expect(params().tone.exposure).toBeCloseTo(0.4);
    store().applyPreset([PHOTO], id, 200);
    expect(params().tone.exposure).toBeCloseTo(0.4 + (0.8 - 0.4) * 2);
    expect(labels().at(-1)).toBe('Preset: Half 200%');
  });

  it('interpolates from the current document, not from zero', () => {
    editTone(0.2);
    const id = store().addPreset({ name: 'Target', params: { tone: { exposure: 1 } } });
    store().applyPreset([PHOTO], id, 50);
    expect(params().tone.exposure).toBeCloseTo(0.6);
  });

  it('leaves groups the preset does not mention untouched', () => {
    store().patch(PHOTO, { 'presence.clarity': 45 }, 'Clarity');
    const id = store().addPreset({ name: 'Tone only', params: { tone: { exposure: 0.5 } } });
    store().applyPreset([PHOTO], id, 100);
    expect(params().presence.clarity).toBe(45);
    expect(store().history[PHOTO]!.at(-1)!.diff).toEqual({ 'tone.exposure': 0.5 });
  });

  it('applies to a batch of photos', () => {
    const id = store().addPreset({ name: 'Batch', params: { tone: { exposure: 0.3 } } });
    store().applyPreset([PHOTO, OTHER, 'p3'], id, 100);
    for (const photo of [PHOTO, OTHER, 'p3']) {
      expect(params(photo).tone.exposure).toBeCloseTo(0.3);
      expect(labels(photo)).toEqual(['Preset: Batch']);
    }
  });

  it('applying a built-in preset really changes the render params', () => {
    const bw = BUILTIN_PRESETS.find((p) => p.group === 'bw')!;
    store().applyPreset([PHOTO], bw.id, 100);
    expect(params().treatment).toBe('bw');
    expect(params().mixer).not.toEqual(defaultParams().mixer);
    expect(labels()).toEqual([`Preset: ${bw.name}`]);
    expect(store().undo(PHOTO)).toBe(`Preset: ${bw.name}`);
    expect(params().treatment).toBe('color');
    expect(params()).toEqual(defaultParams());
  });

  it('an unknown preset id is a no-op', () => {
    store().applyPreset([PHOTO], 'missing', 100);
    expect(params()).toEqual(defaultParams());
    expect(store().history[PHOTO]).toBeUndefined();
  });

  it('toggles favourites and deletes presets', () => {
    const id = store().addPreset({ name: 'Temp', params: { tone: { exposure: 0.1 } } });
    store().togglePresetFavorite(id);
    expect(store().presets[0]!.favorite).toBe(true);
    store().togglePresetFavorite(id);
    expect(store().presets[0]!.favorite).toBe(false);
    store().togglePresetFavorite('missing');
    expect(store().presets).toHaveLength(BUILTIN_PRESETS.length + 1);
    store().deletePreset(id);
    expect(store().presets).toHaveLength(BUILTIN_PRESETS.length);
    expect(store().presets.some((p) => p.id === id)).toBe(false);
  });

  it('writes only user presets to storage, built-ins excluded', async () => {
    const id = store().addPreset({ name: 'Saved', params: { tone: { exposure: 0.1 } } });
    await Promise.resolve();
    const call = vi.mocked(idbSet).mock.calls.find((c) => c[1] === 'presets.v1');
    expect(call).toBeDefined();
    const saved = call![2] as { id: string; group: string }[];
    expect(saved.map((p) => p.id)).toEqual([id]);
    expect(saved.every((p) => p.group === 'user')).toBe(true);
    store().deletePreset(id);
    await Promise.resolve();
    const last = vi.mocked(idbSet).mock.calls.filter((c) => c[1] === 'presets.v1').at(-1);
    expect(last![2]).toEqual([]);
  });

  it('writes snapshots and versions to their own keys', async () => {
    store().addSnapshot(PHOTO, 'Snap');
    store().addVersion(PHOTO, 'Ver');
    await Promise.resolve();
    const keys = vi.mocked(idbSet).mock.calls.map((c) => c[1]);
    expect(keys).toContain('snapshots.v1');
    expect(keys).toContain('versions.v1');
  });
});

describe('profiles', () => {
  it('ships camera and creative profiles alongside the Swell ones', () => {
    expect(store().profiles.length).toBe(BUILTIN_PROFILES.length);
    expect(new Set(BUILTIN_PROFILES.map((p) => p.group))).toEqual(new Set(['swell', 'camera', 'creative']));
  });

  it('applying a profile binds its id and labels history with its name', () => {
    const vivid = BUILTIN_PROFILES.find((p) => p.id === 'swell-vivid')!;
    store().applyProfile(PHOTO, vivid.id);
    // The document keeps the profile id; the display name lives in the catalogue.
    expect(params().profile.id).toBe(vivid.id);
    expect(params().profile.amount).toBe(100);
    expect(labels()).toEqual([`Profile: ${vivid.name}`]);
  });

  it('merges the profile groups without dropping the user other edits', () => {
    store().patch(PHOTO, { 'tone.exposure': 0.4 }, 'Exposure');
    const vivid = BUILTIN_PROFILES.find((p) => p.id === 'swell-vivid')!;
    store().applyProfile(PHOTO, vivid.id);
    expect(params().tone.exposure).toBe(0.4);
    expect(params().presence.vibrance).toBe((vivid.params.presence as { vibrance: number }).vibrance);
  });

  it('keeps a LUT binding and the profile amount from the catalogue entry', () => {
    // No built-in profile ships a .cube, so register one to pin the behaviour:
    // the catalogue's `lutId` must survive the merge with `profile.params`.
    const lutProfile = {
      id: 'lut-teal',
      name: 'Teal & Orange',
      group: 'lut' as const,
      favorite: false,
      lutId: 'teal-orange.cube',
      params: { profile: { amount: 80 }, tone: { contrast: 15 } },
    };
    useDevelop.setState({ profiles: [...BUILTIN_PROFILES, lutProfile] });
    store().applyProfile(PHOTO, lutProfile.id);
    expect(params().profile.id).toBe('lut-teal');
    expect(params().profile.lutId).toBe('teal-orange.cube');
    expect(params().profile.amount).toBe(80);
    expect(params().tone.contrast).toBe(15);
    expect(labels()).toEqual(['Profile: Teal & Orange']);
  });

  it('an unknown profile is a no-op', () => {
    store().applyProfile(PHOTO, 'missing');
    expect(store().history[PHOTO]).toBeUndefined();
  });

  it('re-applying the same profile records nothing', () => {
    const neutral = BUILTIN_PROFILES.find((p) => p.id === 'swell-neutral')!;
    store().applyProfile(PHOTO, neutral.id);
    const count = labels().length;
    store().applyProfile(PHOTO, neutral.id);
    expect(labels()).toHaveLength(count);
  });
});

describe('snapshots and versions (§9)', () => {
  it('a snapshot captures the current document', () => {
    editTone(0.7);
    const id = store().addSnapshot(PHOTO, 'Before crop');
    const snap = store().snapshots[0]!;
    expect(snap.id).toBe(id);
    expect(snap.photoId).toBe(PHOTO);
    expect(snap.name).toBe('Before crop');
    expect(snap.params.tone.exposure).toBe(0.7);
    expect(snap.ts).toBeGreaterThan(0);
  });

  it('applying a snapshot restores it as one undoable step', () => {
    editTone(0.7);
    const id = store().addSnapshot(PHOTO, 'Good');
    editTone(-0.9, 'Bad');
    store().applySnapshot(PHOTO, id);
    expect(params().tone.exposure).toBe(0.7);
    expect(labels().at(-1)).toBe('Snapshot: Good');
    expect(store().undo(PHOTO)).toBe('Snapshot: Good');
    expect(params().tone.exposure).toBe(-0.9);
  });

  it('applying a snapshot that matches the document records nothing', () => {
    editTone(0.3);
    const id = store().addSnapshot(PHOTO, 'Same');
    store().applySnapshot(PHOTO, id);
    expect(labels()).toEqual(['Exposure 0.3']);
  });

  it('deletes snapshots and ignores unknown ids', () => {
    const id = store().addSnapshot(PHOTO, 'Temp');
    store().deleteSnapshot(id);
    expect(store().snapshots).toHaveLength(0);
    store().deleteSnapshot('missing');
    store().applySnapshot(PHOTO, 'missing');
    expect(store().history[PHOTO]).toBeUndefined();
  });

  it('versions are a separate, named timeline', () => {
    editTone(0.2);
    const v1 = store().addVersion(PHOTO, 'v1 — neutral');
    editTone(0.9, 'Push');
    const v2 = store().addVersion(PHOTO, 'v2 — pushed');
    expect(store().versions.map((v) => v.name)).toEqual(['v2 — pushed', 'v1 — neutral']);
    expect(store().snapshots).toHaveLength(0);
    store().applyVersion(PHOTO, v1);
    expect(params().tone.exposure).toBe(0.2);
    expect(labels().at(-1)).toBe('Version: v1 — neutral');
    store().applyVersion(PHOTO, v2);
    expect(params().tone.exposure).toBe(0.9);
    store().deleteVersion(v2);
    expect(store().versions.map((v) => v.id)).toEqual([v1]);
    store().deleteVersion('missing');
    store().applyVersion(PHOTO, 'missing');
    expect(labels().at(-1)).toBe('Version: v2 — pushed');
  });

  it('a snapshot taken before edits survives later ones', () => {
    editTone(0.4);
    const id = store().addSnapshot(PHOTO, 'Early');
    for (let i = 0; i < 5; i++) editTone(i / 5);
    store().applySnapshot(PHOTO, id);
    expect(params().tone.exposure).toBe(0.4);
  });
});

describe('hydrate', () => {
  const mockStore = (kv: Record<string, unknown>, rows: { key: string; value: DevelopParams }[] = []) => {
    vi.mocked(idbGet).mockImplementation((async (_store: string, key: string) => kv[key]) as never);
    vi.mocked(idbAll).mockImplementation((async (name: string) => (name === 'params' ? rows : [])) as never);
  };

  it('starts empty and marks itself ready', async () => {
    mockStore({});
    await store().hydrate();
    expect(store().ready).toBe(true);
    expect(store().params).toEqual({});
    expect(store().presets.length).toBe(BUILTIN_PRESETS.length);
  });

  it('loads per-photo params and reparses them', async () => {
    mockStore({}, [{ key: PHOTO, value: parseParams({ tone: { exposure: 0.55 } }) }]);
    await store().hydrate();
    expect(params().tone.exposure).toBeCloseTo(0.55);
  });

  it('falls back to a clean document for a corrupt row', async () => {
    mockStore({}, [{ key: PHOTO, value: { tone: 'not a document' } as unknown as DevelopParams }]);
    await store().hydrate();
    expect(params()).toEqual(defaultParams());
    expect(store().ready).toBe(true);
  });

  it('reads the legacy blob when there are no per-photo rows', async () => {
    mockStore({ 'develop.v1': { [PHOTO]: parseParams({ tone: { exposure: 0.2 } }) } });
    await store().hydrate();
    expect(params().tone.exposure).toBeCloseTo(0.2);
  });

  it('restores history, head and base', async () => {
    const diff = { 'tone.exposure': 0.4 };
    mockStore({
      'history.v1': { [PHOTO]: [{ id: 'h1', photoId: PHOTO, label: 'Brighten', ts: 1, diff, branch: 1 }] },
      'params.base.v1': { [PHOTO]: defaultParams() },
    });
    await store().hydrate();
    expect(labels()).toEqual(['Brighten']);
    expect(head()).toBe(0);
    expect(store().base[PHOTO]).toEqual(defaultParams());
    expect(store().undo(PHOTO)).toBe('Brighten');
    expect(params()).toEqual(defaultParams());
  });

  it('puts saved user presets in front of the built-ins', async () => {
    const saved = [
      {
        id: 'user-1',
        name: 'Mine',
        group: 'user',
        favorite: true,
        include: ['tone'],
        amount: 100,
        params: { tone: { exposure: 0.3 } },
        createdAt: 5,
      },
    ];
    mockStore({ 'presets.v1': saved });
    await store().hydrate();
    expect(store().presets[0]!.id).toBe('user-1');
    expect(store().presets.filter((p) => p.group === 'user')).toHaveLength(1);
    expect(store().presets.length).toBe(1 + BUILTIN_PRESETS.length);
  });

  it('restores snapshots and versions', async () => {
    mockStore({
      'snapshots.v1': [{ id: 's1', photoId: PHOTO, name: 'Snap', params: defaultParams(), ts: 3 }],
      'versions.v1': [{ id: 'v1', photoId: PHOTO, name: 'Ver', params: defaultParams(), ts: 4 }],
    });
    await store().hydrate();
    expect(store().snapshots.map((s) => s.id)).toEqual(['s1']);
    expect(store().versions.map((v) => v.id)).toEqual(['v1']);
  });

  it('survives a storage failure', async () => {
    vi.mocked(idbGet).mockRejectedValue(new Error('IDB gone') as never);
    vi.mocked(idbAll).mockRejectedValue(new Error('IDB gone') as never);
    await store().hydrate();
    expect(store().ready).toBe(true);
    expect(store().params).toEqual({});
  });
});
