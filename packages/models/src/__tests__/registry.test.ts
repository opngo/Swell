/**
 * The model registry (§2.4, §8.5) and — just as important — the licensing gate
 * from §13: only permissively licensed weights may be shipped, RMBG-1.4 and
 * Ultralytics YOLO are excluded, and nothing installs without a checksum.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_BY_ID,
  MODELS,
  ModelRegistry,
  nullModelHost,
  type ModelHost,
  type ModelManifest,
} from '@swell/models';
import { sha256Bytes, toHex } from '@swell/shared';

/** Licences that are safe to redistribute with a commercial product. */
const PERMISSIVE = new Set([
  'Apache-2.0',
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'Unlicense',
  'ISC',
  'MPL-2.0',
]);

/** An in-memory host: records writes, can hand out fake sessions. */
function fakeHost(over: Partial<ModelHost> = {}): ModelHost & {
  written: Map<string, Uint8Array>;
  removed: string[];
  created: string[];
  destroyed: string[];
} {
  const written = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const created: string[] = [];
  const destroyed: string[] = [];
  return {
    dir: '/tmp/swell-models',
    canDownload: true,
    written,
    removed,
    created,
    destroyed,
    read: async (id) => written.get(id) ?? null,
    write: async (id, bytes) => {
      written.set(id, bytes);
    },
    remove: async (id) => {
      removed.push(id);
      written.delete(id);
    },
    createSession: async (id) => {
      created.push(id);
      return { id, session: true };
    },
    destroySession: async (id) => {
      destroyed.push(id);
    },
    ...over,
  };
}

