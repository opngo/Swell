/** Import (§4.1) and Export/Print (§10.5) option schemas. */

import { z } from 'zod';

/* ------------------------------------------------------------------ import */

export const importOptionsSchema = z.object({
  mode: z.enum(['copy', 'move', 'add']).default('copy'),
  destinationTemplate: z.string().default('{YYYY}/{MM}/{DD}'),
  destinationRoot: z.string().default(''),
  subfolder: z.string().default(''),
  renameTemplate: z.string().default('{original}'),
  rename: z.boolean().default(false),
  skipDuplicates: z.boolean().default(true),
  rawJpeg: z.enum(['stack', 'separate', 'rawOnly']).default('stack'),
  ignoreSidecars: z.boolean().default(false),
  previews: z.enum(['minimal', 'embedded', 'standard', '1to1', 'smart']).default('standard'),
  presetId: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  collectionId: z.string().optional(),
  copyright: z.string().default(''),
  creator: z.string().default(''),
  backupDestination: z.string().default(''),
  ejectAfter: z.boolean().default(false),
  runSmartDetect: z.boolean().default(true),
  hideImported: z.boolean().default(true),
  dateRange: z.object({ from: z.string().optional(), to: z.string().optional() }).prefault({}),
});
export type ImportOptions = z.output<typeof importOptionsSchema>;

export const FOLDER_TOKENS = [
  { token: '{YYYY}', label: 'Year' },
  { token: '{MM}', label: 'Month' },
  { token: '{DD}', label: 'Day' },
  { token: '{camera}', label: 'Camera' },
  { token: '{event}', label: 'Event name' },
  { token: '{date}', label: 'YYYY-MM-DD' },
];

export const RENAME_TOKENS = [
  { token: '{original}', label: 'Original name' },
  { token: '{date}', label: 'Capture date' },
  { token: '{seq}', label: 'Sequence (3 digits)' },
  { token: '{seq2}', label: 'Sequence (2 digits)' },
  { token: '{camera}', label: 'Camera' },
  { token: '{iso}', label: 'ISO' },
  { token: '{custom}', label: 'Custom text' },
  { token: '{ext}', label: 'Extension' },
];

export type ImportCandidate = {
  id: string;
  file: { name: string; size: number; type: string; lastModified: number };
  /** object: URL in the web runtime, absolute path on desktop */
  src: string;
  selected: boolean;
  duplicate: boolean;
  alreadyImported: boolean;
  width?: number;
  height?: number;
  captureTime?: string;
  camera?: string;
  raw?: boolean;
};

/** Folder/rename template expansion. Pure so it can be unit-tested. */
export function expandTemplate(
  template: string,
  ctx: {
    date?: Date;
    seq?: number;
    original?: string;
    camera?: string;
    event?: string;
    iso?: number;
    custom?: string;
    ext?: string;
  },
): string {
  const d = ctx.date ?? new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return template
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{MM\}/g, pad(d.getMonth() + 1))
    .replace(/\{DD\}/g, pad(d.getDate()))
    .replace(/\{date\}/g, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    .replace(/\{time\}/g, `${pad(d.getHours())}${pad(d.getMinutes())}`)
    .replace(/\{seq\}/g, pad(ctx.seq ?? 1, 3))
    .replace(/\{seq2\}/g, pad(ctx.seq ?? 1, 2))
    .replace(/\{original\}/g, ctx.original ?? 'IMG_0000')
    .replace(/\{camera\}/g, (ctx.camera ?? 'Camera').replace(/[^\w-]+/g, '-'))
    .replace(/\{event\}/g, (ctx.event ?? 'Untitled').replace(/[^\w-]+/g, '-'))
    .replace(/\{iso\}/g, String(ctx.iso ?? 0))
    .replace(/\{custom\}/g, ctx.custom ?? '')
    .replace(/\{ext\}/g, ctx.ext ?? 'jpg');
}

/* ------------------------------------------------------------------ export */

