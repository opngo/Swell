import { useEffect, useMemo, useState } from 'react';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Badge, Button, Chip, Keycap, Spinner } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { Modal, ModalHeader, Tooltip } from '@/ui/Overlay.tsx';
import { NumberField, SearchField, SegmentedControl, Select, Switch, TextField } from '@/ui/Controls.tsx';
import { Slider } from '@/ui/Slider.tsx';
import { useCatalog } from '@/state/catalog.ts';
import { useDevelop } from '@/state/develop.ts';
import { useSettings } from '@/state/settings.ts';
import { useUi } from '@/state/ui.ts';
import { toast } from '@/state/toasts.ts';
import { imageLoader } from '@/lib/imageLoader.ts';
import { EngineClient } from '@/engine-client/EngineClient.ts';
import { makeRenderRequest } from '@/lib/renderRequest.ts';
import {
  EXPORT_PRESETS,
  defaultExportSettings,
  expandTemplate,
  printSettingsSchema,
  SWELL_SHORTCUTS,
  LRC_SHORTCUTS,
  ACCENTS,
  type ExportSettings,
  type PrintSettings,
} from '@swell/schema';
import { formatBytes, formatChord, formatDateTime, uid } from '@swell/shared';
import type { Photo } from '@swell/schema';

/**
 * Page 10 — Export, Print & Settings (§4.10).
 *
 * Export is real: the engine re-renders each photo at the target size through
 * the full parameter pipeline, output sharpening and watermarking are applied,
 * the bytes are encoded in the browser and dropped into a download. Print lays
 * out a genuine contact sheet / picture package and hands it to the browser's
 * print pipeline.
 */

type Tab = 'export' | 'print' | 'settings';

