/** Formatting + small utilities shared by the renderer, workers and tests. */

export const formatBytes = (bytes: number, digits = 1): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
};

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
};

export const formatNumber = (v: number, digits = 0): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** '+0.35' / '−1.20' — signed, tabular, 2 dp. Used by every slider readout. */
export const formatSigned = (v: number, digits = 2): string => {
  const s = v.toFixed(digits);
  if (v > 0) return `+${s}`;
  if (v < 0) return `−${s.slice(1)}`;
  return s;
};

export const formatKelvin = (v: number): string => `${Math.round(v)} K`;
export const formatPercent = (v: number, digits = 0): string => `${v.toFixed(digits)}%`;

export const formatExposure = (ev: number): string =>
  `${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(2)} EV`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO capture time → "14 Sep 2024 · 18:32". */
export const formatDateTime = (iso: string | number | Date): string => {
  const d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const formatDate = (iso: string | number | Date): string => {
  const d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const relativeTime = (iso: string | number | Date, now = Date.now()): string => {
  const t = new Date(iso as string).getTime();
  const diff = now - t;
  if (Number.isNaN(t)) return '—';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.round(months / 12)} y ago`;
};

/** Exposure time formatting: 1/2000 s, 30 s, 2.5 s */
export const formatShutter = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 1) return `1/${Math.round(1 / seconds)} s`;
  return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)} s`;
};

export const formatAperture = (f: number): string => (Number.isFinite(f) ? `f/${f % 1 === 0 ? f.toFixed(0) : f.toFixed(1)}` : '—');
export const formatFocal = (mm: number): string => (Number.isFinite(mm) ? `${Math.round(mm)} mm` : '—');

/* ------------------------------------------------------------------- misc */

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (t) clearTimeout(t);
  };
  wrapped.flush = (...args: A) => {
    if (t) clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  return (...args: A) => {
    const now = performance.now();
    lastArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        last = performance.now();
        if (lastArgs) fn(...lastArgs);
      }, ms - (now - last));
    }
  };
}

/** rAF-coalesced "latest value wins" scheduler (used by the render loop). */
export function rafCoalesce<T>(fn: (value: T) => void): (value: T) => void {
  let pending: T | undefined;
  let scheduled = false;
  return (value: T) => {
    pending = value;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (pending !== undefined) fn(pending);
    });
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Deterministic PRNG — grain, dithering, generated placeholders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export const modKey = () => (isMac() ? '⌘' : 'Ctrl');

/** Group an array by a key, preserving first-seen order. */
export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = out.get(k);
    if (arr) arr.push(it);
    else out.set(k, [it]);
  }
  return out;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/* ------------------------------------------------------------------ chords */

/**
 * Shortcut grammar used by SWELL_SHORTCUTS / LRC_SHORTCUTS: lowercase key
 * names joined with `+`, with the platform modifier written as `mod` so one
 * table serves macOS and everything else.
 *
 *   mod+k · shift+d · mod+alt+m · right · delete · tab · \
 */
export interface ChordLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  arrowright: 'right',
  arrowleft: 'left',
  arrowup: 'up',
  arrowdown: 'down',
  arrow: 'up',
  delete: 'delete',
  backspace: 'backspace',
  tab: 'tab',
  escape: 'escape',
  enter: 'enter',
  ' ': 'space',
  spacebar: 'space',
};

/** Normalise a keyboard event into the combo grammar. */
export function formatChord(e: ChordLike): string {
  const mac = isMac();
  const lower = e.key.toLowerCase();
  // Aliases first: the space bar arrives as a single-character key (' ').
  const raw = KEY_ALIASES[lower] ?? lower;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (mac && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (raw !== 'shift' && raw !== 'control' && raw !== 'alt' && raw !== 'meta' && raw !== 'os') parts.push(raw);
  return parts.join('+');
}

/** Does this event match a combo from the shortcut table? */
export function matchesCombo(e: ChordLike, combo: string): boolean {
  const c = combo.toLowerCase().trim();
  const f = formatChord(e);
  if (f === c) return true;
  // macOS: `mod` is ⌘, but Control is accepted as a fallback so a table written
  // for one platform still fires on the other (LRC muscle memory, too).
  if (isMac() && c.startsWith('mod+')) return f === c.replace('mod+', 'ctrl+');
  return false;
}

/** Pretty-print a combo for the UI: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. */
export function chordLabel(combo: string): string {
  const mac = isMac();
  const GLYPHS: Record<string, string> = mac
    ? { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
    : { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const NAMED: Record<string, string> = mac
    ? { right: '→', left: '←', up: '↑', down: '↓', delete: '⌫', backspace: '⌫', tab: '⇥', escape: 'esc', space: '␣', enter: '↵' }
    : { right: 'Right', left: 'Left', up: 'Up', down: 'Down', delete: 'Del', backspace: 'Bksp', tab: 'Tab', escape: 'Esc', space: 'Space', enter: 'Enter' };

  return combo
    .toLowerCase()
    .split('+')
    .filter(Boolean)
    .map((p) => GLYPHS[p] ?? NAMED[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join(mac ? '' : '+');
}
