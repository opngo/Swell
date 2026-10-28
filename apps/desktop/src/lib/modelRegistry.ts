/**
 * The app's ModelRegistry singleton (§8.6).
 *
 * Weights are never bundled. In the desktop build the host is the model
 * directory on disk; here it is IndexedDB. Either way a download is refused
 * unless the manifest carries a published SHA-256 — an unverified blob must
 * never reach a user's machine.
 */

import { ModelRegistry, nullModelHost, type ModelHost } from '@swell/models';
import { idbDel, idbGet, idbSet } from '@/lib/persist.ts';
import { getSettings } from '@/state/settings.ts';

const key = (id: string) => `model:${id}`;

/** IndexedDB-backed host. `canDownload` follows the strict-offline setting. */
export const idbModelHost: ModelHost = {
  dir: 'indexeddb://swell/models',
  get canDownload() {
    try {
      return !getSettings().ai.offlineMode;
    } catch {
      return false;
    }
  },
  async read(id) {
    try {
      const v = await idbGet<Uint8Array>('masks', key(id));
      return v ?? null;
    } catch {
      return null;
    }
  },
  async write(id, bytes) {
    await idbSet('masks', key(id), bytes);
  },
  async remove(id) {
    await idbDel('masks', key(id));
  },
};

function makeRegistry(): ModelRegistry {
  let perf = { residentModels: 1, unloadAfterIdleSec: 60 };
  try {
    const s = getSettings();
    perf = { residentModels: s.ai.residentModels, unloadAfterIdleSec: s.ai.unloadAfterIdleSec };
  } catch {
    /* settings not hydrated yet — defaults are fine */
  }
  const host = typeof indexedDB === 'undefined' ? nullModelHost : idbModelHost;
  return new ModelRegistry(host, {
    residentLimit: Math.max(0, perf.residentModels),
    unloadAfterIdleMs: perf.unloadAfterIdleSec * 1000,
  });
}

export const registry = makeRegistry();

/**
 * The residency limit and idle timeout are read once at start-up (the registry
 * keeps them private). Changing them in Settings takes effect on the next
 * launch — documented in docs/STATUS.md.
 */