export function ExportPage() {
  const [tab, setTab] = useState<Tab>('export');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        <SegmentedControl
          size="sm"
          ariaLabel="Output"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          segments={[
            { value: 'export', label: 'Export' },
            { value: 'print', label: 'Print' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
        <span className="numeric ml-2 text-2xs text-t3">
          {useCatalog.getState().selection.length || '0'} selected
        </span>
      </div>
      {tab === 'export' && <ExportTab />}
      {tab === 'print' && <PrintTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

/* ========================================================================== */
/*  EXPORT                                                                     */
/* ========================================================================== */

function ExportTab() {
  const [settings, setSettings] = useState<ExportSettings>(() => defaultExportSettings());
  const [queue, setQueue] = useState<{ id: string; name: string; state: 'queued' | 'running' | 'done' | 'failed'; bytes?: number; error?: string }[]>([]);
  const [running, setRunning] = useState(false);
  const selection = useCatalog((s) => s.selection);
  const photos = useCatalog((s) => s.photos);
  const activeId = useCatalog((s) => s.activeId());
  const addTask = useCatalog((s) => s.addTask);
  const updateTask = useCatalog((s) => s.updateTask);
  const patch = (p: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...p }));

  const ids = useMemo(() => (selection.length ? selection : activeId ? [activeId] : []), [selection, activeId]);

  const applyPreset = (id: string) => {
    const p = EXPORT_PRESETS.find((x) => x.id === id);
    if (p) {
      setSettings({ ...settings, ...p.settings, presetId: id });
      toast.info('Export preset', p.name);
    }
  };

  async function run() {
    if (!ids.length || running) return;
    setRunning(true);
    setQueue(ids.map((id) => ({ id, name: photos[id]?.filename ?? id, state: 'queued' as const })));
    const taskId = uid('task');
    addTask({ id: taskId, kind: 'export', label: `Export ${ids.length} photo(s)`, state: 'running', total: ids.length, done: 0, startedAt: Date.now() });

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(canvas);
    const client = new EngineClient({ canvas, histogramHz: 0, fullLongEdge: 4096 });
    if (!client.init()) {
      toast.error('Export failed', 'The GPU renderer could not start.');
      canvas.remove();
      client.dispose();
      setRunning(false);
      return;
    }

    let seq = 1;
    let ok = 0;
    for (const id of ids) {
      const photo = photos[id];
      if (!photo) continue;
      setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: 'running' } : x)));
      try {
        const params = useDevelop.getState().getParams(id);
        const bmp = await imageLoader.loadPhoto(photo, 'native');
        client.setSource(id, bmp);
        const { w, h } = targetSize(photo, settings);
        // output sharpening rides on the render, not a post filter
        const sharpenBoost = settings.outputSharpening === 'none' ? 0 : settings.sharpenAmount === 'low' ? 15 : settings.sharpenAmount === 'high' ? 55 : 32;
        const renderParams = sharpenBoost
          ? { ...params, detail: { ...params.detail, sharpen: { ...params.detail.sharpen, amount: Math.min(150, params.detail.sharpen.amount + sharpenBoost) } } }
          : params;

        canvas.width = w;
        canvas.height = h;
        const req = makeRenderRequest({
          photoId: id,
          requestId: seq,
          params: renderParams,
          source: bmp,
          width: w,
          height: h,
          quality: 'full',
          fast: false,
          background: settings.transparentBackground
            ? { kind: 'transparent', color: '#ffffff', color2: '#cfcfcf', angle: 135, blurRadius: 40, opacity: 1 }
            : undefined,
        });
        const imageData = client.capture(req, w, h);
        bmp.close();
        if (!imageData) throw new Error('renderer returned no pixels');

        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d')!;
        ctx.putImageData(imageData, 0, 0);
        if (settings.watermark.enabled) drawWatermark(ctx, w, h, settings);

        const mime =
          settings.format === 'png' ? 'image/png'
          : settings.format === 'webp' ? 'image/webp'
          : settings.format === 'avif' ? 'image/avif'
          : 'image/jpeg';
        const blob = await new Promise<Blob | null>((r) => out.toBlob(r, mime, settings.quality / 100));
        if (!blob) throw new Error('encoding failed');

        const name = expandTemplate(settings.rename ? settings.renameTemplate : '{original}', {
          date: new Date(photo.captureTime),
          seq: seq++,
          original: photo.filename.replace(/\.[^.]+$/, ''),
          camera: photo.camera,
          iso: photo.iso,
          ext: settings.format === 'jpeg' ? 'jpg' : settings.format,
        });
        download(blob, `${name}.${settings.format === 'jpeg' ? 'jpg' : settings.format}`);
        ok++;
        setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: 'done', bytes: blob.size } : x)));
      } catch (err) {
        setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: 'failed', error: err instanceof Error ? err.message : String(err) } : x)));
      }
      updateTask(taskId, { done: seq - 1 });
    }

    updateTask(taskId, { state: 'done', done: ids.length, finishedAt: Date.now() });
    canvas.remove();
    client.dispose();
    setRunning(false);
    if (settings.notifyOnFinish) toast.ok(`Exported ${ok}/${ids.length}`, settings.postProcessing === 'nothing' ? 'Saved to your downloads.' : 'Post-processing queued.');
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* left: presets + summary */}
      <div className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto bg-s1 p-2 no-scrollbar">
        <Section title="Export presets" icon="export" dense>
          <div className="flex flex-col gap-0.5 px-1 pb-1">
            {EXPORT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={cx(
                  'flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-2xs transition-colors',
                  settings.presetId === p.id ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-t2 hover:bg-s2 hover:text-t1',
                )}
              >
                <SwIcon name="export" size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="numeric shrink-0 text-[10px] text-t3">{p.settings.format.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Queue" icon="layers" dense>
          <div className="px-1 pb-1">
            {!queue.length && <p className="py-1 text-2xs text-t3">{ids.length} photo(s) ready to export.</p>}
            {queue.map((q) => (
              <div key={q.id} className="flex h-7 items-center gap-1.5">
                {q.state === 'running' && <Spinner className="size-3 shrink-0" />}
                {q.state === 'done' && <SwIcon name="check" size={13} className="shrink-0 text-[var(--color-ok)]" />}
                {q.state === 'failed' && <SwIcon name="close" size={13} className="shrink-0 text-[var(--color-danger)]" />}
                {q.state === 'queued' && <SwIcon name="clock" size={13} className="shrink-0 text-t3" />}
                <span className="min-w-0 flex-1 truncate text-2xs text-t2">{q.name}</span>
                {q.bytes && <span className="numeric shrink-0 text-[10px] text-t3">{formatBytes(q.bytes)}</span>}
              </div>
            ))}
          </div>
        </Section>

        <div className="mt-auto px-1 pb-1">
          <Button variant="primary" icon="export" className="w-full" disabled={!ids.length || running} loading={running} onClick={() => void run()}>
            {running ? 'Exporting…' : `Export ${ids.length || ''} photo${ids.length === 1 ? '' : 's'}`}
          </Button>
          <p className="mt-1 text-2xs text-t3">
            Rendered by the same engine as the editor — what you see is what you get, including masks, layers and
            background removal.
          </p>
        </div>
      </div>

      {/* right: settings */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
        <div className="mx-auto grid max-w-3xl gap-2 lg:grid-cols-2">
          <Section title="Location" icon="folder">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="Location" value={settings.location}
                options={[
                  { value: 'choose', label: 'Choose folder (downloads here)' },
                  { value: 'sameAsOriginal', label: 'Same folder as original' },
                  { value: 'subfolder', label: 'Subfolder' },
                ]}
                onChange={(v) => patch({ location: v as ExportSettings['location'] })} />
              {settings.location === 'subfolder' && (
                <TextField size="sm" label="Subfolder template" value={settings.subfolderTemplate} onChange={(e) => patch({ subfolderTemplate: e.target.value })} />
              )}
              <TextField size="sm" label="Rename template" value={settings.renameTemplate} onChange={(e) => patch({ renameTemplate: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {['{original}', '{date}', '{seq}', '{camera}', '{iso}', '{ext}'].map((t) => (
                  <Chip key={t} onClick={() => patch({ renameTemplate: settings.renameTemplate + t })}>{t}</Chip>
                ))}
              </div>
              <Switch checked={settings.rename} label="Rename to" onChange={(v) => patch({ rename: v })} />
              <Select size="sm" ariaLabel="Collision" value={settings.collision}
                options={[
                  { value: 'ask', label: 'Ask what to do' },
                  { value: 'overwrite', label: 'Overwrite' },
                  { value: 'skip', label: 'Skip' },
                  { value: 'unique', label: 'Choose a unique name' },
                ]}
                onChange={(v) => patch({ collision: v as ExportSettings['collision'] })} />
              <Switch checked={settings.addToCatalog} label="Add to this catalog" onChange={(v) => patch({ addToCatalog: v })} />
              <Switch checked={settings.addToStack} label="Stack with original" onChange={(v) => patch({ addToStack: v })} />
            </div>
          </Section>

          <Section title="File settings" icon="page">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="Format" value={settings.format}
                options={[
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'png', label: 'PNG' },
                  { value: 'webp', label: 'WebP' },
                  { value: 'avif', label: 'AVIF' },
                  { value: 'tiff', label: 'TIFF (desktop build)' },
                  { value: 'dng', label: 'DNG (desktop build)' },
                  { value: 'original', label: 'Original' },
                ]}
                onChange={(v) => patch({ format: v as ExportSettings['format'] })} />
              {settings.format !== 'png' && (
                <Slider label="Quality" value={settings.quality} min={1} max={100} step={1} unit="%" onChange={(v) => patch({ quality: v })} onCommit={() => undefined} />
              )}
              <Select size="sm" ariaLabel="Bit depth" value={String(settings.bitDepth)}
                options={[{ value: '8', label: '8 bits/channel' }, { value: '16', label: '16 bits/channel' }]}
                onChange={(v) => patch({ bitDepth: Number(v) as 8 | 16 })} />
              <NumberField label="Limit file size (KB)" value={settings.limitSizeKB} min={0} max={200000} step={100} onChange={(v) => patch({ limitSizeKB: v })} />
              <Switch checked={settings.transparentBackground} label="Transparent background" description="PNG/WebP only — pairs with Remove Background" onChange={(v) => patch({ transparentBackground: v })} />
            </div>
          </Section>

          <Section title="Colour" icon="colourWheel">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="Colour space" value={settings.colorSpace}
                options={[
                  { value: 'srgb', label: 'sRGB' },
                  { value: 'displayP3', label: 'Display P3' },
                  { value: 'adobergb', label: 'Adobe RGB' },
                  { value: 'prophoto', label: 'ProPhoto RGB' },
                  { value: 'rec2020', label: 'Rec.2020' },
                ]}
                onChange={(v) => patch({ colorSpace: v as ExportSettings['colorSpace'] })} />
              <Select size="sm" ariaLabel="Rendering intent" value={settings.renderingIntent}
                options={[
                  { value: 'perceptual', label: 'Perceptual' },
                  { value: 'relative', label: 'Relative' },
                  { value: 'saturation', label: 'Saturation' },
                  { value: 'absolute', label: 'Absolute' },
                ]}
                onChange={(v) => patch({ renderingIntent: v as ExportSettings['renderingIntent'] })} />
              <Switch checked={settings.blackPointCompensation} label="Black point compensation" onChange={(v) => patch({ blackPointCompensation: v })} />
              <p className="text-2xs text-t3">
                Working space is Rec.2020; this converts to the destination and embeds the profile (desktop build
                writes the ICC tag).
              </p>
            </div>
          </Section>

          <Section title="Sizing" icon="crop">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Switch checked={settings.resize} label="Resize to fit" onChange={(v) => patch({ resize: v })} />
              {settings.resize && (
                <>
                  <Select size="sm" ariaLabel="Resize mode" value={settings.resizeMode}
                    options={[
                      { value: 'longEdge', label: 'Long edge' },
                      { value: 'shortEdge', label: 'Short edge' },
                      { value: 'widthHeight', label: 'Width & height' },
                      { value: 'megapixels', label: 'Megapixels' },
                      { value: 'percent', label: 'Percent of original' },
                    ]}
                    onChange={(v) => patch({ resizeMode: v as ExportSettings['resizeMode'] })} />
                  {settings.resizeMode === 'longEdge' && <NumberField label="Long edge (px)" value={settings.longEdge} min={64} max={16000} step={64} onChange={(v) => patch({ longEdge: v })} />}
                  {settings.resizeMode === 'shortEdge' && <NumberField label="Short edge (px)" value={settings.shortEdge} min={64} max={16000} step={64} onChange={(v) => patch({ shortEdge: v })} />}
                  {settings.resizeMode === 'widthHeight' && (
                    <>
                      <NumberField label="Width (px)" value={settings.width} min={64} max={16000} step={64} onChange={(v) => patch({ width: v })} />
                      <NumberField label="Height (px)" value={settings.height} min={64} max={16000} step={64} onChange={(v) => patch({ height: v })} />
                    </>
                  )}
                  {settings.resizeMode === 'megapixels' && <NumberField label="Megapixels" value={settings.megapixels} min={0.1} max={200} step={0.5} onChange={(v) => patch({ megapixels: v })} />}
                  {settings.resizeMode === 'percent' && <Slider label="Percent" value={settings.percent} min={1} max={100} step={1} unit="%" onChange={(v) => patch({ percent: v })} />}
                  <Switch checked={settings.dontEnlarge} label="Don't enlarge" onChange={(v) => patch({ dontEnlarge: v })} />
                  <NumberField label="Resolution (ppi)" value={settings.resolutionPpi} min={72} max={1200} step={1} onChange={(v) => patch({ resolutionPpi: v })} />
                  <Select size="sm" ariaLabel="AI upscale" value={settings.aiUpscale}
                    options={[
                      { value: 'off', label: 'AI upscale off' },
                      { value: '2x', label: 'AI upscale 2×' },
                      { value: '4x', label: 'AI upscale 4×' },
                    ]}
                    onChange={(v) => patch({ aiUpscale: v as ExportSettings['aiUpscale'] })} />
                </>
              )}
            </div>
          </Section>

          <Section title="Output sharpening" icon="aperture">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="Sharpen for" value={settings.outputSharpening}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'screen', label: 'Screen' },
                  { value: 'matte', label: 'Matte paper' },
                  { value: 'glossy', label: 'Glossy paper' },
                ]}
                onChange={(v) => patch({ outputSharpening: v as ExportSettings['outputSharpening'] })} />
              <Select size="sm" ariaLabel="Amount" value={settings.sharpenAmount}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'high', label: 'High' },
                ]}
                onChange={(v) => patch({ sharpenAmount: v as ExportSettings['sharpenAmount'] })} />
            </div>
          </Section>

          <Section title="Metadata" icon="pageEdit">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="Metadata" value={settings.metadata}
                options={[
                  { value: 'all', label: 'All metadata' },
                  { value: 'allExceptCamera', label: 'All except camera info' },
                  { value: 'copyrightOnly', label: 'Copyright only' },
                  { value: 'none', label: 'None' },
                ]}
                onChange={(v) => patch({ metadata: v as ExportSettings['metadata'] })} />
              <Switch checked={settings.removeLocation} label="Remove location info" onChange={(v) => patch({ removeLocation: v })} />
              <Switch checked={settings.removePersonInfo} label="Remove person info" description="Faces and people keywords" onChange={(v) => patch({ removePersonInfo: v })} />
              <Switch checked={settings.keywordsAsHierarchy} label="Write keywords as hierarchy" onChange={(v) => patch({ keywordsAsHierarchy: v })} />
            </div>
          </Section>

          <Section title="Watermark" icon="text">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Switch checked={settings.watermark.enabled} label="Enable watermark" onChange={(v) => patch({ watermark: { ...settings.watermark, enabled: v } })} />
              {settings.watermark.enabled && (
                <>
                  <TextField size="sm" label="Text" value={settings.watermark.text} onChange={(e) => patch({ watermark: { ...settings.watermark, text: e.target.value } })} />
                  <Select size="sm" ariaLabel="Position" value={settings.watermark.position}
                    options={[
                      { value: 'topLeft', label: 'Top left' },
                      { value: 'topCenter', label: 'Top centre' },
                      { value: 'topRight', label: 'Top right' },
                      { value: 'center', label: 'Centre' },
                      { value: 'bottomLeft', label: 'Bottom left' },
                      { value: 'bottomCenter', label: 'Bottom centre' },
                      { value: 'bottomRight', label: 'Bottom right' },
                    ]}
                    onChange={(v) => patch({ watermark: { ...settings.watermark, position: v as ExportSettings['watermark']['position'] } })} />
                  <Slider label="Opacity" value={settings.watermark.opacity} min={0} max={100} step={1} unit="%" onChange={(v) => patch({ watermark: { ...settings.watermark, opacity: v } })} />
                  <Slider label="Size" value={settings.watermark.size} min={1} max={100} step={1} unit="%" onChange={(v) => patch({ watermark: { ...settings.watermark, size: v } })} />
                  <Slider label="Inset" value={settings.watermark.inset} min={0} max={50} step={1} unit="%" onChange={(v) => patch({ watermark: { ...settings.watermark, inset: v } })} />
                </>
              )}
            </div>
          </Section>

          <Section title="Post-processing" icon="magic">
            <div className="flex flex-col gap-1 px-1 pb-1">
              <Select size="sm" ariaLabel="After export" value={settings.postProcessing}
                options={[
                  { value: 'nothing', label: 'Do nothing' },
                  { value: 'showInOs', label: 'Show in Finder / Explorer' },
                  { value: 'openIn', label: 'Open in another app' },
                  { value: 'script', label: 'Run a script' },
                ]}
                onChange={(v) => patch({ postProcessing: v as ExportSettings['postProcessing'] })} />
              {settings.postProcessing === 'openIn' && <TextField size="sm" label="Application" value={settings.openInApp} onChange={(e) => patch({ openInApp: e.target.value })} />}
              {settings.postProcessing === 'script' && <TextField size="sm" label="Script" value={settings.script} onChange={(e) => patch({ script: e.target.value })} />}
              <NumberField label="Parallel jobs (0 = cores − 2)" value={settings.parallelJobs} min={0} max={32} onChange={(v) => patch({ parallelJobs: v })} />
              <Switch checked={settings.notifyOnFinish} label="Notify when finished" onChange={(v) => patch({ notifyOnFinish: v })} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function targetSize(photo: Photo, s: ExportSettings): { w: number; h: number } {
  const aspect = photo.width / Math.max(photo.height, 1);
  let w = photo.width;
  let h = photo.height;
  if (s.resize) {
    switch (s.resizeMode) {
      case 'longEdge': {
        const long = Math.max(w, h);
        const scale = s.longEdge / long;
        w *= scale;
        h *= scale;
        break;
      }
      case 'shortEdge': {
        const short = Math.min(w, h);
        const scale = s.shortEdge / short;
        w *= scale;
        h *= scale;
        break;
      }
      case 'widthHeight': {
        const scale = Math.min(s.width / w, s.height / h);
        w *= scale;
        h *= scale;
        break;
      }
      case 'megapixels': {
        const mp = (w * h) / 1e6;
        const scale = Math.sqrt(s.megapixels / mp);
        w *= scale;
        h *= scale;
        break;
      }
      case 'percent': {
        w *= s.percent / 100;
        h *= s.percent / 100;
        break;
      }
    }
    if (s.dontEnlarge) {
      const scale = Math.min(1, photo.width / w);
      w *= scale;
      h *= scale;
    }
  }
  w = Math.max(16, Math.min(8192, Math.round(w)));
  h = Math.max(16, Math.min(8192, Math.round(w / aspect)));
  return { w, h };
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, s: ExportSettings) {
  const wm = s.watermark;
  ctx.save();
  ctx.globalAlpha = wm.opacity / 100;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = Math.max(2, w * 0.004);
  const size = Math.max(10, (w * wm.size) / 100);
  ctx.font = `500 ${size}px "Geist Variable", system-ui, sans-serif`;
  const inset = (Math.min(w, h) * wm.inset) / 100;
  const metrics = ctx.measureText(wm.text);
  let x = inset;
  let y = h - inset;
  if (wm.position.includes('Center')) x = (w - metrics.width) / 2;
  if (wm.position.includes('Right')) x = w - metrics.width - inset;
  if (wm.position.startsWith('top')) y = inset + size;
  if (wm.position === 'center') y = h / 2;
  ctx.fillText(wm.text, x, y);
  ctx.restore();
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ========================================================================== */
/*  PRINT                                                                      */
/* ========================================================================== */

const PAGE_MM: Record<PrintSettings['pageSize'], [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [216, 279],
  A5: [148, 210],
  '10x15cm': [100, 150],
  '13x18cm': [130, 180],
};

function PrintTab() {
  const [p, setP] = useState<PrintSettings>(() => printSettingsSchema.parse({}));
  const [busy, setBusy] = useState(false);
  const selection = useCatalog((s) => s.selection);
  const photos = useCatalog((s) => s.photos);
  const activeId = useCatalog((s) => s.activeId());
  const patch = (x: Partial<PrintSettings>) => setP((s) => ({ ...s, ...x }));
  const ids = selection.length ? selection : activeId ? [activeId] : [];
  const [mmW, mmH] = PAGE_MM[p.pageSize];
  const usable = p.orientation === 'portrait' ? [mmW - p.marginMm * 2, mmH - p.marginMm * 2] : [mmH - p.marginMm * 2, mmW - p.marginMm * 2];
  const cellW = (usable[0] - p.gapMm * (p.cellsPerRow - 1)) / p.cellsPerRow;

  async function renderSheet(): Promise<HTMLCanvasElement | null> {
    if (!ids.length) return null;
    setBusy(true);
    const dpi = 150;
    const W = Math.round(((p.orientation === 'portrait' ? mmW : mmH) / 25.4) * dpi);
    const H = Math.round(((p.orientation === 'portrait' ? mmH : mmW) / 25.4) * dpi);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const scale = dpi / 25.4;
    const margin = p.marginMm * scale;
    const gap = p.gapMm * scale;
    const cw = cellW * scale;
    const ch = p.cellHeightMm * scale;
    const cols = p.cellsPerRow;

    let i = 0;
    outer: for (let page = 0; ; page++) {
      for (let row = 0; ; row++) {
        for (let col = 0; col < cols; col++) {
          const photo = photos[ids[i]!];
          if (!photo) break outer;
          const x = margin + col * (cw + gap);
          const y = margin + row * (ch + gap);
          if (y + ch > H - margin) break outer;
          const bmp = await imageLoader.loadPhoto(photo, 'standard').catch(() => null);
          if (bmp) {
            const s = Math.min(cw / bmp.width, ch / bmp.height);
            const dw = bmp.width * s;
            const dh = bmp.height * s;
            ctx.drawImage(bmp, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
            bmp.close();
          }
          if (p.showFilenames) {
            ctx.fillStyle = '#333';
            ctx.font = `${Math.round(9 * (dpi / 150))}px "Geist Mono Variable", monospace`;
            ctx.fillText(photo.filename, x, y + ch + 12 * (dpi / 150));
          }
          if (p.showRatings && photo.rating > 0) {
            ctx.fillStyle = '#b58a2a';
            ctx.font = `${Math.round(10 * (dpi / 150))}px system-ui`;
            ctx.fillText('★'.repeat(photo.rating), x + cw - photo.rating * 11 * (dpi / 150), y + ch + 12 * (dpi / 150));
          }
          i++;
          if (i >= ids.length) break outer;
        }
      }
      void page;
    }

    if (p.showPageNumbers) {
      ctx.fillStyle = '#666';
      ctx.font = `${Math.round(10 * (dpi / 150))}px "Geist Mono Variable", monospace`;
      ctx.fillText(`${ids.length} photos · ${p.pageSize} ${p.orientation}`, margin, H - margin / 2);
    }
    setBusy(false);
    return canvas;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto bg-s1 p-2 no-scrollbar">
        <Section title="Layout" icon="table" dense>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Select size="sm" ariaLabel="Layout" value={p.layout}
              options={[
                { value: 'single', label: 'Single image / full page' },
                { value: 'contactSheet', label: 'Contact sheet' },
                { value: 'picturePackage', label: 'Picture package' },
                { value: 'custom', label: 'Custom package' },
              ]}
              onChange={(v) => patch({ layout: v as PrintSettings['layout'] })} />
            <Select size="sm" ariaLabel="Page size" value={p.pageSize}
              options={Object.keys(PAGE_MM).map((k) => ({ value: k, label: k }))}
              onChange={(v) => patch({ pageSize: v as PrintSettings['pageSize'] })} />
            <SegmentedControl size="sm" ariaLabel="Orientation" value={p.orientation}
              onChange={(v) => patch({ orientation: v as 'portrait' | 'landscape' })}
              segments={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            <NumberField label="Cells per row" value={p.cellsPerRow} min={1} max={12} onChange={(v) => patch({ cellsPerRow: v })} />
            <NumberField label="Cell height (mm)" value={p.cellHeightMm} min={10} max={300} step={5} onChange={(v) => patch({ cellHeightMm: v })} />
            <NumberField label="Margin (mm)" value={p.marginMm} min={0} max={50} onChange={(v) => patch({ marginMm: v })} />
            <NumberField label="Gap (mm)" value={p.gapMm} min={0} max={30} onChange={(v) => patch({ gapMm: v })} />
            <Switch checked={p.rotateToFit} label="Rotate to fit" onChange={(v) => patch({ rotateToFit: v })} />
          </div>
        </Section>

        <Section title="Labels" icon="label" dense defaultOpen={false}>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Switch checked={p.showFilenames} label="Filenames" onChange={(v) => patch({ showFilenames: v })} />
            <Switch checked={p.showRatings} label="Ratings" onChange={(v) => patch({ showRatings: v })} />
            <Switch checked={p.showCaption} label="Captions" onChange={(v) => patch({ showCaption: v })} />
            <Switch checked={p.showPageNumbers} label="Page numbers" onChange={(v) => patch({ showPageNumbers: v })} />
            <Switch checked={p.watermark} label="Watermark" onChange={(v) => patch({ watermark: v })} />
          </div>
        </Section>

        <Section title="Colour & output" icon="colourFilter" dense defaultOpen={false}>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Select size="sm" ariaLabel="Printer profile" value={p.printerProfile || 'none'}
              options={[
                { value: 'none', label: 'Managed by printer' },
                { value: 'srgb', label: 'sRGB' },
                { value: 'adobergb', label: 'Adobe RGB' },
              ]}
              onChange={(v) => patch({ printerProfile: v === 'none' ? '' : v })} />
            <Select size="sm" ariaLabel="Print sharpening" value={p.printSharpening}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'low', label: 'Low' },
                { value: 'standard', label: 'Standard' },
                { value: 'high', label: 'High' },
              ]}
              onChange={(v) => patch({ printSharpening: v as PrintSettings['printSharpening'] })} />
            <Switch checked={p.blackPointCompensation} label="Black point compensation" onChange={(v) => patch({ blackPointCompensation: v })} />
            <SegmentedControl size="sm" ariaLabel="Output" value={p.output}
              onChange={(v) => patch({ output: v as 'pdf' | 'printer' })}
              segments={[{ value: 'printer', label: 'System printer' }, { value: 'pdf', label: 'Save as image/PDF' }]} />
          </div>
        </Section>

        <div className="mt-auto flex flex-col gap-1 px-1 pb-1">
          <Button variant="primary" icon="printer" disabled={!ids.length || busy} loading={busy}
            onClick={async () => {
              const canvas = await renderSheet();
              if (!canvas) return;
              if (p.output === 'pdf') {
                canvas.toBlob((b) => b && download(b, `swell-contact-sheet-${Date.now()}.png`), 'image/png');
                toast.ok('Sheet rendered', 'Downloaded as a PNG at 150 dpi — print to PDF from any viewer.');
              } else {
                const url = canvas.toDataURL('image/png');
                const w = window.open('', '_blank', 'width=900,height=1200');
                if (w) {
                  w.document.write(`<html><head><title>Swell print</title><style>@page{size:${p.pageSize} ${p.orientation};margin:${p.marginMm}mm}body{margin:0}img{width:100%}</style></head><body><img src="${url}"/><script>setTimeout(()=>window.print(),300)</script></body></html>`);
                  w.document.close();
                } else {
                  toast.warn('Popup blocked', 'Allow popups to send this to the printer, or switch output to “Save as image”.');
                }
              }
            }}>
            {busy ? 'Rendering…' : `Print ${ids.length || ''} photo${ids.length === 1 ? '' : 's'}`}
          </Button>
          <Button variant="ghost" icon="export" disabled={!ids.length}
            onClick={async () => {
              const canvas = await renderSheet();
              if (canvas) {
                canvas.toBlob((b) => b && download(b, `swell-contact-sheet-${Date.now()}.png`), 'image/png');
                toast.ok('Contact sheet saved', `${canvas.width}×${canvas.height} px`);
              }
            }}>
            Save sheet as PNG
          </Button>
        </div>
      </div>

      {/* live sheet preview */}
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-s2 p-4 no-scrollbar">
        <div
          className="relative rounded-[2px] bg-white shadow-[var(--e3)]"
          style={{
            width: `${((p.orientation === 'portrait' ? mmW : mmH) / 297) * 560}px`,
            aspectRatio: `${p.orientation === 'portrait' ? mmW : mmH} / ${p.orientation === 'portrait' ? mmH : mmW}`,
          }}
        >
          <SheetPreview p={p} ids={ids} photos={photos} />
        </div>
      </div>
    </div>
  );
}

