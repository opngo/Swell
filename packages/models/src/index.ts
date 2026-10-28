/**
 * ONNX model manifests + download/registry logic (§2.4, §8.5).
 *
 * Models are **never bundled** with the installer: they are downloaded on
 * demand, checksum-verified, and disposed after an idle period so the RAM
 * budget in §6.1 stays honest.
 *
 * Licensing: only permissively licensed weights are listed here. RMBG-1.4 and
 * Ultralytics YLOv8+ are deliberately excluded (see docs/STATUS.md §Licensing).
 * `sha256` values are filled in by CI when a model is mirrored; until then the
 * registry refuses to install and reports `checksum-missing`.
 */

export type ExecutionProvider = 'coreml' | 'directml' | 'cuda' | 'cpu' | 'webgpu';

export type ModelTask =
  | 'segmentation'
  | 'matting'
  | 'detection'
  | 'embedding'
  | 'faces'
  | 'inpainting'
  | 'depth'
  | 'sky'
  | 'denoise'
  | 'upscale'
  | 'ocr';

export type ModelManifest = {
  id: string;
  name: string;
  task: ModelTask;
  version: string;
  /** Weight licence — verified per model, not just the code licence. */
  licence: string;
  sizeMB: number;
  sha256: string | null;
  url: string;
  providers: ExecutionProvider[];
  /** Resident-memory cost once the session is created (approximate). */
  residentMB: number;
  /** ms on a mid-range GPU / CPU for a 1600 px preview. */
  benchmark: { gpu: number; cpu: number };
  notes: string;
  /** Opt-in features that must never run without explicit consent. */
  requiresOptIn?: boolean;
};

