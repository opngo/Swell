/**
 * Byte-accounted memory (§6.1–§6.3).
 *
 * The rules under test are the ones the Memory HUD reports and the ones that
 * keep a 4 GB session alive: eviction is by *priority first, then LRU*; a pool
 * never exceeds its budget after `set`; lowering a budget evicts immediately;
 * and `relieve()` shrinks pools in the documented order (cheap, regenerable
 * caches first — embeddings, thumbs — before anything expensive).
 */

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUDGETS, GB, LruPool, MB, MemoryBudget, PRIORITY, byteSizeOf } from '@swell/shared';

const blob = (bytes: number) => new Uint8Array(bytes);

describe('LruPool', () => {
  it('accounts bytes exactly', () => {
    const p = new LruPool<Uint8Array>('decoded', 10 * MB);
    p.set('a', blob(1024), 1024);
    p.set('b', blob(2048), 2048);
    expect(p.bytes).toBe(3072);
    expect(p.size).toBe(2);
    expect(p.stats().bytes).toBe(3072);
  });

  it('replacing a key does not double-count', () => {
    const p = new LruPool<Uint8Array>('decoded', 10 * MB);
    p.set('a', blob(100), 100);
    p.set('a', blob(400), 400);
    expect(p.bytes).toBe(400);
    expect(p.size).toBe(1);
  });

  it('evicts least-recently-used first within a priority band', () => {
    const p = new LruPool<number>('thumbs', 1000);
    p.set('a', 1, 400);
    p.set('b', 2, 400);
    p.get('a'); // a is now the most recently used
    p.set('c', 3, 400); // over budget → b goes
    expect(p.has('b')).toBe(false);
    expect(p.has('a')).toBe(true);
    expect(p.has('c')).toBe(true);
    expect(p.bytes).toBeLessThanOrEqual(1000);
    expect(p.stats().evictions).toBe(1);
  });

  it('evicts the lowest priority band first, even if it was used most recently', () => {
    const p = new LruPool<number>('standard', 1000);
    p.set('bg', 1, 400, PRIORITY.background);
    p.set('keep', 2, 400, PRIORITY.current);
    p.get('bg');
    p.set('new', 3, 400, PRIORITY.current);
    expect(p.has('bg')).toBe(false);
    expect(p.has('keep')).toBe(true);
    expect(p.has('new')).toBe(true);
  });

  it('setPriority protects an entry from eviction', () => {
    const p = new LruPool<number>('mattes', 800);
    p.set('a', 1, 300, PRIORITY.background);
    p.set('b', 2, 300, PRIORITY.background);
    p.setPriority('a', PRIORITY.current);
    p.set('c', 3, 300, PRIORITY.background);
    expect(p.has('a')).toBe(true);
    expect(p.has('b')).toBe(false);
  });

  it('calls the disposer exactly once per evicted value', () => {
    const dispose = vi.fn();
    const p = new LruPool<{ id: string }>('tiles', 500, dispose);
    p.set('a', { id: 'a' }, 200);
    p.set('b', { id: 'b' }, 200);
    p.set('c', { id: 'c' }, 200);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose.mock.calls[0]![1]).toBe('a');
    p.delete('b');
    expect(dispose).toHaveBeenCalledTimes(2);
    p.clear();
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(p.bytes).toBe(0);
    expect(p.size).toBe(0);
  });

  it('trim() frees bytes down to a target and reports how much', () => {
    const p = new LruPool<number>('decoded', 10 * MB);
    for (let i = 0; i < 10; i++) p.set(`k${i}`, i, MB);
    expect(p.bytes).toBe(10 * MB);
    const freed = p.trim(3 * MB);
    expect(freed).toBeGreaterThanOrEqual(7 * MB);
    expect(p.bytes).toBeLessThanOrEqual(3 * MB);
  });

  it('tracks hit rate', () => {
    const p = new LruPool<number>('thumbs', MB);
    p.set('a', 1, 10);
    p.get('a');
    p.get('a');
    p.get('missing');
    const s = p.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3, 6);
    expect(s.id).toBe('thumbs');
  });

  it('peek does not refresh recency', () => {
    const p = new LruPool<number>('standard', 600);
    p.set('a', 1, 300);
    p.set('b', 2, 300);
    p.peek('a');
    p.set('c', 3, 300);
    expect(p.has('a')).toBe(false); // peek must not have saved it
    expect(p.peek('b')).toBe(2);
  });

  it('an entry larger than the whole budget is dropped immediately', () => {
    const p = new LruPool<number>('ml', 100);
    p.set('huge', 1, 10_000);
    expect(p.size).toBe(0);
    expect(p.bytes).toBe(0);
  });
});

