import { Suspense, lazy } from 'react';
import { cx } from '@/ui/cx.ts';
import { Rail, SidePanel } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { useUi, type RouteId } from '@/state/ui.ts';
import { EditorShell } from '@/editor/EditorShell.tsx';
import { Filmstrip } from '@/editor/Filmstrip.tsx';
import { InspectorColumn } from '@/editor/InspectorColumn.tsx';
import { Spinner } from '@/ui/Button.tsx';

const HomePage = lazy(() => import('@/pages/HomePage.tsx'));
const LibraryPage = lazy(() => import('@/pages/LibraryPage.tsx'));
const CullPage = lazy(() => import('@/pages/CullPage.tsx'));
const SmartPage = lazy(() => import('@/pages/SmartPage.tsx'));
const PresetsPage = lazy(() => import('@/pages/PresetsPage.tsx'));
const ExportPage = lazy(() => import('@/pages/ExportPage.tsx'));

/**
 * The window frame: rail · contextual side panel · main · inspector, with the
 * top bar and status bar spanning the full width (§3.1).
 *
 * Column widths animate — that is a layout transition, never a pixel one.
 */
export function Shell({ route, editor }: { route: RouteId; editor: boolean }) {
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const filmstripOpen = useUi((s) => s.filmstripOpen);

  const columns = [
    '56px',
    leftOpen ? 'minmax(180px, 224px)' : '0px',
    'minmax(0, 1fr)',
    editor && rightOpen ? 'minmax(280px, 340px)' : '0px',
  ].join(' ');

  return (
    <div
      className="grid h-full w-full overflow-hidden bg-s0 text-t1"
      style={{
        gridTemplateColumns: columns,
        gridTemplateRows: '46px minmax(0,1fr) 26px',
        transition: 'grid-template-columns 260ms cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <div className="col-span-full min-w-0">
        <TopBar route={route} />
      </div>

      <div className="row-span-1 min-h-0">
        <Rail />
      </div>

      <div className={cx('min-h-0 overflow-hidden transition-opacity duration-200', leftOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <SidePanel route={route} />
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-s0">
        <Suspense fallback={<RouteFallback />}>
          <div className="min-h-0 flex-1 overflow-hidden">
            {editor ? (
              <EditorShell route={route} />
            ) : (
              <div className="h-full w-full overflow-hidden">
                {route === 'home' && <HomePage />}
                {route === 'library' && <LibraryPage />}
                {route === 'cull' && <CullPage />}
                {route === 'smart' && <SmartPage />}
                {route === 'presets' && <PresetsPage />}
                {route === 'export' && <ExportPage />}
              </div>
            )}
          </div>
        </Suspense>

        {editor && filmstripOpen && <Filmstrip />}
      </main>

      {editor && (
        <div className={cx('min-h-0 overflow-hidden transition-opacity duration-200', rightOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}>
          <InspectorColumn />
        </div>
      )}

      <div className="col-span-full min-w-0">
        <StatusBar />
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="grid h-full place-items-center text-t3">
      <Spinner />
    </div>
  );
}
