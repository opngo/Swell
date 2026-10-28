/**
 * Tiny IndexedDB wrapper. In the browser build this is the catalog's durable
 * store; the Electron build swaps in better-sqlite3 + Drizzle behind the same
 * interface (`CatalogDriver` in `electron/utility/catalog`).
 */

const DB_NAME = 'swell';
const DB_VERSION = 1;
const STORES = ['kv', 'photos', 'features', 'params', 'presets', 'masks'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbAll<T>(store: StoreName): Promise<{ key: string; value: T }[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const out: { key: string; value: T }[] = [];
    const req = os.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out.push({ key: String(c.key), value: c.value as T });
        c.continue();
      } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Fire-and-forget JSON persistence with a debounce (used by the stores). */
const timers = new Map<string, number>();
export function persistDebounced(store: StoreName, key: string, value: unknown, ms = 400) {
  const id = `${store}:${key}`;
  const prev = timers.get(id);
  if (prev) window.clearTimeout(prev);
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      void idbSet(store, key, value).catch(() => undefined);
    }, ms),
  );
}