export const MODELS: ModelManifest[] = [
  {
    id: 'mobilesam',
    name: 'MobileSAM',
    task: 'segmentation',
    version: '1.0.0',
    licence: 'Apache-2.0',
    sizeMB: 39,
    sha256: null,
    url: 'https://models.swell.photo/mobilesam-1.0.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 320,
    benchmark: { gpu: 220, cpu: 1800 },
    notes: 'Click-to-select objects. Image embedding is cached per photo.',
  },
  {
    id: 'sam2-hiera-small',
    name: 'SAM 2 (Hiera-Small)',
    task: 'segmentation',
    version: '2.0.0',
    licence: 'Apache-2.0',
    sizeMB: 185,
    sha256: null,
    url: 'https://models.swell.photo/sam2-hiera-small-2.0.0.onnx',
    providers: ['coreml', 'directml', 'cuda'],
    residentMB: 900,
    benchmark: { gpu: 420, cpu: 0 },
    notes: 'Higher-quality interactive masks; GPU only in practice.',
  },
  {
    id: 'birefnet',
    name: 'BiRefNet',
    task: 'matting',
    version: '1.2.0',
    licence: 'MIT',
    sizeMB: 224,
    sha256: null,
    url: 'https://models.swell.photo/birefnet-lite-1.2.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 780,
    benchmark: { gpu: 900, cpu: 5200 },
    notes: 'Salient-subject matte for Remove Background. Preferred over RMBG-1.4 (non-commercial).',
  },
  {
    id: 'vitmatte-s',
    name: 'ViTMatte-S',
    task: 'matting',
    version: '0.3.0',
    licence: 'MIT',
    sizeMB: 68,
    sha256: null,
    url: 'https://models.swell.photo/vitmatte-s-0.3.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 380,
    benchmark: { gpu: 260, cpu: 1600 },
    notes: 'Hair/fur edge refinement on top of the subject matte.',
  },
  {
    id: 'rt-detr-r18',
    name: 'RT-DETR (R18)',
    task: 'detection',
    version: '1.1.0',
    licence: 'Apache-2.0',
    sizeMB: 76,
    sha256: null,
    url: 'https://models.swell.photo/rt-detr-r18-1.1.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 420,
    benchmark: { gpu: 180, cpu: 1400 },
    notes: 'COCO-class object detection for Smart Detect. Not YOLOv8+ (AGPL).',
  },
  {
    id: 'siglip-base',
    name: 'SigLIP (base)',
    task: 'embedding',
    version: '1.0.0',
    licence: 'Apache-2.0',
    sizeMB: 350,
    sha256: null,
    url: 'https://models.swell.photo/siglip-base-patch16-384.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 900,
    benchmark: { gpu: 240, cpu: 2100 },
    notes: 'Natural-language photo search + "find similar". Verify checkpoint licence before shipping.',
  },
  {
    id: 'yunet',
    name: 'YuNet',
    task: 'faces',
    version: '2023mar',
    licence: 'MIT',
    sizeMB: 1,
    sha256: null,
    url: 'https://models.swell.photo/face_detection_yunet_2023mar.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 24,
    benchmark: { gpu: 12, cpu: 60 },
    notes: 'Face detection. Tiny — safe to keep resident.',
  },
  {
    id: 'face-embed',
    name: 'Face embedding (permissive checkpoint TBD)',
    task: 'faces',
    version: '0.0.0',
    licence: 'UNVERIFIED',
    sizeMB: 130,
    sha256: null,
    url: '',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 500,
    benchmark: { gpu: 60, cpu: 500 },
    notes: 'Face *recognition* clustering. Many popular checkpoints are non-commercial — not shipped until a permissive one is selected.',
    requiresOptIn: true,
  },
  {
    id: 'lama',
    name: 'LaMa',
    task: 'inpainting',
    version: '1.0.0',
    licence: 'Apache-2.0',
    sizeMB: 196,
    sha256: null,
    url: 'https://models.swell.photo/lama-1.0.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 700,
    benchmark: { gpu: 700, cpu: 6000 },
    notes: 'Object removal. The web runtime falls back to diffusion inpainting.',
  },
  {
    id: 'depth-anything-v2-s',
    name: 'Depth Anything V2 (Small)',
    task: 'depth',
    version: '2.0.0',
    licence: 'Apache-2.0',
    sizeMB: 99,
    sha256: null,
    url: 'https://models.swell.photo/depth-anything-v2-small.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 420,
    benchmark: { gpu: 200, cpu: 1500 },
    notes: 'Depth-range masks. Verify the small variant licence per release.',
  },
  {
    id: 'sky-seg',
    name: 'Sky segmentation',
    task: 'sky',
    version: '0.4.0',
    licence: 'Apache-2.0',
    sizeMB: 12,
    sha256: null,
    url: 'https://models.swell.photo/sky-seg-0.4.0.onnx',
    providers: ['coreml', 'directml', 'cuda', 'cpu'],
    residentMB: 90,
    benchmark: { gpu: 40, cpu: 320 },
    notes: 'Select Sky. Small enough to keep resident alongside the subject model.',
  },
  {
    id: 'nafnet-denoise',
    name: 'NAFNet denoise',
    task: 'denoise',
    version: '0.2.0',
    licence: 'UNVERIFIED',
    sizeMB: 62,
    sha256: null,
    url: '',
    providers: ['coreml', 'directml', 'cuda'],
    residentMB: 380,
    benchmark: { gpu: 500, cpu: 0 },
    notes: 'Optional AI denoise. Licence must be verified before distribution.',
    requiresOptIn: true,
  },
  {
    id: 'realesrgan-x4',
    name: 'Real-ESRGAN ×4 (photo)',
    task: 'upscale',
    version: '1.0.2',
    licence: 'BSD-3-Clause',
    sizeMB: 64,
    sha256: null,
    url: 'https://models.swell.photo/realesrgan-x4plus-1.0.2.onnx',
    providers: ['coreml', 'directml', 'cuda'],
    residentMB: 420,
    benchmark: { gpu: 1400, cpu: 0 },
    notes: 'AI upscale on export (v1.x).',
  },
];

export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export type ModelState =
  | 'not-downloaded'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'unsupported-here'
  | 'checksum-missing';

export type ModelStatus = {
  id: string;
  state: ModelState;
  progress: number; // 0..1 while downloading
  bytesOnDisk: number;
  resident: boolean;
  error?: string;
};

export type ModelHost = {
  /** Where models live on disk. Empty string in the web runtime. */
  dir: string;
  canDownload: boolean;
  read(id: string): Promise<Uint8Array | null>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  /** Create/destroy an ONNX session. Null when onnxruntime-node is unavailable. */
  createSession?(id: string, providers: ExecutionProvider[]): Promise<unknown>;
  destroySession?(id: string): Promise<void>;
};

/**
 * Registry: owns download state, resident-session bookkeeping and the
 * "unload after N seconds idle" rule (§6.2).
 */
export class ModelRegistry {
  private status = new Map<string, ModelStatus>();
  private lastUsed = new Map<string, number>();
  private sessions = new Map<string, unknown>();

