import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';

import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/fraunces';
import './styles/tokens.css';

import App from './App.tsx';
import { editorStore } from './state/atoms.ts';
import { useCatalog } from './state/catalog.ts';
import { useDevelop } from './state/develop.ts';
import { useSettings } from './state/settings.ts';

/**
 * Boot: hydrate the persisted stores before the first paint so a reload lands
 * exactly where the user left off (§10.1 "restored state"). Crash recovery is
 * the same mechanism — the develop store debounces every param change to
 * IndexedDB, so at most the last half-second of edits is ever at risk.
 */
async function boot() {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');

  // Apply settings to the DOM immediately (accent, density, backdrop).
  useSettings.getState();

  const started = performance.now();
  await Promise.all([useCatalog.getState().hydrate(), useDevelop.getState().hydrate()]);

  createRoot(root).render(
    <StrictMode>
      <JotaiProvider store={editorStore}>
        <App bootMs={performance.now() - started} />
      </JotaiProvider>
    </StrictMode>,
  );
}

void boot().catch((err) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding:32px;font:13px/1.5 system-ui;color:#e8e8ea">
      <h1 style="font-size:18px;margin:0 0 8px">Swell could not start</h1>
      <p style="margin:0 0 12px;color:#9a9aa2">${String(err?.message ?? err)}</p>
      <button onclick="localStorage.clear();indexedDB.deleteDatabase('swell');location.reload()"
        style="font:13px system-ui;padding:8px 14px;border-radius:10px;border:0;background:#2a2a30;color:#fff;cursor:pointer">
        Reset local data and reload
      </button></div>`;
  }
});
