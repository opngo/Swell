/**
 * A module-level handle on the *currently mounted* engine client.
 *
 * Panels that need to push a bitmap into the GPU (image layers, imported LUTs)
 * live far from the stage in the component tree; threading a ref through every
 * panel would be noise. useEngineStage sets this on mount and clears it on
 * unmount, so there is only ever one live engine.
 */

import type { EngineClient } from '@/engine-client/EngineClient.ts';

let current: EngineClient | null = null;

export function setEngine(client: EngineClient | null): void {
  current = client;
}

export function getEngine(): EngineClient | null {
  return current;
}
