/**
 * ModelsDialog — the models manager (§8.6).
 *
 * Models are opt-in, downloaded on demand, verified against a published
 * SHA-256 and unloaded after idle time. This dialog is the honest surface for
 * all of that: size on disk, resident cost, licence of the *weights*, and why
 * a download is refused when no checksum exists.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '@/ui/cx.ts';
import { SwIcon, type IconName } from '@/ui/icons.tsx';
import { Badge, Button, Chip, IconButton, Spinner } from '@/ui/Button.tsx';
import { Modal, ModalHeader, Tooltip } from '@/ui/Overlay.tsx';
import { SearchField, SegmentedControl, Switch } from '@/ui/Controls.tsx';
import { useUi } from '@/state/ui.ts';
import { useSettings } from '@/state/settings.ts';
import { useCatalog } from '@/state/catalog.ts';
import { registry } from '@/lib/modelRegistry.ts';
import { analysisClient } from '@/lib/analysisClient.ts';
import { toast } from '@/state/toasts.ts';
import type { ModelTask } from '@swell/models';

/** Every task in the union gets a glyph — the map is exhaustively typed. */
const TASK_ICON: Record<ModelTask, IconName> = {
  segmentation: 'smart',
  matting: 'mask',
  detection: 'scan',
  embedding: 'smart',
  faces: 'face',
  inpainting: 'magic',
  depth: 'layers',
  sky: 'cloud',
  denoise: 'grain',
  upscale: 'zoomIn',
  ocr: 'text',
};

const STATE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'> = {
  ready: 'ok',
  downloading: 'accent',
  verifying: 'accent',
  'not-downloaded': 'muted',
  failed: 'danger',
  'unsupported-here': 'warn',
  'checksum-missing': 'warn',
};