export const exportSettingsSchema = z.object({
  presetId: z.string().default('web-2048'),
  /* location */
  location: z.enum(['choose', 'sameAsOriginal', 'subfolder']).default('choose'),
  folder: z.string().default(''),
  subfolderTemplate: z.string().default('{YYYY}-{MM}-{DD}'),
  renameTemplate: z.string().default('{original}-export'),
  rename: z.boolean().default(true),
  collision: z.enum(['ask', 'overwrite', 'skip', 'unique']).default('unique'),
  addToCatalog: z.boolean().default(false),
  addToStack: z.boolean().default(false),
  /* file settings */
  format: z
    .enum(['jpeg', 'png', 'tiff', 'webp', 'avif', 'jxl', 'heic', 'original', 'dng'])
    .default('jpeg'),
  quality: z.number().min(1).max(100).default(88),
  limitSizeKB: z.number().min(0).max(200000).default(0),
  bitDepth: z.union([z.literal(8), z.literal(16)]).default(8),
  tiffCompression: z.enum(['none', 'lzw', 'zip']).default('lzw'),
  /* colour */
  colorSpace: z
    .enum(['srgb', 'displayP3', 'adobergb', 'prophoto', 'rec2020', 'custom'])
    .default('srgb'),
  customIcc: z.string().default(''),
  renderingIntent: z.enum(['perceptual', 'relative', 'saturation', 'absolute']).default('perceptual'),
  blackPointCompensation: z.boolean().default(true),
  /* sizing */
  resize: z.boolean().default(true),
  resizeMode: z
    .enum(['widthHeight', 'longEdge', 'shortEdge', 'megapixels', 'percent'])
    .default('longEdge'),
  width: z.number().default(2048),
  height: z.number().default(2048),
  longEdge: z.number().default(2048),
  shortEdge: z.number().default(1365),
  megapixels: z.number().default(4),
  percent: z.number().default(50),
  resolutionPpi: z.number().default(300),
  dontEnlarge: z.boolean().default(true),
  aiUpscale: z.enum(['off', '2x', '4x']).default('off'),
  /* sharpening */
  outputSharpening: z.enum(['none', 'screen', 'matte', 'glossy']).default('screen'),
  sharpenAmount: z.enum(['low', 'standard', 'high']).default('standard'),
  /* metadata */
  metadata: z.enum(['all', 'allExceptCamera', 'copyrightOnly', 'none']).default('allExceptCamera'),
  removeLocation: z.boolean().default(false),
  removePersonInfo: z.boolean().default(false),
  keywordsAsHierarchy: z.boolean().default(true),
  /* watermark */
  watermark: z
    .object({
      enabled: z.boolean().default(false),
      kind: z.enum(['text', 'image']).default('text'),
      text: z.string().default('© Swell'),
      imageSrc: z.string().default(''),
      position: z
        .enum(['topLeft', 'topCenter', 'topRight', 'centerLeft', 'center', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'])
        .default('bottomRight'),
      inset: z.number().min(0).max(50).default(4),
      opacity: z.number().min(0).max(100).default(70),
      size: z.number().min(1).max(100).default(6),
      blend: z.string().default('normal'),
    })
    .prefault({}),
  /* background */
  transparentBackground: z.boolean().default(false),
  /* post */
  postProcessing: z.enum(['nothing', 'showInOs', 'openIn', 'script']).default('nothing'),
  openInApp: z.string().default(''),
  script: z.string().default(''),
  parallelJobs: z.number().min(1).max(32).default(0),
  notifyOnFinish: z.boolean().default(true),
});
export type ExportSettings = z.output<typeof exportSettingsSchema>;
export const defaultExportSettings = (): ExportSettings => exportSettingsSchema.parse({});

export const exportPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  settings: exportSettingsSchema.prefault({}),
});
export type ExportPreset = z.output<typeof exportPresetSchema>;

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'web-2048',
    name: 'Web · 2048 sRGB',
    settings: exportSettingsSchema.parse({
      format: 'jpeg',
      quality: 86,
      resizeMode: 'longEdge',
      longEdge: 2048,
      colorSpace: 'srgb',
      outputSharpening: 'screen',
      metadata: 'allExceptCamera',
    }),
  },
  {
    id: 'web-1400',
    name: 'Social · 1400 JPEG',
    settings: exportSettingsSchema.parse({
      format: 'jpeg',
      quality: 82,
      resizeMode: 'longEdge',
      longEdge: 1400,
      colorSpace: 'srgb',
      outputSharpening: 'screen',
      metadata: 'copyrightOnly',
      removeLocation: true,
    }),
  },
  {
    id: 'print-tiff16',
    name: 'Print · TIFF 16-bit AdobeRGB',
    settings: exportSettingsSchema.parse({
      format: 'tiff',
      bitDepth: 16,
      tiffCompression: 'lzw',
      colorSpace: 'adobergb',
      resize: false,
      resolutionPpi: 300,
      outputSharpening: 'matte',
      sharpenAmount: 'standard',
      metadata: 'all',
    }),
  },
  {
    id: 'transparent-png',
    name: 'Cutout · transparent PNG',
    settings: exportSettingsSchema.parse({
      format: 'png',
      colorSpace: 'srgb',
      transparentBackground: true,
      resize: false,
      metadata: 'none',
    }),
  },
  {
    id: 'avif-hdr',
    name: 'AVIF · Display P3',
    settings: exportSettingsSchema.parse({
      format: 'avif',
      quality: 70,
      colorSpace: 'displayP3',
      resizeMode: 'longEdge',
      longEdge: 2560,
      metadata: 'allExceptCamera',
    }),
  },
];

export type PrintLayout = 'single' | 'contactSheet' | 'picturePackage' | 'custom';

export const printSettingsSchema = z.object({
  layout: z.enum(['single', 'contactSheet', 'picturePackage', 'custom']).default('contactSheet'),
  pageSize: z.enum(['A4', 'A3', 'Letter', 'A5', '10x15cm', '13x18cm']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginMm: z.number().default(10),
  gapMm: z.number().default(3),
  cellsPerRow: z.number().min(1).max(12).default(4),
  cellHeightMm: z.number().default(40),
  rotateToFit: z.boolean().default(true),
  showFilenames: z.boolean().default(false),
  showRatings: z.boolean().default(true),
  showCaption: z.boolean().default(false),
  showPageNumbers: z.boolean().default(true),
  watermark: z.boolean().default(false),
  printerProfile: z.string().default(''),
  renderingIntent: z.enum(['perceptual', 'relative']).default('perceptual'),
  printSharpening: z.enum(['off', 'low', 'standard', 'high']).default('standard'),
  blackPointCompensation: z.boolean().default(true),
  output: z.enum(['pdf', 'printer']).default('printer'),
});
export type PrintSettings = z.output<typeof printSettingsSchema>;
