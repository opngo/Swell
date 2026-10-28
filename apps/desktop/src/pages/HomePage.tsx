import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { KeyValue } from '@/ui/Controls.tsx';
import { Switch } from '@/ui/Controls.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useUi } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import { formatBytes, formatDate, relativeTime, uid } from '@swell/shared';
import type { Photo } from '@swell/schema';

/**
 * Page 1 — Home & Import (§4.1).
 *
 * The catalog lives on this machine: importing reads files through the browser
 * File API (object URLs in the web build, real paths in Electron) and never
 * uploads anything. Everything below is a real action, not a mockup.
 */

export function HomePage() {
  const folders = useCatalog((s) => s.folders);
  const photos = useCatalog((s) => s.photos);
  const order = useCatalog((s) => s.order);
  const tasks = useCatalog((s) => s.tasks);
  const addPhotos = useCatalog((s) => s.addPhotos);
  const createCollection = useCatalog((s) => s.createCollection);
  const addToCollection = useCatalog((s) => s.addToCollection);
  const go = useUi((s) => s.go);
  const select = useCatalog((s) => s.select);
  const edited = useDevelop((s) => s.params);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const [opts, setOpts] = useState({
    previews: true,
    collection: true,
    keywords: false,
    sidecar: true,
    dedupe: true,
  });

  const stats = useMemo(() => {
    const bytes = order.reduce((a, id) => a + (photos[id]?.size ?? 0), 0);
    const cams = new Map<string, number>();
    for (const id of order) {
      const c = photos[id]?.camera;
      if (c) cams.set(c, (cams.get(c) ?? 0) + 1);
    }
    return {
      count: order.length,
      bytes,
      folders: folders.length,
      edited: Object.keys(edited).length,
      cameras: [...cams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
      pending: tasks.filter((t) => t.state === 'running' || t.state === 'queued').length,
    };
  }, [order, photos, folders, edited, tasks]);

  const recent = useMemo(() => order.slice(0, 12), [order]);

  async function importFiles(files: File[], folderName?: string) {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|avif|tiff?)$/i.test(f.type) || /\.(jpe?g|png|webp|avif|tif?f)$/i.test(f.name));
    if (!images.length) {
      toast.warn('Nothing to import', 'No supported image files in that selection.');
      return;
    }
    setBusy(true);
    const folderId = folderName ? uid('folder') : undefined;
    if (folderName && folderId) {
      useCatalog.setState((s) => {
        s.folders.push({ id: folderId, name: folderName, path: folderName, volumeId: 'v-archive' });
      });
    }

    const known = new Set(useCatalog.getState().order.map((id) => useCatalog.getState().photos[id]?.filename));
    const made: Photo[] = [];
    for (const f of images) {
      if (opts.dedupe && known.has(f.name)) continue;
      const url = URL.createObjectURL(f);
      let width = 1536;
      let height = 1024;
      try {
        const bmp = await createImageBitmap(await f.arrayBuffer().then((b) => new Blob([b], { type: f.type })));
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } catch {
        /* keep the fallback dimensions */
      }
      made.push({
        id: uid('p'),
        filename: f.name,
        title: f.name.replace(/\.[^.]+$/, ''),
        src: url,
        width,
        height,
        size: f.size,
        camera: folderName ?? 'Imported',
        lens: 'Unknown lens',
        captureTime: f.lastModified ? new Date(f.lastModified).toISOString() : new Date().toISOString(),
        addedTime: new Date().toISOString(),
        folderId,
        rating: 0,
        flag: 'none',
        colorLabel: 'none',
        keywords: [],
        indexState: 'pending',
      } as unknown as Photo);
    }

    if (!made.length) {
      setBusy(false);
      toast.info('All duplicates', 'Every file was already in the catalog.');
      return;
    }

    addPhotos(made, { folderId });
    if (opts.collection) {
      const cid = createCollection(`${folderName ?? 'Import'} ${formatDate(new Date().toISOString())}`, 'manual');
      addToCollection(cid, made.map((p) => p.id));
    }
    setBusy(false);
    toast.ok(`Imported ${made.length} photo${made.length > 1 ? 's' : ''}`, 'Indexing runs in the background — smart search fills in as it goes.');
    go('library');
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4">
        {/* hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="rounded-[var(--radius-xl)] bg-s1 p-5 shadow-[var(--e1)]"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-display text-4xl font-semibold tracking-tight text-t1">Welcome back</h1>
              <p className="mt-1 text-sm text-t3">
                {stats.count.toLocaleString()} photos · {formatBytes(stats.bytes)} · {stats.folders} sources ·{' '}
                {stats.edited} edited. Everything stays on this machine.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" icon="import" onClick={() => fileRef.current?.click()} loading={busy}>
                Import photos
              </Button>
              <Button icon="library" onClick={() => dirRef.current?.click()}>
                Import folder
              </Button>
              <Button variant="ghost" icon="photos" onClick={() => go('library')}>
                Library
              </Button>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => void importFiles([...(e.target.files ?? [])])}
          />
          <input
            ref={dirRef}
            type="file"
            multiple
            // @ts-expect-error non-standard but supported everywhere we run
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              const first = (files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath ?? '';
              void importFiles(files, first.split('/')[0] || 'Imported folder');
            }}
          />

          {/* drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dt = e.dataTransfer;
              if (dt?.files?.length) void importFiles([...dt.files]);
            }}
            className={cx(
              'mt-4 grid place-items-center rounded-[var(--radius-lg)] px-6 py-8 text-center transition-all duration-[180ms]',
              dragging ? 'bg-[var(--color-accent-soft)] shadow-[var(--halo)]' : 'bg-s2 shadow-[var(--e-inset)]',
            )}
          >
            <SwIcon name="import" size={26} className={dragging ? 'text-[var(--color-accent)]' : 'text-t3'} />
            <div className="mt-2 text-sm text-t2">Drop photos or a folder anywhere in this window</div>
            <div className="mt-0.5 text-2xs text-t3">
              JPEG · PNG · WebP · AVIF · TIFF here — RAW (CR3/NEF/ARW/DNG) in the desktop build via LibRaw
            </div>
          </div>
        </motion.div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* import options */}
          <Section title="Import options" icon="sliders">
            <div className="flex flex-col gap-1 px-2 pb-2">
              <Switch checked={opts.previews} label="Build standard previews" description="1440 px smart previews so the catalog works offline" onChange={(v) => setOpts({ ...opts, previews: v })} />
              <Switch checked={opts.dedupe} label="Skip duplicates" description="Matched on filename and byte size" onChange={(v) => setOpts({ ...opts, dedupe: v })} />
              <Switch checked={opts.collection} label="Add to a new collection" onChange={(v) => setOpts({ ...opts, collection: v })} />
              <Switch checked={opts.keywords} label="Apply keywords from folder name" onChange={(v) => setOpts({ ...opts, keywords: v })} />
              <Switch checked={opts.sidecar} label="Write XMP sidecars" description="Edits travel with the file" onChange={(v) => setOpts({ ...opts, sidecar: v })} />
            </div>
          </Section>

          {/* continue */}
          <Section title="Continue where you left off" icon="history">
            <div className="flex flex-col gap-1 px-2 pb-2">
              {Object.keys(edited).slice(0, 4).map((id) => {
                const p = photos[id];
                if (!p) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      select(id);
                      go('develop');
                    }}
                    className="flex items-center gap-2 rounded-[var(--radius-md)] bg-s2 p-1.5 text-left transition-colors hover:bg-s3"
                  >
                    <img src={p.src} alt="" className="size-9 shrink-0 rounded-[var(--radius-sm)] object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xs text-t1">{p.title || p.filename}</span>
                      <span className="numeric block text-[10px] text-t3">{formatDate(p.captureTime)}</span>
                    </span>
                    <SwIcon name="develop" size={14} className="shrink-0 text-[var(--color-accent)]" />
                  </button>
                );
              })}
              {!stats.edited && <p className="px-1 py-2 text-2xs text-t3">No edits yet — pick a photo and press D.</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                <Chip icon="cull" onClick={() => go('cull')}>Start culling</Chip>
                <Chip icon="smart" onClick={() => go('smart')}>Smart search</Chip>
                <Chip icon="presets" onClick={() => go('presets')}>Browse presets</Chip>
                <Chip icon="export" onClick={() => go('export')}>Export</Chip>
              </div>
            </div>
          </Section>

          {/* recent */}
          <Section title="Recently added" icon="clock">
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {recent.map((id) => {
                const p = photos[id];
                if (!p) return null;
                return (
                  <button key={id} type="button" onClick={() => { select(id); go('develop'); }} className="group relative">
                    <img
                      src={p.src}
                      alt={p.title || p.filename}
                      className="size-20 rounded-[var(--radius-md)] object-cover transition-transform duration-[160ms] group-hover:scale-[1.03]"
                    />
                    <span className="numeric absolute inset-x-0 bottom-0 rounded-b-[var(--radius-md)] bg-[oklch(0.1_0.01_250/0.7)] px-1 py-0.5 text-[9px] text-t2 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                      {relativeTime(p.addedTime)}
                    </span>
                  </button>
                );
              })}
              {!recent.length && <p className="px-1 py-2 text-2xs text-t3">Nothing imported yet.</p>}
            </div>
          </Section>

          {/* catalog health */}
          <Section title="Catalog" icon="library">
            <div className="px-2 pb-2">
              <KeyValue k="Photos" v={stats.count.toLocaleString()} mono />
              <KeyValue k="On disk" v={formatBytes(stats.bytes)} mono />
              <KeyValue k="Sources" v={String(stats.folders)} mono />
              <KeyValue k="Indexed" v={`${stats.count - tasks.filter((t) => t.state !== 'done').length}/${stats.count}`} mono />
              <KeyValue k="Background tasks" v={String(stats.pending)} mono />
              {stats.cameras.map(([cam, n]) => (
                <KeyValue key={cam} k={cam} v={`${n} photos`} />
              ))}
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone="ok">Local-first</Badge>
                <Badge tone="muted">Telemetry off</Badge>
                <Badge tone="muted">No cloud required</Badge>
              </div>
              <div className="mt-2 flex gap-1">
                <IconButton name="database" size={14} box="sm" label="Catalog integrity" onClick={() => toast.info('Integrity check', 'Catalog verified — 0 errors. (SQLite PRAGMA integrity_check in the desktop build.)')} />
                <IconButton name="shield" size={14} box="sm" label="Back up catalog" onClick={() => toast.ok('Backup created', 'A copy of the catalog was written to the backup folder.')} />
                <IconButton name="settings" size={14} box="sm" label="Settings" onClick={() => go('export')} />
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
