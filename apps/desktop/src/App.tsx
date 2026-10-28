import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Shell } from '@/app/Shell.tsx';
import { ToastHost } from '@/ui/Toasts.tsx';
import { CommandPalette } from '@/app/CommandPalette.tsx';
import { ActivityCenter } from '@/app/ActivityCenter.tsx';
import { MemoryHud } from '@/app/MemoryHud.tsx';
import { ShortcutsDialog } from '@/app/ShortcutsDialog.tsx';
import { ModelsDialog } from '@/app/ModelsDialog.tsx';
import { KeyboardBus } from '@/app/KeyboardBus.tsx';
import { useUi, isEditorRoute } from '@/state/ui.ts';
import { useCatalog } from '@/state/catalog.ts';
import { useReducedMotion } from '@/ui/useReducedMotion.ts';
import { spring } from '@/ui/motion.ts';
import { useSettings } from '@/state/settings.ts';

/**
 * App root: the shell, the global overlays, and the keyboard bus.
 * Route transitions use the `swell` spring and a short blur — never a slide of
 * photo pixels (§3.4: "never animate pixels").
 */
export default function App({ bootMs }: { bootMs: number }) {
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const reduce = useReducedMotion();
  const startup = useSettings((s) => s.settings.general.startup);

  useEffect(() => {
    if (startup === 'lastView') return;
    go(startup === 'library' ? 'library' : 'home');
  }, [startup, go]);

  useEffect(() => {
    if (import.meta.env.DEV) console.info(`[swell] hydrated in ${bootMs.toFixed(1)} ms`);
  }, [bootMs]);

  return (
    <>
      <KeyboardBus />
      <AnimatePresence mode="wait">
        <motion.div
          key={route}
          initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, filter: 'blur(4px)' }}
          transition={reduce ? { duration: 0 } : spring.swell}
          className="h-full w-full"
        >
          <Shell route={route} editor={isEditorRoute(route)} />
        </motion.div>
      </AnimatePresence>

      <CommandPalette />
      <ActivityCenter />
      <MemoryHud />
      <ShortcutsDialog />
      <ModelsDialog />
      <ToastHost />
      <CatalogWatchdog />
    </>
  );
}

/**
 * Keeps the "indexing" queue alive: any photo without features gets queued
 * (respecting Settings → AI → index schedule). Runs once after hydration.
 */
function CatalogWatchdog() {
  const ready = useCatalog((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const { photos, features, order } = useCatalog.getState();
    const pending = order.filter((id) => !features[id] && photos[id]);
    if (!pending.length) return;
    void import('@/lib/analysisClient.ts').then(({ analysisClient }) =>
      analysisClient.indexAll(pending.map((id) => photos[id]!)),
    );
  }, [ready]);
  return null;
}
