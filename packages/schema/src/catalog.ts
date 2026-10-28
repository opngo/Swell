/**
 * Catalog data model (§7.1).
 *
 * The canonical store is SQLite (`apps/desktop/electron/utility/catalog`,
 * better-sqlite3 + Drizzle, WAL mode, FTS5). The same row shapes are used by
 * the web runtime's IndexedDB driver so the two are interchangeable.
 */

import { z } from 'zod';
import type { DevelopParams } from './params.ts';

export const photoSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  filename: z.string(),
  ext: z.string(),
  /** Where the renderer can get pixels: file path (desktop) or blob URL (web). */
  src: z.string(),
  size: z.number().default(0),
  mtime: z.number().default(0),
  hash: z.string().optional(),
  width: z.number().default(0),
  height: z.number().default(0),
  captureTime: z.string().default(''),
  addedTime: z.number().default(0),
  camera: z.string().default(''),
  cameraSerial: z.string().default(''),
  lens: z.string().default(''),
  iso: z.number().default(0),
  aperture: z.number().default(0),
  shutter: z.number().default(0),
  focalMm: z.number().default(0),
  rating: z.number().int().min(0).max(5).default(0),
  flag: z.enum(['none', 'pick', 'reject']).default('none'),
  colorLabel: z.enum(['none', 'red', 'yellow', 'green', 'blue', 'purple']).default('none'),
  gps: z.object({ lat: z.number(), lon: z.number(), place: z.string().optional() }).optional(),
  title: z.string().default(''),
  caption: z.string().default(''),
  copyright: z.string().default(''),
  creator: z.string().default(''),
  stackId: z.string().optional(),
  stackPosition: z.number().default(0),
  isVirtualCopy: z.boolean().default(false),
  masterId: z.string().optional(),
  importId: z.string().optional(),
  missing: z.boolean().default(false),
  /** Raw + jpeg pairing */
  pairedId: z.string().optional(),
  hasEdits: z.boolean().default(false),
  editedAt: z.number().default(0),
  /** Set while the analysis worker is chewing on it. */
  indexState: z.enum(['pending', 'indexed', 'failed', 'skipped']).default('pending'),
});
export type Photo = z.output<typeof photoSchema>;

export const folderSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  volumeId: z.string(),
});
export type Folder = z.output<typeof folderSchema>;

export const volumeSchema = z.object({
  id: z.string(),
  label: z.string(),
  uuid: z.string().optional(),
  online: z.boolean().default(true),
});
export type Volume = z.output<typeof volumeSchema>;

/* ------------------------------------------------------------ collections */

export const smartRuleSchema = z.object({
  id: z.string(),
  field: z.string(),
  op: z.enum([
    'is',
    'isNot',
    'contains',
    'greaterThan',
    'lessThan',
    'between',
    'exists',
    'notExists',
    'before',
    'after',
  ]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown())]).optional(),
  value2: z.union([z.string(), z.number()]).optional(),
});
export type SmartRule = z.output<typeof smartRuleSchema>;

export const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  kind: z.enum(['manual', 'smart', 'set', 'target']).default('manual'),
  rules: z.array(smartRuleSchema).default([]),
  match: z.enum(['all', 'any']).default('all'),
  photoIds: z.array(z.string()).default([]),
  sortOrder: z.enum(['manual', 'captureTime', 'filename', 'rating']).default('manual'),
  createdAt: z.number().default(0),
});
export type Collection = z.output<typeof collectionSchema>;

export const keywordSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  synonyms: z.array(z.string()).default([]),
  exportFlag: z.boolean().default(true),
});
export type Keyword = z.output<typeof keywordSchema>;

/* -------------------------------------------------------------- detection */

export const detectionSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  kind: z.enum(['object', 'scene', 'attribute', 'face', 'text', 'region']),
  label: z.string(),
  score: z.number().min(0).max(1).default(0),
  /** Normalised bbox in the source frame. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  maskRef: z.string().optional(),
  modelVer: z.string().default(''),
  provider: z.enum(['onnx', 'heuristic', 'metadata', 'user']).default('heuristic'),
});
export type Detection = z.output<typeof detectionSchema>;

export const personSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  confirmed: z.boolean().default(false),
});
export type Person = z.output<typeof personSchema>;

export const faceSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  personId: z.string().optional(),
  confirmed: z.boolean().default(false),
  embeddingRef: z.string().optional(),
});
export type Face = z.output<typeof faceSchema>;

/* ---------------------------------------------------------------- features */

/** Per-photo analysis output (computed by the analysis worker). */
export const featuresSchema = z.object({
  photoId: z.string(),
  modelVer: z.string(),
  meanLuma: z.number(),
  stdLuma: z.number(),
  contrast: z.number(),
  sharpness: z.number(),
  blurScore: z.number(),
  exposureScore: z.number(),
  clippedHighlights: z.number(),
  clippedShadows: z.number(),
  skinRatio: z.number(),
  skyRatio: z.number(),
  greenRatio: z.number(),
  warmCool: z.number(),
  horizonTilt: z.number(),
  edgeDensity: z.number(),
  saturationMean: z.number(),
  isMonochrome: z.boolean(),
  palette: z.array(z.object({ css: z.string(), weight: z.number(), h: z.number(), c: z.number(), l: z.number() })),
  dhash: z.string(),
  ahash: z.string(),
  /** Concept vector — kept out of the persisted row (recomputed on demand). */
  concepts: z.array(z.object({ id: z.string(), score: z.number() })).default([]),
  computedAt: z.number(),
});
export type PhotoFeatures = z.output<typeof featuresSchema>;

/* ------------------------------------------------------------------ tasks */