/** A `fetch` that streams `payload` in two chunks, or fails as told. */
function stubFetch(payload: Uint8Array, init: { status?: number; body?: boolean } = {}) {
  const status = init.status ?? 200;
  const withBody = init.body ?? true;
  const fn = vi.fn(async () => {
    if (status !== 200) {
      return { ok: false, status, headers: new Headers(), body: null } as unknown as Response;
    }
    const half = Math.ceil(payload.byteLength / 2);
    const chunks = [payload.subarray(0, half), payload.subarray(half)];
    let i = 0;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(payload.byteLength) }),
      body: withBody
        ? {
            getReader: () => ({
              read: async () =>
                i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
            }),
          }
        : null,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Temporarily publish a test model with a real checksum. */
async function withTestModel<T>(payload: Uint8Array, sha: string | null, run: (id: string) => Promise<T>): Promise<T> {
  const id = `test-model-${Math.random().toString(36).slice(2, 8)}`;
  const manifest: ModelManifest = {
    id,
    name: 'Test model',
    task: 'segmentation',
    version: '0.0.1',
    licence: 'MIT',
    sizeMB: 1,
    sha256: sha,
    url: `https://models.test/${id}.onnx`,
    providers: ['cpu'],
    residentMB: 10,
    benchmark: { gpu: 1, cpu: 2 },
    notes: 'test fixture',
  };
  MODELS.push(manifest);
  MODEL_BY_ID.set(id, manifest);
  try {
    return await run(id);
  } finally {
    MODELS.splice(MODELS.indexOf(manifest), 1);
    MODEL_BY_ID.delete(id);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('manifest catalogue', () => {
  it('has unique ids and a lookup map that matches', () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    for (const m of MODELS) expect(MODEL_BY_ID.get(m.id)).toBe(m);
  });

  it('covers every task the product needs a model for', () => {
    const tasks = new Set(MODELS.map((m) => m.task));
    for (const t of ['segmentation', 'matting', 'detection', 'faces', 'inpainting', 'depth', 'sky'] as const) {
      expect(tasks.has(t), `no model for ${t}`).toBe(true);
    }
  });

  it('never lists RMBG-1.4 or Ultralytics YOLO (non-commercial / AGPL)', () => {
    // Notes may *mention* an excluded model to explain the choice; what matters
    // is that no listed model is one of them.
    for (const m of MODELS) {
      const hay = `${m.id} ${m.name} ${m.url}`.toLowerCase();
      expect(hay, m.id).not.toMatch(/rmbg/);
      expect(hay, m.id).not.toMatch(/yolo/);
      expect(hay, m.id).not.toMatch(/ultralytics/);
    }
  });

  it('only ships permissive licences; anything else is opt-in and unpublished', () => {
    for (const m of MODELS) {
      if (PERMISSIVE.has(m.licence)) continue;
      expect(m.requiresOptIn, `${m.id} (${m.licence}) must be opt-in`).toBe(true);
      expect(m.sha256, `${m.id} (${m.licence}) must not be installable`).toBeNull();
    }
  });

  it('keeps opt-in features (face recognition, AI denoise) explicitly flagged', () => {
    const optIn = MODELS.filter((m) => m.requiresOptIn);
    expect(optIn.length).toBeGreaterThan(0);
    expect(optIn.map((m) => m.task)).toContain('faces');
    for (const m of optIn) expect(m.sha256).toBeNull();
  });

  it('has sane sizes, providers and download URLs for installable models', () => {
    for (const m of MODELS) {
      expect(m.sizeMB, m.id).toBeGreaterThan(0);
      expect(m.residentMB, m.id).toBeGreaterThan(0);
      expect(m.providers.length, m.id).toBeGreaterThan(0);
      expect(m.benchmark.gpu, m.id).toBeGreaterThanOrEqual(0);
      if (m.sha256 !== null || !m.requiresOptIn) {
        expect(m.url.startsWith('https://'), `${m.id} must download over https`).toBe(true);
      }
    }
  });

  it('notes which models are small enough to stay resident', () => {
    const tiny = MODELS.filter((m) => m.residentMB < 100);
    expect(tiny.length).toBeGreaterThan(0);
  });
});

describe('ModelRegistry — initial state', () => {
  it('reports every model as not downloaded on a host that can download', () => {
    const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    expect(reg.list()).toHaveLength(MODELS.length);
    for (const row of reg.list()) {
      expect(row.status.state).toBe('not-downloaded');
      expect(row.status.resident).toBe(false);
      expect(row.status.bytesOnDisk).toBe(0);
      expect(row.status.progress).toBe(0);
    }
  });

  it('marks the web runtime unsupported instead of pretending to download', () => {
    const reg = new ModelRegistry(nullModelHost, { residentLimit: 1, unloadAfterIdleMs: 1000 });
    expect(nullModelHost.canDownload).toBe(false);
    expect(nullModelHost.dir).toBe('');
    for (const row of reg.list()) expect(row.status.state).toBe('unsupported-here');
    expect(reg.isReady('birefnet')).toBe(false);
    expect(reg.get('birefnet')?.state).toBe('unsupported-here');
  });

  it('refuses up front when no checksum has been published', () => {
    const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    const unverified = MODELS.filter((m) => m.sha256 === null);
    expect(unverified.length).toBeGreaterThan(0);
    for (const m of unverified) {
      expect(reg.get(m.id)!.state, m.id).toBe('not-downloaded');
      expect(reg.get(m.id)!.error, m.id).toMatch(/checksum/i);
    }
  });

  it('get() is undefined for unknown ids', () => {
    const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    expect(reg.get('does-not-exist')).toBeUndefined();
    expect(reg.isReady('does-not-exist')).toBe(false);
  });
});

describe('ModelRegistry.download', () => {
  it('rejects an unknown id', async () => {
    const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    await expect(reg.download('nope')).rejects.toThrow(/Unknown model/);
  });

  it('does nothing but explain itself when downloads are unavailable', async () => {
    const reg = new ModelRegistry(nullModelHost, { residentLimit: 1, unloadAfterIdleMs: 1000 });
    await expect(reg.download('birefnet')).resolves.toBeUndefined();
    expect(reg.get('birefnet')!.state).toBe('unsupported-here');
    expect(reg.get('birefnet')!.error).toMatch(/desktop build/);
  });

  it('reports checksum-missing for every model in the current catalogue', async () => {
    const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    const fetchSpy = stubFetch(new Uint8Array(4));
    await reg.download('birefnet');
    expect(reg.get('birefnet')!.state).toBe('checksum-missing');
    expect(reg.get('birefnet')!.error).toMatch(/checksum/i);
    expect(fetchSpy).not.toHaveBeenCalled(); // never even hits the network
  });

  it('downloads, verifies and stores a model with a published checksum', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const digest = toHex(sha256Bytes(payload));
    await withTestModel(payload, digest, async (id) => {
      const host = fakeHost();
      const reg = new ModelRegistry(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
      const seen: number[] = [];
      stubFetch(payload);
      await reg.download(id, (p) => seen.push(p));
      expect(reg.get(id)!.state).toBe('ready');
      expect(reg.get(id)!.error).toBeUndefined();
      expect(reg.get(id)!.bytesOnDisk).toBe(payload.byteLength);
      expect(reg.get(id)!.progress).toBe(1);
      expect(reg.isReady(id)).toBe(true);
      expect(host.written.get(id)).toEqual(payload);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[seen.length - 1]).toBeCloseTo(1, 6);
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    });
  });

  it('fails closed on a checksum mismatch and writes nothing to disk', async () => {
    const payload = new Uint8Array([9, 9, 9, 9]);
    await withTestModel(payload, 'deadbeef'.repeat(8), async (id) => {
      const host = fakeHost();
      const reg = new ModelRegistry(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
      stubFetch(payload);
      await reg.download(id);
      expect(reg.get(id)!.state).toBe('failed');
      expect(reg.get(id)!.error).toMatch(/^Checksum mismatch: [0-9a-f]{64}$/);
      expect(host.written.has(id)).toBe(false);
      expect(reg.isReady(id)).toBe(false);
    });
  });

  it('surfaces HTTP and body errors without throwing at the caller', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const digest = toHex(sha256Bytes(payload));
    await withTestModel(payload, digest, async (id) => {
      const reg = new ModelRegistry(fakeHost(), { residentLimit: 2, unloadAfterIdleMs: 60_000 });
      stubFetch(payload, { status: 404 });
      await reg.download(id);
      expect(reg.get(id)!.state).toBe('failed');
      expect(reg.get(id)!.error).toBe('HTTP 404');

      stubFetch(payload, { body: false });
      await reg.download(id);
      expect(reg.get(id)!.state).toBe('failed');
      expect(reg.get(id)!.error).toBe('No response body');
    });
  });

  it('remove() puts a model back to not-downloaded and drops its session', async () => {
    const payload = new Uint8Array([4, 5, 6]);
    const digest = toHex(sha256Bytes(payload));
    await withTestModel(payload, digest, async (id) => {
      const host = fakeHost();
      const reg = new ModelRegistry(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
      stubFetch(payload);
      await reg.download(id);
      await reg.acquire(id);
      expect(reg.residentCount()).toBe(1);
      await reg.remove(id);
      expect(host.removed).toContain(id);
      expect(host.written.has(id)).toBe(false);
      expect(reg.get(id)!.state).toBe('not-downloaded');
      expect(reg.get(id)!.bytesOnDisk).toBe(0);
      expect(reg.residentCount()).toBe(0);
    });
  });
});

describe('ModelRegistry — residency and idle unload (§6.2)', () => {
  const reg = (host: ModelHost, opts: { residentLimit: number; unloadAfterIdleMs: number }) =>
    new ModelRegistry(host, opts);

  /** Pretend a model is on disk so acquire() can run without a download. */
  const ready = (r: ModelRegistry, id: string) => {
    const st = r.get(id)!;
    st.state = 'ready';
    st.bytesOnDisk = 1024;
  };

  it('acquire() returns null when the model is not ready', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    expect(await r.acquire('birefnet')).toBeNull();
    expect(host.created).toEqual([]);
    expect(r.residentCount()).toBe(0);
  });

  it('acquire() returns null when the host cannot create sessions', async () => {
    const host = fakeHost({ createSession: undefined });
    const r = reg(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    ready(r, 'yunet');
    expect(await r.acquire('yunet')).toBeNull();
  });

  it('caches a session and marks the model resident', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 2, unloadAfterIdleMs: 60_000 });
    ready(r, 'yunet');
    const a = await r.acquire('yunet');
    const b = await r.acquire('yunet');
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(host.created).toEqual(['yunet']);
    expect(r.get('yunet')!.resident).toBe(true);
    expect(r.residentCount()).toBe(1);
  });

  it('evicts the least recently used session at the resident limit', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 1, unloadAfterIdleMs: 60_000 });
    ready(r, 'yunet');
    ready(r, 'sky-seg');
    await r.acquire('yunet');
    await r.acquire('sky-seg');
    expect(r.residentCount()).toBe(1);
    expect(r.get('yunet')!.resident).toBe(false);
    expect(r.get('sky-seg')!.resident).toBe(true);
    expect(host.destroyed).toEqual(['yunet']);
  });

  it('release() frees one session', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 3, unloadAfterIdleMs: 60_000 });
    ready(r, 'yunet');
    await r.acquire('yunet');
    await r.release('yunet');
    expect(r.residentCount()).toBe(0);
    expect(r.get('yunet')!.resident).toBe(false);
    expect(host.destroyed).toEqual(['yunet']);
    await r.release('yunet'); // idempotent
    expect(host.destroyed).toEqual(['yunet']);
  });

  it('unloadIdle() only disposes sessions past the idle timeout', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 3, unloadAfterIdleMs: 5_000 });
    ready(r, 'yunet');
    ready(r, 'sky-seg');
    const t0 = Date.now();
    await r.acquire('yunet');
    await r.acquire('sky-seg');
    expect(await r.unloadIdle(t0 + 1_000)).toEqual([]);
    expect(r.residentCount()).toBe(2);
    const freed = await r.unloadIdle(t0 + 60_000);
    expect(freed.sort()).toEqual(['sky-seg', 'yunet']);
    expect(r.residentCount()).toBe(0);
    expect(host.destroyed.sort()).toEqual(['sky-seg', 'yunet']);
  });

  it('a re-acquire after idle unload creates a fresh session', async () => {
    const host = fakeHost();
    const r = reg(host, { residentLimit: 3, unloadAfterIdleMs: 5_000 });
    ready(r, 'yunet');
    const first = await r.acquire('yunet');
    await r.unloadIdle(Date.now() + 60_000);
    const second = await r.acquire('yunet');
    expect(second).not.toBe(first);
    expect(host.created).toEqual(['yunet', 'yunet']);
  });
});