export function ModelsDialog() {
  const open = useUi((s) => s.modelsOpen);
  const setOpen = useUi((s) => s.setModels);
  const ai = useSettings((s) => s.settings.ai);
  const setAi = useSettings((s) => s.set);
  const [query, setQuery] = useState('');
  const [task, setTask] = useState<'all' | ModelTask>('all');
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const models = useMemo(() => registry.list(), [tick, open]);
  const tasks = useMemo(() => [...new Set(models.map((m) => m.task))] as ModelTask[], [models]);

  const list = models.filter(
    (m) =>
      (task === 'all' || m.task === task) &&
      (!query.trim() ||
        `${m.name} ${m.task} ${m.licence} ${m.notes}`.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const totalMB = models.reduce((a, m) => a + m.sizeMB, 0);
  const readyMB = models.filter((m) => m.status.state === 'ready').reduce((a, m) => a + m.sizeMB, 0);

  const download = async (id: string) => {
    setBusy(id);
    setTick((t) => t + 1);
    try {
      await registry.download(id, () => setTick((t) => t + 1));
      toast.ok('Model ready', `${id} verified and stored on this device.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.warn('Download refused or failed', msg);
    } finally {
      setBusy(null);
      setTick((t) => t + 1);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Modal open={open} onClose={() => setOpen(false)} label="Models manager" size="xl">
          <ModalHeader
            title="Models"
            subtitle={`${models.length} manifests · ${readyMB} MB of ${totalMB} MB on disk · nothing is bundled`}
            icon="download"
            onClose={() => setOpen(false)}
          />

          <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
            <SearchField value={query} onChange={setQuery} placeholder="Search models…" shortcut="" className="w-56" />
            <SegmentedControl
              size="sm"
              ariaLabel="Execution provider"
              value={ai.provider}
              onChange={(v) => setAi('ai', { provider: v as typeof ai.provider })}
              segments={[
                { value: 'auto', label: 'Auto' },
                { value: 'coreml', label: 'Core ML' },
                { value: 'directml', label: 'DirectML' },
                { value: 'cuda', label: 'CUDA' },
                { value: 'cpu', label: 'CPU' },
              ]}
            />
            <span className="ml-auto flex items-center gap-1">
              <Button size="xs" variant="ghost" icon="refresh" onClick={() => setTick((t) => t + 1)}>
                Refresh
              </Button>
              <Button
                size="xs"
                variant="subtle"
                icon="smart"
                onClick={async () => {
                  setOpen(false);
                  const photos = Object.values(useCatalog.getState().photos);
                  toast.info('Re-indexing', `${photos.length} photos queued on-device.`);
                  await analysisClient.reindexAll(photos);
                  toast.ok('Index complete', 'Detections and concept scores refreshed.');
                }}
              >
                Re-index catalog
              </Button>
            </span>
          </div>

          <div className="flex flex-wrap gap-1 px-4 pb-2">
            <Chip active={task === 'all'} onClick={() => setTask('all')}>All</Chip>
            {tasks.map((t) => (
              <Chip key={t} active={task === t} onClick={() => setTask(t)}>{t}</Chip>
            ))}
          </div>

          <div className="flex items-center gap-3 px-4 pb-2">
            <Switch checked={!ai.offlineMode} label="Allow downloads" description="Off = strict offline mode; nothing is ever fetched" onChange={(v) => setAi('ai', { offlineMode: !v })} />
            <Switch checked={ai.faceRecognition} label="Face recognition (opt-in)" description="Required before any face model can run" onChange={(v) => setAi('ai', { faceRecognition: v })} />
          </div>

          <div className="max-h-[56vh] overflow-y-auto px-3 pb-4 no-scrollbar">
            {list.map((m) => {
              const st = m.status;
              const canDownload = !ai.offlineMode && !!m.sha256 && (!m.requiresOptIn || ai.faceRecognition);
              return (
                <motion.div
                  key={m.id}
                  layout
                  className={cx(
                    'mb-1.5 rounded-[var(--radius-lg)] bg-s2 p-2.5 transition-colors',
                    st.state === 'ready' && 'bg-s3',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-s4 text-t2">
                      <SwIcon name={TASK_ICON[m.task] ?? 'smart'} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-t1">{m.name}</span>
                        <Badge tone={STATE_TONE[st.state] ?? 'muted'}>{st.state.replace(/-/g, ' ')}</Badge>
                        {m.requiresOptIn && <Badge tone="warn">opt-in</Badge>}
                        {!m.sha256 && (
                          <Tooltip label="No published checksum — installation is disabled so an unverified blob can never run" placement="top">
                            <span><Badge tone="danger">no checksum</Badge></span>
                          </Tooltip>
                        )}
                      </div>
                      <div className="numeric mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-t3">
                        <span>{m.task}</span>
                        <span>v{m.version}</span>
                        <span>{m.sizeMB} MB</span>
                        <span>{m.residentMB} MB resident</span>
                        <span>{m.benchmark.gpu} ms GPU / {m.benchmark.cpu} ms CPU</span>
                        <span className="text-t2">{m.providers.join(' · ')}</span>
                      </div>
                      <p className="mt-1 text-2xs leading-snug text-t3">{m.notes}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-t3">weights licence</span>
                        <Badge tone={/mit|apache|bsd|ofl|cc-by-4|unlicense/i.test(m.licence) ? 'ok' : /non-?commercial|nc|research/i.test(m.licence) ? 'warn' : 'danger'}>
                          {m.licence}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {st.state === 'ready' ? (
                        <>
                          <Badge tone="ok">{st.resident ? 'resident' : 'on disk'}</Badge>
                          <span className="flex gap-0.5">
                            {st.resident && (
                              <IconButton name="close" size={13} box="sm" label="Unload from memory"
                                onClick={async () => { await registry.release(m.id); setTick((t) => t + 1); toast.info('Model unloaded', m.name); }} />
                            )}
                            <IconButton name="trash" size={13} box="sm" label="Delete from disk"
                              onClick={async () => { await registry.remove(m.id); setTick((t) => t + 1); toast.ok('Model deleted', `${m.sizeMB} MB freed.`); }} />
                          </span>
                        </>
                      ) : st.state === 'downloading' || st.state === 'verifying' ? (
                        <span className="flex items-center gap-1.5 text-2xs text-t3">
                          <Spinner className="size-3" />
                          {st.state}
                        </span>
                      ) : (
                        <Tooltip
                          label={
                            ai.offlineMode
                              ? 'Strict offline mode is on'
                              : !m.sha256
                                ? 'Refused: no published SHA-256 for these weights'
                                : m.requiresOptIn && !ai.faceRecognition
                                  ? 'Enable face recognition first (opt-in feature)'
                                  : 'Download and verify on this device'
                          }
                          placement="left"
                        >
                          <span>
                            <Button size="xs" variant={canDownload ? 'primary' : 'ghost'} icon="download" disabled={!canDownload || busy === m.id}
                              onClick={() => void download(m.id)}>
                              {busy === m.id ? 'Working…' : 'Get model'}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {(st.state === 'downloading' || st.state === 'verifying') && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-s3">
                      <motion.div className="h-full rounded-full bg-[var(--color-accent)]" animate={{ width: `${Math.round(st.progress * 100)}%` }} transition={{ type: 'spring', stiffness: 180, damping: 22 }} />
                    </div>
                  )}
                  {st.error && <p className="mt-1 text-[10px] text-[var(--color-danger)]">{st.error}</p>}
                </motion.div>
              );
            })}
            {!list.length && (
              <div className="grid place-items-center py-12 text-t3">
                <SwIcon name="download" size={24} />
                <p className="mt-2 text-xs">No models match “{query}”.</p>
              </div>
            )}
          </div>

          <footer className="px-4 pb-4">
            <p className="text-2xs leading-relaxed text-t3">
              Without a model, Swell falls back to deterministic on-device heuristics — segmentation, detection and
              inpainting all keep working, just less precisely. Weights are fetched on demand, verified against their
              published SHA-256, stored locally and unloaded after {ai.unloadAfterIdleSec}s idle. Commercial-unsafe
              weights (RMBG-1.4, Ultralytics YOLO) are deliberately excluded; see THIRD_PARTY_LICENSES.md.
            </p>
          </footer>
        </Modal>
      )}
    </AnimatePresence>
  );
}

export default ModelsDialog;
