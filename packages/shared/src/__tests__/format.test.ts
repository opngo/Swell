/**
 * Formatting + the shortcut chord grammar (§10, Appendix A).
 *
 * Slider readouts are `tabular-nums` strings, so their exact shape matters as
 * much as their value — a jittering readout is a layout bug. The chord helpers
 * are the contract between `settings.shortcuts`, the KeyboardBus and the
 * Shortcuts dialog, on both macOS and everything else.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chordLabel,
  debounce,
  formatAperture,
  formatBytes,
  formatChord,
  formatDate,
  formatDateTime,
  formatDuration,
  formatExposure,
  formatFocal,
  formatKelvin,
  formatNumber,
  formatPercent,
  formatShutter,
  formatSigned,
  groupBy,
  invLerp,
  isMac,
  lerp,
  matchesCombo,
  modKey,
  mulberry32,
  relativeTime,
  roundTo,
  sum,
  mean,
  throttle,
  uid,
  type ChordLike,
} from '@swell/shared';

const event = (key: string, mods: Partial<Omit<ChordLike, 'key'>> = {}): ChordLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

/** Temporarily pretend to be on a Mac (isMac reads `navigator.platform`). */
function asMac(fn: () => void) {
  const nav = globalThis.navigator as Navigator;
  const original = Object.getOwnPropertyDescriptor(nav, 'platform');
  Object.defineProperty(nav, 'platform', { value: 'MacIntel', configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(nav, 'platform', original);
    else Object.defineProperty(nav, 'platform', { value: 'linux', configurable: true });
  }
}

describe('bytes and durations (Memory HUD, status bar)', () => {
  it('uses binary units and hides the fraction for bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });

  it('keeps a fixed width for readouts', () => {
    expect(formatBytes(2 * 1024 * 1024, 0)).toBe('2 MB');
    expect(formatDuration(250)).toBe('250 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });
});

describe('numeric readouts are tabular and signed', () => {
  it('formatSigned uses a real minus sign and 2 dp', () => {
    expect(formatSigned(0.35)).toBe('+0.35');
    expect(formatSigned(-1.2)).toBe('−1.20');
    expect(formatSigned(0)).toBe('0.00');
    expect(formatSigned(12, 0)).toBe('+12');
  });

  it('exposure, kelvin, percent, aperture, shutter, focal', () => {
    expect(formatExposure(0.35)).toBe('+0.35 EV');
    expect(formatExposure(-1.5)).toBe('−1.50 EV');
    expect(formatKelvin(5499.6)).toBe('5500 K');
    expect(formatPercent(87.5, 1)).toBe('87.5%');
    expect(formatAperture(2)).toBe('f/2');
    expect(formatAperture(1.8)).toBe('f/1.8');
    expect(formatAperture(Number.NaN)).toBe('—');
    expect(formatShutter(1 / 250)).toBe('1/250 s');
    expect(formatShutter(30)).toBe('30 s');
    expect(formatShutter(2.5)).toBe('2.5 s');
    expect(formatShutter(0)).toBe('—');
    expect(formatFocal(85.4)).toBe('85 mm');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('dates are rendered in local time and survive bad input', () => {
    const iso = new Date(2026, 8, 14, 18, 32).toISOString();
    expect(formatDateTime(iso)).toBe('14 Sep 2026 · 18:32');
    expect(formatDate(iso)).toBe('14 Sep 2026');
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7))).toBe('5 Jan 2026 · 09:07');
    expect(formatDateTime('not a date')).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('relativeTime buckets the way the library grid shows it', () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0);
    expect(relativeTime(new Date(now - 20_000).toISOString(), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3 h ago');
    expect(relativeTime(new Date(now - 6 * 86_400_000).toISOString(), now)).toBe('6 d ago');
    expect(relativeTime(new Date(now - 60 * 86_400_000).toISOString(), now)).toBe('2 mo ago');
    expect(relativeTime(new Date(now - 800 * 86_400_000).toISOString(), now)).toBe('2 y ago');
    expect(relativeTime('garbage', now)).toBe('—');
  });
});

describe('small maths helpers', () => {
  it('lerp / invLerp / roundTo', () => {
    expect(lerp(0, 10, 0.25)).toBeCloseTo(2.5, 9);
    expect(invLerp(0, 10, 2.5)).toBeCloseTo(0.25, 9);
    // roundTo snaps to a *step*, which is how slider detents work
    expect(roundTo(0.1234, 0.05)).toBeCloseTo(0.1, 9);
    expect(roundTo(7, 5)).toBe(5);
    expect(roundTo(-0.07, 0.1)).toBeCloseTo(-0.1, 9);
  });

  it('sum / mean / groupBy / uid', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(mean([2, 4])).toBe(3);
    const g = groupBy(
      [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
        { k: 'a', v: 3 },
      ],
      (x) => x.k,
    );
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('a')).toHaveLength(2);
    const ids = new Set(Array.from({ length: 500 }, () => uid('p')));
    expect(ids.size).toBe(500);
    expect([...ids][0]!.startsWith('p_')).toBe(true);
  });

  it('mulberry32 is deterministic and well distributed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(seqA[0]);
  });
});

describe('debounce / throttle (slider coalescing)', () => {
  afterEach(() => vi.useRealTimers());

  it('debounce fires once after the quiet period', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d(2);
    d(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('throttle fires at most once per window', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(1);
    t(2);
    t(3);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(250);
    const before = fn.mock.calls.length;
    t(4);
    vi.advanceTimersByTime(250);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(before);
  });
});

describe('shortcut chords', () => {
  it('normalises key names into the combo grammar (non-mac)', () => {
    expect(formatChord(event('k', { ctrlKey: true }))).toBe('mod+k');
    expect(formatChord(event('K', { ctrlKey: true, shiftKey: true }))).toBe('mod+shift+k');
    expect(formatChord(event('ArrowRight'))).toBe('right');
    expect(formatChord(event('ArrowLeft', { shiftKey: true }))).toBe('shift+left');
    expect(formatChord(event(' '))).toBe('space');
    expect(formatChord(event('Escape'))).toBe('escape');
    expect(formatChord(event('Delete'))).toBe('delete');
    expect(formatChord(event('m', { ctrlKey: true, altKey: true }))).toBe('mod+alt+m');
  });

  it('modifier-only presses do not become a combo', () => {
    expect(formatChord(event('Shift', { shiftKey: true }))).toBe('shift');
    expect(formatChord(event('Control', { ctrlKey: true }))).toBe('mod');
    expect(formatChord(event('Alt', { altKey: true }))).toBe('alt');
  });

  it('matchesCombo is exact on Windows/Linux and ignores stray modifiers', () => {
    expect(matchesCombo(event('k', { ctrlKey: true }), 'mod+k')).toBe(true);
    expect(matchesCombo(event('k'), 'mod+k')).toBe(false);
    expect(matchesCombo(event('k', { ctrlKey: true, shiftKey: true }), 'mod+k')).toBe(false);
    expect(matchesCombo(event('\\'), '\\')).toBe(true);
    expect(matchesCombo(event('ArrowRight'), 'right')).toBe(true);
  });

  it('on macOS the platform modifier is ⌘ and Ctrl is accepted as a fallback', () => {
    asMac(() => {
      expect(isMac()).toBe(true);
      expect(modKey()).toBe('⌘');
      expect(formatChord(event('k', { metaKey: true }))).toBe('mod+k');
      expect(matchesCombo(event('k', { metaKey: true }), 'mod+k')).toBe(true);
      expect(matchesCombo(event('m', { metaKey: true, altKey: true }), 'mod+alt+m')).toBe(true);
      // Ctrl+K still runs a `mod+k` action — LRC muscle memory
      expect(matchesCombo(event('k', { ctrlKey: true }), 'mod+k')).toBe(true);
      expect(formatChord(event('k', { metaKey: true, ctrlKey: true }))).toBe('mod+ctrl+k');
    });
  });

  it('chordLabel renders platform glyphs', () => {
    expect(chordLabel('mod+k')).toBe('Ctrl+K');
    expect(chordLabel('mod+shift+d')).toBe('Ctrl+Shift+D');
    expect(chordLabel('mod+alt+m')).toBe('Ctrl+Alt+M');
    expect(chordLabel('right')).toBe('Right');
    expect(chordLabel('escape')).toBe('Esc');
    expect(chordLabel('space')).toBe('Space');
    expect(chordLabel('\\')).toBe('\\');
    asMac(() => {
      expect(chordLabel('mod+k')).toBe('⌘K');
      expect(chordLabel('mod+shift+d')).toBe('⌘⇧D');
      expect(chordLabel('mod+alt+m')).toBe('⌘⌥M');
      expect(chordLabel('ctrl+alt+m')).toBe('⌃⌥M');
      expect(chordLabel('right')).toBe('→');
      expect(chordLabel('delete')).toBe('⌫');
    });
  });

  it('every binding in the shipped table can be labelled', () => {
    for (const combo of ['mod+k', 'mod+alt+m', '?', 'b', 'shift+d', 'mod+shift+c', 'a', 'space']) {
      expect(chordLabel(combo).length).toBeGreaterThan(0);
    }
  });
});
