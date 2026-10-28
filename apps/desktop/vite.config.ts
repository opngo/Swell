import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./src'),
      '@engine': r('./engine'),
      '@swell/schema': r('../../packages/schema/src/index.ts'),
      '@swell/shared': r('../../packages/shared/src/index.ts'),
      '@swell/shaders': r('../../packages/shaders/src/index.ts'),
      '@swell/models': r('../../packages/models/src/index.ts'),
    },
  },
  worker: { format: 'es' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The app is served inside an iframe preview host, so allow any origin.
    allowedHosts: true,
    fs: { allow: [r('../..')] },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-aria-components'],
          motion: ['motion'],
        },
      },
    },
  },
});