describe('MemoryBudget', () => {
  it('creates a pool per documented cache id with default budgets', () => {
    const b = new MemoryBudget();
    const snap = b.snapshot();
    expect(snap.length).toBe(Object.keys(DEFAULT_BUDGETS).length);
    for (const s of snap) expect(s.budget).toBe(DEFAULT_BUDGETS[s.id]);
    expect(b.totalBytes).toBe(0);
  });

  it('setBudget trims the pool right away', () => {
    const b = new MemoryBudget();
    const thumbs = b.pool<Uint8Array>('thumbs');
    for (let i = 0; i < 8; i++) thumbs.set(`t${i}`, blob(MB), MB);
    expect(thumbs.bytes).toBe(8 * MB);
    b.setBudget('thumbs', 2 * MB);
    expect(thumbs.bytes).toBeLessThanOrEqual(2 * MB);
    expect(b.snapshot().find((s) => s.id === 'thumbs')!.budget).toBe(2 * MB);
  });

  it('relieve() empties cheap caches before expensive ones', () => {
    const b = new MemoryBudget({}, 100 * MB);
    const fill = (id: Parameters<typeof b.pool>[0], n: number) => {
      const pool = b.pool<Uint8Array>(id);
      for (let i = 0; i < n; i++) pool.set(`${id}-${i}`, blob(MB), MB);
    };
    fill('embeddings', 4);
    fill('thumbs', 4);
    fill('decoded', 4);
    const order: string[] = [];
    const off = b.onPressure((info) => order.push(`${info.reason}:${info.freed}`));
    const freed = b.relieve(4 * MB, 'test');
    expect(freed).toBeGreaterThanOrEqual(8 * MB);
    // embeddings and thumbs (regenerable, cheap) went first
    expect(b.pool('embeddings').bytes).toBe(0);
    expect(b.pool('thumbs').bytes).toBe(0);
    // the expensive decoded previews survived
    expect(b.pool('decoded').bytes).toBeGreaterThan(0);
    expect(order).toHaveLength(1);
    expect(order[0]!.startsWith('test:')).toBe(true);
    off();
  });

  it('relieve() is a no-op when already under target', () => {
    const b = new MemoryBudget({}, 100 * MB);
    const pool = b.pool<Uint8Array>('thumbs');
    pool.set('x', blob(MB), MB);
    const listener = vi.fn();
    b.onPressure(listener);
    expect(b.relieve(50 * MB)).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('reset() clears every pool', () => {
    const b = new MemoryBudget();
    b.pool<Uint8Array>('thumbs').set('a', blob(MB), MB);
    b.pool<Uint8Array>('mattes').set('m', blob(MB), MB);
    b.reset();
    expect(b.totalBytes).toBe(0);
  });

  it('defaults are in the documented ranges (§6.1) and GB/MB agree', () => {
    expect(MB).toBe(1024 * 1024);
    expect(GB).toBe(1024 * MB);
    expect(DEFAULT_BUDGETS.thumbs).toBeGreaterThan(0);
    expect(DEFAULT_BUDGETS.decoded).toBeGreaterThan(DEFAULT_BUDGETS.thumbs);
    for (const v of Object.values(DEFAULT_BUDGETS)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('byteSizeOf', () => {
  it('measures typed arrays, buffers and image-shaped objects', () => {
    expect(byteSizeOf(new Uint8Array(1024))).toBe(1024);
    expect(byteSizeOf(new Float32Array(256))).toBe(1024);
    expect(byteSizeOf(new ArrayBuffer(64))).toBe(64);
    expect(byteSizeOf(new Uint8ClampedArray(16 * 16 * 4))).toBe(1024);
    // ImageBitmap-ish: 4 bytes per pixel
    expect(byteSizeOf({ width: 32, height: 16 })).toBe(32 * 16 * 4);
    expect(byteSizeOf(null)).toBe(0);
    expect(byteSizeOf(undefined)).toBe(0);
  });

  it('measures an ImageData by its payload', () => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    const img = new ImageData(data, 8, 8);
    expect(byteSizeOf(img)).toBe(data.byteLength);
  });
});
