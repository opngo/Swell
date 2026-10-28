/**
 * Test environment shims.
 *
 * The unit suite runs in Node, but a few modules touch browser globals on
 * import (persisted stores read `localStorage`, the shortcut helpers sniff
 * `navigator`). These stubs keep that code loadable and deterministic without
 * pulling in a DOM — components are covered by Playwright instead.
 */

import { vi } from 'vitest';

/* ------------------------------------------------------------ localStorage */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

/* --------------------------------------------------------------- navigator */

if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'linux', hardwareConcurrency: 8, userAgent: 'vitest' },
    configurable: true,
    writable: true,
  });
}

/* ---------------------------------------------------------------- ImageData */

/**
 * `resizeImageData`/`analyzeImage` are pure JS over an ImageData-shaped buffer,
 * but Node has no `ImageData` global (the worker gets it from the browser).
 * This shim keeps those modules loadable and testable off-thread.
 */
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class ImageDataShim {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb';
    constructor(a: Uint8ClampedArray | number, w: number, h?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = w;
        this.data = new Uint8ClampedArray(a * w * 4);
      } else {
        this.data = a;
        this.width = w;
        this.height = h ?? Math.max(1, Math.floor(a.length / 4 / w));
      }
    }
  }
  Object.defineProperty(globalThis, 'ImageData', {
    value: ImageDataShim,
    configurable: true,
    writable: true,
  });
}

/* ------------------------------------------------------------------ timing */

// Deterministic `now()` for eviction-order assertions.
export const resetTestClock = () => vi.useRealTimers();