export const taskSchema = z.object({
  id: z.string(),
  kind: z.enum(['import', 'preview', 'index', 'export', 'matte', 'batch', 'backup', 'optimize']),
  label: z.string(),
  state: z.enum(['queued', 'running', 'paused', 'done', 'failed', 'cancelled']).default('queued'),
  total: z.number().default(0),
  done: z.number().default(0),
  startedAt: z.number().default(0),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  /** Hint shown in the activity centre ("≈ 240 MB peak"). */
  memoryHint: z.string().optional(),
});
export type Task = z.output<typeof taskSchema>;

/* ------------------------------------------------------- filtering/sorting */

export type SortField =
  | 'captureTime'
  | 'addedTime'
  | 'filename'
  | 'editedAt'
  | 'rating'
  | 'aspect'
  | 'fileType'
  | 'manual';

export type SortSpec = { field: SortField; direction: 'asc' | 'desc' };

export type TextFilter = { query: string; fields: 'all' | 'filename' | 'keywords' | 'caption' };

export type AttributeFilter = {
  flags: ('pick' | 'reject' | 'none')[];
  minRating: number;
  labels: string[];
  editState: 'any' | 'edited' | 'unedited';
  fileType: 'any' | 'raw' | 'jpeg' | 'png' | 'tiff' | 'video';
};

export type MetadataFacet = {
  field: 'date' | 'camera' | 'lens' | 'iso' | 'focal' | 'aperture' | 'keyword' | 'detected' | 'person' | 'scene';
  value: string;
};

export type FilterSpec = {
  text?: TextFilter;
  attribute?: Partial<AttributeFilter>;
  facets: MetadataFacet[];
  range?: { from?: string; to?: string };
};

export const emptyFilter = (): FilterSpec => ({ facets: [] });

/* -------------------------------------------------------------------- SQL */

/**
 * Canonical DDL — kept as a string so the Electron catalog service, the
 * integrity checker and the docs all read from one place.
 */
export const CATALOG_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, uuid TEXT, online INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  volume_id TEXT NOT NULL REFERENCES volumes(id)
);
CREATE INDEX IF NOT EXISTS folders_path ON folders(path);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, ext TEXT NOT NULL, src TEXT NOT NULL,
  size INTEGER DEFAULT 0, mtime INTEGER DEFAULT 0, hash TEXT,
  width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
  capture_time TEXT, added_time INTEGER,
  camera TEXT, camera_serial TEXT, lens TEXT,
  iso REAL, aperture REAL, shutter REAL, focal_mm REAL,
  rating INTEGER DEFAULT 0, flag TEXT DEFAULT 'none', color_label TEXT DEFAULT 'none',
  gps_lat REAL, gps_lon REAL, gps_place TEXT,
  title TEXT, caption TEXT, copyright TEXT, creator TEXT,
  stack_id TEXT, stack_position INTEGER DEFAULT 0,
  is_virtual_copy INTEGER DEFAULT 0, master_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  import_id TEXT, missing INTEGER DEFAULT 0, paired_id TEXT,
  has_edits INTEGER DEFAULT 0, edited_at INTEGER DEFAULT 0,
  index_state TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS photos_folder ON photos(folder_id);
CREATE INDEX IF NOT EXISTS photos_capture ON photos(capture_time);
CREATE INDEX IF NOT EXISTS photos_rating ON photos(rating);
CREATE INDEX IF NOT EXISTS photos_stack ON photos(stack_id);
CREATE INDEX IF NOT EXISTS photos_hash ON photos(hash);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'manual',
  rules_json TEXT, match_mode TEXT DEFAULT 'all',
  sort_order TEXT DEFAULT 'manual', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS collection_photos (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (collection_id, photo_id)
);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT REFERENCES keywords(id) ON DELETE CASCADE,
  synonyms_json TEXT, export_flag INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS photo_keywords (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (photo_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS develop_settings (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, params_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, label TEXT NOT NULL, params_diff_json TEXT NOT NULL,
  parent_id TEXT, branch INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS history_photo ON history(photo_id, ts);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  name TEXT NOT NULL, params_json TEXT NOT NULL, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "group" TEXT NOT NULL,
  params_json TEXT NOT NULL, include_json TEXT, amount INTEGER DEFAULT 100,
  favorite INTEGER DEFAULT 0, thumb_blob BLOB, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "group" TEXT NOT NULL,
  params_json TEXT, lut_path TEXT, favorite INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS detections (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, label TEXT NOT NULL, score REAL,
  bbox_json TEXT, mask_ref TEXT, model_ver TEXT, provider TEXT DEFAULT 'heuristic'
);
CREATE INDEX IF NOT EXISTS detections_photo ON detections(photo_id);
CREATE INDEX IF NOT EXISTS detections_label ON detections(label);

CREATE TABLE IF NOT EXISTS features (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  model_ver TEXT NOT NULL, json TEXT NOT NULL, computed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  model_ver TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (photo_id, model_ver)
);
CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT, confirmed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS faces (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bbox_json TEXT NOT NULL, person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  confirmed INTEGER DEFAULT 0, embedding BLOB
);

CREATE TABLE IF NOT EXISTS previews (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tier TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER DEFAULT 0, built_at INTEGER,
  PRIMARY KEY (photo_id, tier)
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, source TEXT, count INTEGER DEFAULT 0,
  options_json TEXT
);
CREATE TABLE IF NOT EXISTS mattes (
  id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  model_ver TEXT NOT NULL, width INTEGER, height INTEGER,
  path TEXT NOT NULL, bytes INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_photos USING fts5(
  photo_id UNINDEXED, filename, title, caption, keywords, camera, lens, place, ocr
);
`;
