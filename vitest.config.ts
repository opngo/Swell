/**
 * Vitest configuration (§13).
 *
 * Unit tests cover the deterministic, CPU-side contracts: curve maths, colour
 * conversions, param migrations, memory evictions, view maths and the uniform
 * packing that feeds the GPU. Anything needing a GL context is covered by the
 * shader parse gate (`npm run lint:shaders`) and, in CI, by Playwright.
 *
 * Aliases mirror `apps/desktop/vite.config.ts` so a test can import exactly
 * what the app imports.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const at = (p: string) => resolve(root, p);

export default defineConfig({
  resolve: {
    alias: {
      '@swell/shared': at('packages/shared/src/index.ts'),
      '@swell/schema': at('packages/schema/src/index.ts'),
      '@swell/shaders': at('packages/shaders/src/index.ts'),
      '@swell/models': at('packages/models/src/index.ts'),
      '@engine': at('apps/desktop/engine'),
      '@': at('apps/desktop/src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [at('tests/setup.ts')],
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/engine/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
    testTimeout: 20_000,
  },
});
