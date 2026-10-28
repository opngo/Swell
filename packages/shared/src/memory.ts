/**
 * MemoryBudget — §6 of the spec: "Memory is a first-class feature."
 *
 * A single service owns every cache pool, accounts in **bytes** (not item
 * counts), and evicts across pools by priority:
 *
 *     current photo (P0) > neighbours ±5 (P1) > everything else (P2)
 *
 * Pools are trimmed independently up to their own budget, then globally when
 * the total exceeds the process budget (e.g. on an OS memory-pressure event).
 */

export type PoolId =
  | 'thumbs'
  | 'standard'
  | 'decoded'
  | 'tiles'
  | 'mattes'
  | 'ml'
  | 'embeddings';

/**
 * Eviction rank — the higher the number, the sooner it goes. `current` (the
 * photo on screen) is kept longest, `background` (prefetch, speculative work)
 * is dropped first. Anything can be evicted; this only decides the order.
 */
export const PRIORITY = { current: 0, neighbour: 1, background: 2 } as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export type PoolStats = {
  id: PoolId;
  bytes: number;
  budget: number;
  items: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
};

export type Disposer<V> = (value: V, key: string) => void;

type Entry<V> = { key: string; value: V; bytes: number; priority: Priority; lastUsed: number };

/** LRU + priority cache with exact byte accounting and explicit disposal. */
export class LruPool<V> {
  readonly id: PoolId;
  budget: number;
  bytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  private map = new Map<string, Entry<V>>();
  private dispose?: Disposer<V>;

  constructor(id: PoolId, budget: number, dispose?: Disposer<V>) {
    this.id = id;
    this.budget = budget;
    this.dispose = dispose;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    e.lastUsed = now();
    // refresh Map insertion order (Map iterates in insertion order)
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  set(key: string, value: V, bytes: number, priority: Priority = PRIORITY.background): void {
    const existing = this.map.get(key);
    // Replacing a key frees its old bytes first; the entry is not "evicted",
    // so the dispose hook does not fire here (see `trim`).
    if (existing) this.bytes -= existing.bytes;
    const entry: Entry<V> = { key, value, bytes: Math.max(0, bytes), priority, lastUsed: now() };
    this.map.delete(key);
    this.map.set(key, entry);
    this.bytes += entry.bytes;
    this.trim();
  }

  /** Raise/lower an entry's priority without touching its value. */
  setPriority(key: string, priority: Priority): void {
    const e = this.map.get(key);
    if (e) e.priority = priority;
  }

  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.bytes -= e.bytes;
    this.dispose?.(e.value, key);
    return true;
  }

  clear(): void {
    for (const e of this.map.values()) this.dispose?.(e.value, e.key);
    this.map.clear();
    this.bytes = 0;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  /** Evict until under budget. Returns bytes freed. */
  trim(target = this.budget): number {
    const before = this.bytes;
    while (this.bytes > target && this.map.size > 0) {
      const victim = this.pickVictim();
      if (!victim) break;
      this.map.delete(victim.key);
      this.bytes -= victim.bytes;
      this.evictions++;
      this.dispose?.(victim.value, victim.key);
    }
    return before - this.bytes;
  }

  /** Lowest priority first; within a priority band, least-recently-used. */
  private pickVictim(): Entry<V> | undefined {
    let worst: Entry<V> | undefined;
    for (const e of this.map.values()) {
      if (!worst) {
        worst = e;
        continue;
      }
      if (e.priority > worst.priority) worst = e;
      else if (e.priority === worst.priority && e.lastUsed < worst.lastUsed) worst = e;
    }
    return worst;
  }

  stats(): PoolStats {
    const total = this.hits + this.misses;
    return {
      id: this.id,
      bytes: this.bytes,
      budget: this.budget,
      items: this.map.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

let clock = 0;
const now = () => ++clock; // monotonic, allocation-ordered — no Date churn

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export type BudgetConfig = Record<PoolId, number>;

export const DEFAULT_BUDGETS: BudgetConfig = {
  thumbs: 256 * MB,
  standard: 768 * MB,
  decoded: 1 * GB,
  tiles: 2 * GB,
  mattes: 128 * MB,
  ml: 1 * GB,
  embeddings: 64 * MB,
};

export type PressureListener = (info: { freed: number; totalBytes: number; reason: string }) => void;

/**
 * Owns all pools. The renderer calls `budget.allocate(...)` for every cached
 * bitmap/buffer; the Memory HUD reads `snapshot()`.
 */
export class MemoryBudget {
  private pools = new Map<PoolId, LruPool<unknown>>();
  private totalBudget: number;
  private listeners = new Set<PressureListener>();

  constructor(budgets: Partial<BudgetConfig> = {}, totalBudget = 4 * GB) {
    const merged = { ...DEFAULT_BUDGETS, ...budgets };
    (Object.keys(merged) as PoolId[]).forEach((id) => {
      this.pools.set(id, new LruPool<unknown>(id, merged[id]!));
    });
    this.totalBudget = totalBudget;
  }

  pool<V>(id: PoolId): LruPool<V> {
    let p = this.pools.get(id) as LruPool<V> | undefined;
    if (!p) {
      p = new LruPool<V>(id, DEFAULT_BUDGETS[id] ?? 64 * MB);
      this.pools.set(id, p as LruPool<unknown>);
    }
    return p;
  }

  setBudget(id: PoolId, bytes: number): void {
    const p = this.pools.get(id);
    if (!p) return;
    p.budget = Math.max(0, bytes);
    p.trim();
  }

  setBudgets(budgets: Partial<BudgetConfig>): void {
    for (const [k, v] of Object.entries(budgets)) this.setBudget(k as PoolId, v!);
  }

  get totalBytes(): number {
    let t = 0;
    for (const p of this.pools.values()) t += p.bytes;
    return t;
  }

  /** Called by the OS-pressure bridge (Electron) or the poll loop (web). */
  onPressure(listener: PressureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Shrink caches in priority order until `totalBytes <= target`.
   * Priority order per §6.2: embeddings → thumbs → standard → mattes → decoded → tiles → ml.
   */
  relieve(target = this.totalBudget * 0.8, reason = 'pressure'): number {
    const order: PoolId[] = ['embeddings', 'thumbs', 'standard', 'mattes', 'decoded', 'tiles', 'ml'];
    const before = this.totalBytes;
    for (const id of order) {
      if (this.totalBytes <= target) break;
      const pool = this.pools.get(id);
      if (!pool) continue;
      const overshoot = this.totalBytes - target;
      pool.trim(Math.max(0, pool.bytes - overshoot));
    }
    const freed = before - this.totalBytes;
    if (freed > 0) {
      const info = { freed, totalBytes: this.totalBytes, reason };
      for (const l of this.listeners) l(info);
    }
    return freed;
  }

  snapshot(): PoolStats[] {
    return [...this.pools.values()].map((p) => p.stats());
  }

  reset(): void {
    for (const p of this.pools.values()) p.clear();
  }
}

/**
 * Estimate the byte cost of common cached objects. Kept in one place so the
 * numbers in the HUD match what is actually retained.
 */
export function byteSizeOf(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof ImageData) return value.data.byteLength;
  if (ArrayBuffer.isView(value)) return (value as ArrayBufferView).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  const v = value as { width?: number; height?: number; byteLength?: number };
  if (typeof v.width === 'number' && typeof v.height === 'number') {
    // ImageBitmap / canvas-backed: 4 bytes per pixel
    return v.width * v.height * 4;
  }
  if (typeof v.byteLength === 'number') return v.byteLength;
  return 0;
}