  constructor(
    private host: ModelHost,
    private opts: { residentLimit: number; unloadAfterIdleMs: number },
  ) {
    for (const m of MODELS) {
      this.status.set(m.id, {
        id: m.id,
        state: host.canDownload ? 'not-downloaded' : 'unsupported-here',
        progress: 0,
        bytesOnDisk: 0,
        resident: false,
        ...(m.sha256 ? {} : { error: 'No published checksum — install disabled' }),
      });
    }
  }

  list(): (ModelManifest & { status: ModelStatus })[] {
    return MODELS.map((m) => ({ ...m, status: this.status.get(m.id)! }));
  }

  get(id: string): ModelStatus | undefined {
    return this.status.get(id);
  }

  isReady(id: string): boolean {
    return this.status.get(id)?.state === 'ready';
  }

  /**
   * Download + verify a model. Rejects when no checksum has been published —
   * shipping unverified weights is how you end up redistributing something
   * non-commercial by accident.
   */
  async download(id: string, onProgress?: (p: number) => void): Promise<void> {
    const manifest = MODEL_BY_ID.get(id);
    const st = this.status.get(id);
    if (!manifest || !st) throw new Error(`Unknown model: ${id}`);
    if (!this.host.canDownload) {
      st.state = 'unsupported-here';
      st.error = 'Model downloads are only available in the desktop build.';
      return;
    }
    if (!manifest.sha256) {
      st.state = 'checksum-missing';
      st.error = 'No published checksum for this model yet.';
      return;
    }
    st.state = 'downloading';
    st.progress = 0;
    try {
      const res = await fetch(manifest.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') ?? manifest.sizeMB * 1024 * 1024);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          st.progress = Math.min(1, received / total);
          onProgress?.(st.progress);
        }
      }
      const bytes = concat(chunks, received);
      st.state = 'verifying';
      const digest = await sha256HexBytes(bytes);
      if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
        throw new Error(`Checksum mismatch: ${digest}`);
      }
      await this.host.write(id, bytes);
      st.state = 'ready';
      st.bytesOnDisk = bytes.byteLength;
      st.progress = 1;
      st.error = undefined;
    } catch (e) {
      st.state = 'failed';
      st.error = e instanceof Error ? e.message : String(e);
    }
  }

  async remove(id: string): Promise<void> {
    await this.host.remove(id);
    this.sessions.delete(id);
    const st = this.status.get(id);
    if (st) {
      st.state = this.host.canDownload ? 'not-downloaded' : 'unsupported-here';
      st.bytesOnDisk = 0;
      st.resident = false;
      st.progress = 0;
    }
  }

  /** Load a session, evicting other residents to respect `residentLimit`. */
  async acquire(id: string): Promise<unknown | null> {
    const manifest = MODEL_BY_ID.get(id);
    if (!manifest || !this.isReady(id) || !this.host.createSession) return null;
    const existing = this.sessions.get(id);
    this.lastUsed.set(id, Date.now());
    if (existing) return existing;

    while (this.sessions.size >= Math.max(1, this.opts.residentLimit)) {
      const oldest = [...this.lastUsed.entries()].sort((a, b) => a[1] - b[1])[0];
      if (!oldest) break;
      await this.release(oldest[0]);
    }
    const session = await this.host.createSession(id, manifest.providers);
    this.sessions.set(id, session);
    const st = this.status.get(id);
    if (st) st.resident = true;
    return session;
  }

  async release(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    const st = this.status.get(id);
    if (st) st.resident = false;
    if (this.host.destroySession) await this.host.destroySession(id);
  }

  /** Called on a timer; disposes sessions idle for longer than the setting. */
  async unloadIdle(now = Date.now()): Promise<string[]> {
    const freed: string[] = [];
    for (const [id, t] of this.lastUsed) {
      if (now - t > this.opts.unloadAfterIdleMs && this.sessions.has(id)) {
        await this.release(id);
        freed.push(id);
      }
    }
    return freed;
  }

  residentCount(): number {
    return this.sessions.size;
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.subtle) {
    const d = await c.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { sha256Bytes } = await import('@swell/shared');
  return [...sha256Bytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A host that refuses everything — used by the web runtime and by tests. */
export const nullModelHost: ModelHost = {
  dir: '',
  canDownload: false,
  read: async () => null,
  write: async () => {},
  remove: async () => {},
};