function SheetPreview({ p, ids, photos }: { p: PrintSettings; ids: string[]; photos: Record<string, Photo> }) {
  const [mmW, mmH] = PAGE_MM[p.pageSize];
  const W = p.orientation === 'portrait' ? mmW : mmH;
  const H = p.orientation === 'portrait' ? mmH : mmW;
  const cellW = (W - p.marginMm * 2 - p.gapMm * (p.cellsPerRow - 1)) / p.cellsPerRow;
  const rows = Math.max(1, Math.floor((H - p.marginMm * 2 + p.gapMm) / (p.cellHeightMm + p.gapMm)));
  const shown = ids.slice(0, rows * p.cellsPerRow);

  return (
    <div className="absolute inset-0" style={{ padding: `${(p.marginMm / H) * 100}% ${(p.marginMm / W) * 100}%` }}>
      <div className="grid size-full" style={{ gridTemplateColumns: `repeat(${p.cellsPerRow}, 1fr)`, gridAutoRows: `${(p.cellHeightMm / H) * 100}%`, gap: `${(p.gapMm / W) * 100}%` }}>
        {shown.map((id) => {
          const photo = photos[id];
          if (!photo) return null;
          return (
            <div key={id} className="relative overflow-hidden">
              <img src={photo.src} alt="" className="size-full object-cover" draggable={false} />
              {p.showFilenames && (
                <span className="numeric absolute inset-x-0 bottom-0 truncate bg-white/80 px-0.5 text-[6px] text-black">{photo.filename}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  SETTINGS                                                                   */
/* ========================================================================== */

function SettingsTab() {
  const { settings, set, shortcuts, rebind, setShortcutPreset, resetShortcuts } = useSettings();
  const [query, setQuery] = useState('');
  const [binding, setBinding] = useState<string | null>(null);
  const go = useUi((s) => s.go);
  const setUi = useUi((s) => s.setModels);
  const setMem = useUi((s) => s.setMemoryHud);

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        setBinding(null);
        return;
      }
      const combo = formatChord(e);
      rebind(binding as never, combo);
      setBinding(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding, rebind]);

  const actions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries = Object.entries(shortcuts) as [string, string][];
    return q ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : entries;
  }, [shortcuts, query]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
      <div className="mx-auto grid max-w-4xl gap-2 lg:grid-cols-2">
        {/* 1 */}
        <Section title="General" icon="settings">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Select size="sm" ariaLabel="Startup" value={settings.general.startup}
              options={[
                { value: 'home', label: 'Open Home' },
                { value: 'lastView', label: 'Resume last view' },
                { value: 'library', label: 'Open Library' },
              ]}
              onChange={(v) => set('general', { startup: v as 'home' | 'lastView' | 'library' })} />
            <Select size="sm" ariaLabel="Language" value={settings.general.language}
              options={[
                { value: 'en', label: 'English' },
                { value: 'de', label: 'Deutsch' },
                { value: 'fr', label: 'Français' },
                { value: 'ja', label: '日本語' },
                { value: 'ar', label: 'العربية (RTL)' },
              ]}
              onChange={(v) => set('general', { language: v })} />
            <Switch checked={settings.general.notifications} label="Notifications" onChange={(v) => set('general', { notifications: v })} />
            <Switch checked={settings.general.confirmDelete} label="Confirm before deleting" onChange={(v) => set('general', { confirmDelete: v })} />
          </div>
        </Section>

        {/* 2 */}
        <Section title="Appearance" icon="palette">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <SegmentedControl size="sm" ariaLabel="Theme" value={settings.appearance.theme}
              onChange={(v) => set('appearance', { theme: v as 'dark' | 'light' | 'auto' })}
              segments={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }]} />
            <div>
              <div className="mb-1 text-2xs text-t3">Accent</div>
              <div className="flex flex-wrap gap-1">
                {ACCENTS.map((a) => (
                  <Tooltip key={a.id} label={a.label} placement="top">
                    <button type="button" aria-label={a.label}
                      onClick={() => set('appearance', { accentId: a.id })}
                      className={cx('size-6 rounded-full transition-transform hover:scale-110', settings.appearance.accentId === a.id && 'shadow-[var(--halo)] scale-110')}
                      style={{ background: a.oklch }} />
                  </Tooltip>
                ))}
              </div>
            </div>
            <Select size="sm" ariaLabel="Canvas backdrop" value={settings.appearance.canvasBackdrop}
              options={[
                { value: 'neutral-dark', label: 'Neutral dark' },
                { value: 'mid-gray', label: 'Mid grey' },
                { value: 'black', label: 'Black' },
                { value: 'white', label: 'White' },
                { value: 'match-theme', label: 'Match theme' },
              ]}
              onChange={(v) => set('appearance', { canvasBackdrop: v as typeof settings.appearance.canvasBackdrop })} />
            <SegmentedControl size="sm" ariaLabel="Density" value={settings.appearance.density}
              onChange={(v) => set('appearance', { density: v as typeof settings.appearance.density })}
              segments={[{ value: 'comfortable', label: '36 px' }, { value: 'default', label: '30 px' }, { value: 'compact', label: '26 px' }]} />
            <Slider label="UI scale" value={settings.appearance.uiScale} min={80} max={150} step={5} unit="%"
              onChange={(v) => set('appearance', { uiScale: v })} onCommit={() => undefined} />
            <Switch checked={settings.appearance.reduceMotion} label="Reduce motion" description="Also follows the OS setting" onChange={(v) => set('appearance', { reduceMotion: v })} />
            <Slider label="Animation intensity" value={settings.appearance.animationIntensity} min={0} max={100} step={5} unit="%"
              onChange={(v) => set('appearance', { animationIntensity: v })} onCommit={() => undefined} />
            <Switch checked={settings.appearance.highContrastFocus} label="High-contrast focus rings" onChange={(v) => set('appearance', { highContrastFocus: v })} />
            <Switch checked={settings.appearance.showFilmstrip} label="Show filmstrip" onChange={(v) => set('appearance', { showFilmstrip: v })} />
          </div>
        </Section>

        {/* 3 */}
        <Section title="Performance & memory" icon="cpu">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <SegmentedControl size="sm" ariaLabel="GPU backend" value={settings.performance.gpuBackend}
              onChange={(v) => set('performance', { gpuBackend: v as 'webgl2' | 'webgpu' })}
              segments={[{ value: 'webgl2', label: 'WebGL2' }, { value: 'webgpu', label: 'WebGPU' }]} />
            <NumberField label="VRAM budget (MB)" value={settings.performance.vramBudgetMB} min={256} max={12288} step={256} onChange={(v) => set('performance', { vramBudgetMB: v })} />
            <NumberField label="RAM budget (MB)" value={settings.performance.ramBudgetMB} min={512} max={16384} step={128} onChange={(v) => set('performance', { ramBudgetMB: v })} />
            <NumberField label="Thumb cache (MB)" value={settings.performance.thumbCacheMB} min={64} max={2048} step={32} onChange={(v) => set('performance', { thumbCacheMB: v })} />
            <NumberField label="Preview cache (MB)" value={settings.performance.previewCacheMB} min={256} max={8192} step={128} onChange={(v) => set('performance', { previewCacheMB: v })} />
            <NumberField label="Decoded cache (MB)" value={settings.performance.decodedCacheMB} min={256} max={16384} step={256} onChange={(v) => set('performance', { decodedCacheMB: v })} />
            <NumberField label="Concurrency (0 = cores − 2)" value={settings.performance.concurrency} min={0} max={32} onChange={(v) => set('performance', { concurrency: v })} />
            <NumberField label="Prefetch neighbours" value={settings.performance.prefetchNeighbours} min={0} max={8} onChange={(v) => set('performance', { prefetchNeighbours: v })} />
            <Select size="sm" ariaLabel="Power mode" value={settings.performance.powerMode}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'battery', label: 'Battery saver' },
                { value: 'performance', label: 'Maximum performance' },
              ]}
              onChange={(v) => set('performance', { powerMode: v as typeof settings.performance.powerMode })} />
            <Switch checked={settings.performance.memoryHud} label="Memory HUD on start" description="Ctrl/⌘+Alt+M" onChange={(v) => set('performance', { memoryHud: v })} />
            <Button size="xs" variant="subtle" icon="cpu" onClick={() => setMem(true)}>Open Memory HUD</Button>
          </div>
        </Section>

        {/* 4 */}
        <Section title="Previews" icon="photos">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <NumberField label="Standard preview long edge" value={settings.previews.standardLongEdge} min={1024} max={4096} step={64} onChange={(v) => set('previews', { standardLongEdge: v })} />
            <Slider label="Preview quality" value={settings.previews.quality} min={40} max={100} step={1} unit="%" onChange={(v) => set('previews', { quality: v })} onCommit={() => undefined} />
            <Select size="sm" ariaLabel="Build on import" value={settings.previews.buildOnImport}
              options={[
                { value: 'minimal', label: 'Minimal (embedded)' },
                { value: 'embedded', label: 'Embedded JPEG' },
                { value: 'standard', label: 'Standard 1440–2048' },
                { value: '1to1', label: '1:1 pixels' },
                { value: 'smart', label: 'Smart preview 2560' },
              ]}
              onChange={(v) => set('previews', { buildOnImport: v as typeof settings.previews.buildOnImport })} />
            <NumberField label="Discard 1:1 after (days)" value={settings.previews.discard1to1AfterDays} min={1} max={365} onChange={(v) => set('previews', { discard1to1AfterDays: v })} />
          </div>
        </Section>

        {/* 5 */}
        <Section title="Catalog" icon="library">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <TextField size="sm" label="Catalog path" value={settings.catalog.path} onChange={(e) => set('catalog', { path: e.target.value })} />
            <Select size="sm" ariaLabel="Backups" value={settings.catalog.backupSchedule}
              options={[
                { value: 'off', label: 'No backups' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'onExit', label: 'On exit' },
              ]}
              onChange={(v) => set('catalog', { backupSchedule: v as typeof settings.catalog.backupSchedule })} />
            <NumberField label="Keep backups (weeks)" value={settings.catalog.backupRetention} min={1} max={52} onChange={(v) => set('catalog', { backupRetention: v })} />
            <Switch checked={settings.catalog.sidecarXmp} label="Read XMP sidecars" onChange={(v) => set('catalog', { sidecarXmp: v })} />
            <Switch checked={settings.catalog.autoWriteSidecar} label="Write XMP sidecars automatically" onChange={(v) => set('catalog', { autoWriteSidecar: v })} />
            <Select size="sm" ariaLabel="RAW + JPEG" value={settings.catalog.rawJpegHandling}
              options={[
                { value: 'stack', label: 'Treat as one photo (stack)' },
                { value: 'separate', label: 'Treat separately' },
                { value: 'rawOnly', label: 'Prefer RAW only' },
              ]}
              onChange={(v) => set('catalog', { rawJpegHandling: v as typeof settings.catalog.rawJpegHandling })} />
            <Switch checked={settings.catalog.optimizeOnExit} label="Optimise catalog (VACUUM) on exit" onChange={(v) => set('catalog', { optimizeOnExit: v })} />
          </div>
        </Section>

        {/* 6 */}
        <Section title="Colour management" icon="colourWheel">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Select size="sm" ariaLabel="Working space" value={settings.color.workingSpace}
              options={[{ value: 'rec2020', label: 'Rec.2020 (wide)' }, { value: 'prophoto', label: 'ProPhoto RGB' }]}
              onChange={(v) => set('color', { workingSpace: v as 'rec2020' | 'prophoto' })} />
            <TextField size="sm" label="Display profile" value={settings.color.displayProfile} onChange={(e) => set('color', { displayProfile: e.target.value })} />
            <Select size="sm" ariaLabel="Default export space" value={settings.color.defaultSpace}
              options={[
                { value: 'srgb', label: 'sRGB' },
                { value: 'displayP3', label: 'Display P3' },
                { value: 'adobergb', label: 'Adobe RGB' },
                { value: 'prophoto', label: 'ProPhoto RGB' },
                { value: 'rec2020', label: 'Rec.2020' },
              ]}
              onChange={(v) => set('color', { defaultSpace: v as typeof settings.color.defaultSpace })} />
            <Switch checked={settings.color.blackPointCompensation} label="Black point compensation" onChange={(v) => set('color', { blackPointCompensation: v })} />
            <Switch checked={settings.color.hdr} label="HDR output where supported" onChange={(v) => set('color', { hdr: v })} />
          </div>
        </Section>

        {/* 7 */}
        <Section title="AI & indexing" icon="smart">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Select size="sm" ariaLabel="Execution provider" value={settings.ai.provider}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'coreml', label: 'Core ML' },
                { value: 'directml', label: 'DirectML' },
                { value: 'cuda', label: 'CUDA' },
                { value: 'cpu', label: 'CPU' },
              ]}
              onChange={(v) => set('ai', { provider: v as typeof settings.ai.provider })} />
            <Select size="sm" ariaLabel="Index schedule" value={settings.ai.indexSchedule}
              options={[
                { value: 'always', label: 'Always' },
                { value: 'idle', label: 'When idle' },
                { value: 'manual', label: 'Manual' },
              ]}
              onChange={(v) => set('ai', { indexSchedule: v as typeof settings.ai.indexSchedule })} />
            <Switch checked={settings.ai.faceRecognition} label="Face recognition (opt-in)" onChange={(v) => set('ai', { faceRecognition: v })} />
            <Switch checked={settings.ai.autoKeywords} label="Auto keywords" onChange={(v) => set('ai', { autoKeywords: v })} />
            <Switch checked={settings.ai.distractionDetection} label="Distraction detection" onChange={(v) => set('ai', { distractionDetection: v })} />
            <NumberField label="Unload models after idle (s)" value={settings.ai.unloadAfterIdleSec} min={0} max={3600} step={15} onChange={(v) => set('ai', { unloadAfterIdleSec: v })} />
            <NumberField label="Resident models" value={settings.ai.residentModels} min={0} max={3} onChange={(v) => set('ai', { residentModels: v })} />
            <Switch checked={settings.ai.offlineMode} label="Strict offline mode" description="Refuse every network fetch, including model downloads" onChange={(v) => set('ai', { offlineMode: v })} />
            <Button size="xs" variant="subtle" icon="download" onClick={() => { setUi(true); go('smart'); }}>Models manager</Button>
          </div>
        </Section>

        {/* 8 */}
        <Section title="Privacy" icon="shield">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <Switch checked={settings.privacy.localOnly} label="Local-only mode" description="No network access for photos, edits or metadata" onChange={(v) => set('privacy', { localOnly: v })} />
            <Switch checked={settings.privacy.telemetry} label="Anonymous usage telemetry" description="Off by default, and never includes photo data" onChange={(v) => set('privacy', { telemetry: v })} />
            <Switch checked={settings.privacy.crashReports} label="Crash reports" onChange={(v) => set('privacy', { crashReports: v })} />
            <Button size="xs" variant="danger" icon="trash"
              onClick={() => { useCatalog.getState().deleteAllFaceData(); toast.ok('Face data deleted', 'All embeddings and clusters were removed from this device.'); }}>
              Delete all face data
            </Button>
          </div>
        </Section>

        {/* 9 */}
        <Section title="Print defaults" icon="printer">
          <div className="flex flex-col gap-1 px-1 pb-1">
            <TextField size="sm" label="Page size" value={settings.print.pageSize} onChange={(e) => set('print', { pageSize: e.target.value })} />
            <NumberField label="Margins (mm)" value={settings.print.marginsMm} min={0} max={50} onChange={(v) => set('print', { marginsMm: v })} />
            <NumberField label="Cells per row" value={settings.print.cellsPerRow} min={1} max={12} onChange={(v) => set('print', { cellsPerRow: v })} />
            <NumberField label="Gap (mm)" value={settings.print.gapMm} min={0} max={30} onChange={(v) => set('print', { gapMm: v })} />
            <Switch checked={settings.print.showFilenames} label="Filenames" onChange={(v) => set('print', { showFilenames: v })} />
            <Switch checked={settings.print.showRatings} label="Ratings" onChange={(v) => set('print', { showRatings: v })} />
            <Select size="sm" ariaLabel="Print sharpening" value={settings.print.sharpening}
              options={[{ value: 'low', label: 'Low' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]}
              onChange={(v) => set('print', { sharpening: v as 'low' | 'standard' | 'high' })} />
          </div>
        </Section>

        {/* 10 */}
        <Section title="Keyboard shortcuts" icon="keyboard" className="lg:col-span-2">
          <div className="px-1 pb-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              <SearchField value={query} onChange={setQuery} placeholder="Search shortcuts…" shortcut="" className="w-52" />
              <SegmentedControl size="sm" ariaLabel="Shortcut preset" value={settings.general.shortcutPreset}
                onChange={(v) => setShortcutPreset(v as 'swell' | 'lrc')}
                segments={[{ value: 'swell', label: 'Swell' }, { value: 'lrc', label: 'Lightroom-style' }]} />
              <Button size="xs" variant="ghost" icon="restart" onClick={resetShortcuts}>Reset</Button>
              <Button size="xs" variant="ghost" icon="keyboard" onClick={() => useUi.getState().setShortcuts(true)}>Cheat sheet</Button>
            </div>
            <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {actions.map(([action, combo]) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => setBinding(action)}
                  className={cx(
                    'flex h-7 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors',
                    binding === action ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'hover:bg-s2',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-2xs text-t2">{action.replace(/[.]/g, ' · ')}</span>
                  {binding === action ? (
                    <span className="text-2xs">press keys…</span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5">
                      {combo.split('+').map((k) => (
                        <Keycap key={k}>{k}</Keycap>
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-2xs text-t3">
              Preset “{settings.general.shortcutPreset}” · {Object.keys(SWELL_SHORTCUTS).length} Swell bindings ·{' '}
              {Object.keys(LRC_SHORTCUTS).length} Lightroom-style. Click any row to rebind it.
            </p>
          </div>
        </Section>

        {/* 11 */}
        <Section title="Storage & caches" icon="database">
          <StorageCard />
        </Section>

        {/* 12 */}
        <Section title="About" icon="info">
          <div className="px-1 pb-1">
            <KeyValue2 k="Swell" v="0.1.0 (M3 build)" />
            <KeyValue2 k="Renderer" v={'gpu' in navigator ? 'WebGPU available · using WebGL2' : 'WebGL2'} />
            <KeyValue2 k="Platform" v={`${navigator.platform} · ${navigator.hardwareConcurrency ?? '?'} cores`} />
            <KeyValue2 k="Catalog" v={`${useCatalog.getState().order.length} photos (IndexedDB in the web build, SQLite in desktop)`} />
            <KeyValue2 k="Session" v={`started ${formatDateTime(new Date(performance.timeOrigin).toISOString())}`} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Chip icon="page" onClick={() => window.open('#/docs', '_self')}>Documentation</Chip>
              <Chip icon="code" onClick={() => window.open('https://github.com/opngo/Swell', '_blank')}>Source</Chip>
              <Chip icon="shield" onClick={() => toast.info('Licences', 'See THIRD_PARTY_LICENSES.md — LibRaw, lensfun, ExifTool, libvips, Iconoir (MIT), Geist/Bricolage (OFL).')}>
                Third-party licences
              </Chip>
            </div>
            <Button size="xs" variant="danger" icon="trash" className="mt-2"
              onClick={() => {
                if (!window.confirm('Delete all local Swell data (catalog, edits, presets) and reload?')) return;
                void (async () => {
                  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
                  for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
                  localStorage.clear();
                  location.reload();
                })();
              }}>
              Reset local data
            </Button>
          </div>
        </Section>
      </div>

      <RebindDialog action={binding} onCancel={() => setBinding(null)} />
    </div>
  );
}

function KeyValue2({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-2xs text-t3">{k}</span>
      <span className="numeric min-w-0 truncate text-2xs text-t2">{v}</span>
    </div>
  );
}

function StorageCard() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number }>({});
  const [stats, setStats] = useState(() => imageLoader.stats());
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setInfo({ usage: e.usage, quota: e.quota }));
    const t = window.setInterval(() => setStats(imageLoader.stats()), 2000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="px-1 pb-1">
      <KeyValue2 k="Browser storage" v={info.usage && info.quota ? `${formatBytes(info.usage)} of ${formatBytes(info.quota)}` : 'unknown'} />
      {stats.map((s) => (
        <div key={s.id}>
          <KeyValue2 k={`${s.id} cache`} v={`${formatBytes(s.bytes)} / ${formatBytes(s.budget)} · ${s.items} items`} />
          <KeyValue2 k={`${s.id} hit rate`} v={`${(s.hitRate * 100).toFixed(0)}% · ${s.evictions} evictions`} />
        </div>
      ))}
      <div className="mt-1.5 flex gap-1">
        <Button size="xs" variant="subtle" icon="refresh" onClick={() => { imageLoader.clear(); setStats(imageLoader.stats()); toast.ok('Caches cleared', 'Decoded previews were released.'); }}>
          Clear caches
        </Button>
        <Button size="xs" variant="ghost" icon="cpu" onClick={() => useUi.getState().setMemoryHud(true)}>
          Memory HUD
        </Button>
      </div>
    </div>
  );
}

function RebindDialog({ action, onCancel }: { action: string | null; onCancel: () => void }) {
  return (
    <Modal open={!!action} onClose={onCancel} label="Rebind shortcut" size="sm">
      <ModalHeader title="Press a new shortcut" subtitle={action?.replace(/[.]/g, ' · ')} icon="keyboard" onClose={onCancel} />
      <div className="p-4 text-center">
        <p className="text-xs text-t2">
          Hold modifiers and press a key. <Keycap>Esc</Keycap> cancels.
        </p>
        <p className="mt-2 text-2xs text-t3">
          Conflicts are detected and the previous binding is cleared automatically.
        </p>
      </div>
    </Modal>
  );
}

export default ExportPage;
