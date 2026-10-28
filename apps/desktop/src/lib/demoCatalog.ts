/**
 * Demo catalog (§14 M0): a small, believable library so every route has real
 * content on first run. In the Electron build this module is replaced by the
 * SQLite catalog service; the shape of the data is identical.
 *
 * Photos are AI-generated stand-ins shipped in `public/demo/photos/`.
 */

import type { Collection, Detection, Folder, Keyword, Photo, Volume } from '@swell/schema';

const P = '/demo/photos';

interface Seed {
  id: string;
  file: string;
  w: number;
  h: number;
  size: number;
  folder: string;
  camera: string;
  lens: string;
  iso: number;
  aperture: number;
  shutter: number;
  focal: number;
  when: string;
  added: number;
  title: string;
  caption: string;
  keywords: string[];
  detections: [string, string, number, [number, number, number, number]?][];
  rating?: number;
  flag?: Photo['flag'];
  label?: Photo['colorLabel'];
  gps?: { lat: number; lon: number; place: string };
  stack?: { id: string; pos: number };
  edited?: boolean;
}

const DAY = 86_400_000;
const base = Date.UTC(2026, 9, 9, 9, 0, 0); // today
const ago = (days: number, hour = 10, min = 0, sec = 0) =>
  new Date(base - days * DAY + hour * 3_600_000 + min * 60_000 + sec * 1000).toISOString();

const SEEDS: Seed[] = [
  {
    id: 'DSC_8421', file: 'DSC_8421.jpg', w: 1536, h: 1024, size: 347_048, folder: 'f-lofoten',
    camera: 'NIKON Z 8', lens: 'NIKKOR Z 24-70mm f/2.8 S', iso: 64, aperture: 8, shutter: 1 / 250, focal: 35,
    when: ago(24, 18, 42), added: base - 23 * DAY,
    title: 'Reine, last light', caption: 'Fjord turning copper as the sun dropped behind the ridge.',
    keywords: ['landscape', 'fjord', 'mountains', 'golden hour', 'reflection', 'norway', 'trip 2026'],
    detections: [
      ['scene', 'mountain lake', 0.93, [0, 0.28, 1, 0.5]],
      ['scene', 'golden hour', 0.88],
      ['object', 'water', 0.95, [0, 0.55, 1, 0.45]],
      ['attribute', 'reflection', 0.71, [0.1, 0.58, 0.8, 0.4]],
      ['scene', 'sky', 0.9, [0, 0, 1, 0.34]],
    ],
    rating: 5, flag: 'pick', label: 'green',
    gps: { lat: 67.9323, lon: 13.0905, place: 'Reine, Lofoten, NO' },
    edited: true,
  },
  {
    id: '_MG_2231', file: '_MG_2231.jpg', w: 1536, h: 1024, size: 226_952, folder: 'f-studio',
    camera: 'Canon EOS R5', lens: 'RF 85mm f/1.2 L USM', iso: 200, aperture: 1.8, shutter: 1 / 400, focal: 85,
    when: ago(20, 15, 12), added: base - 20 * DAY,
    title: 'Amara — setup A', caption: 'Window light, black flag camera-left.',
    keywords: ['portrait', 'studio', 'headshot', 'amara', 'natural light'],
    detections: [
      ['object', 'person', 0.97, [0.28, 0.1, 0.46, 0.86]],
      ['object', 'face', 0.95, [0.38, 0.14, 0.24, 0.26]],
      ['attribute', 'shallow depth of field', 0.8],
      ['object', 'eye', 0.72, [0.44, 0.2, 0.06, 0.03]],
    ],
    rating: 4, flag: 'pick', stack: { id: 'st-amara', pos: 0 },
  },
  {
    id: '_MG_2232', file: '_MG_2232.jpg', w: 1523, h: 1024, size: 211_946, folder: 'f-studio',
    camera: 'Canon EOS R5', lens: 'RF 85mm f/1.2 L USM', iso: 200, aperture: 2, shutter: 1 / 320, focal: 85,
    when: ago(20, 15, 12, 26), added: base - 20 * DAY,
    title: 'Amara — turn', caption: 'Same light, three-quarter turn.',
    keywords: ['portrait', 'studio', 'headshot', 'amara'],
    detections: [
      ['object', 'person', 0.96, [0.24, 0.08, 0.5, 0.9]],
      ['object', 'face', 0.93, [0.34, 0.12, 0.26, 0.28]],
      ['attribute', 'closed eyes', 0.42],
    ],
    rating: 3, stack: { id: 'st-amara', pos: 1 },
  },
  {
    id: '_MG_2233', file: '_MG_2233.jpg', w: 1531, h: 1024, size: 214_182, folder: 'f-studio',
    camera: 'Canon EOS R5', lens: 'RF 85mm f/1.2 L USM', iso: 250, aperture: 2, shutter: 1 / 320, focal: 85,
    when: ago(20, 15, 13, 4), added: base - 20 * DAY,
    title: 'Amara — laugh', caption: 'The frame the client picked.',
    keywords: ['portrait', 'studio', 'headshot', 'amara', 'expression'],
    detections: [
      ['object', 'person', 0.97, [0.26, 0.1, 0.48, 0.88]],
      ['object', 'face', 0.96, [0.36, 0.14, 0.25, 0.27]],
      ['attribute', 'smiling', 0.86],
      ['attribute', 'teeth visible', 0.61],
    ],
    rating: 5, flag: 'pick', label: 'green', stack: { id: 'st-amara', pos: 2 }, edited: true,
  },
  {
    id: 'A7R_0042', file: 'A7R_0042.jpg', w: 1536, h: 1024, size: 192_440, folder: 'f-still',
    camera: 'ILCE-7RM5', lens: 'FE 90mm f/2.8 Macro G', iso: 100, aperture: 11, shutter: 1 / 160, focal: 90,
    when: ago(6, 11, 20), added: base - 6 * DAY,
    title: 'Stoneware mug — sweep', caption: 'Two strips, one bounce card.',
    keywords: ['product', 'still life', 'ceramic', 'studio', 'commercial'],
    detections: [
      ['object', 'mug', 0.94, [0.34, 0.24, 0.34, 0.5]],
      ['object', 'ceramic', 0.72],
      ['attribute', 'plain background', 0.9],
      ['attribute', 'specular highlight', 0.55],
    ],
    rating: 3,
  },
  {
    id: 'A7R_0043', file: 'A7R_0043.jpg', w: 1024, h: 1024, size: 165_533, folder: 'f-studio',
    camera: 'ILCE-7RM5', lens: 'FE 85mm f/1.4 GM', iso: 160, aperture: 1.8, shutter: 1 / 250, focal: 85,
    when: ago(6, 14, 5), added: base - 6 * DAY,
    title: 'Ivo — square crop', caption: 'Crop for the grid post.',
    keywords: ['portrait', 'square', 'ivo', 'editorial'],
    detections: [
      ['object', 'person', 0.96, [0.2, 0.06, 0.6, 0.92]],
      ['object', 'face', 0.94, [0.32, 0.12, 0.34, 0.34]],
      ['attribute', 'beard', 0.66],
    ],
    rating: 4, label: 'blue',
  },
  {
    id: 'DSC04512', file: 'DSC04512.jpg', w: 1536, h: 1024, size: 321_236, folder: 'f-beach',
    camera: 'ILCE-1', lens: 'FE 70-200mm f/2.8 GM OSS II', iso: 400, aperture: 4, shutter: 1 / 2000, focal: 135,
    when: ago(16, 17, 3), added: base - 16 * DAY,
    title: 'Biscuit — mid air', caption: 'Burst 1 of 3.',
    keywords: ['dog', 'beach', 'action', 'biscuit', 'burst'],
    detections: [
      ['object', 'dog', 0.95, [0.3, 0.34, 0.42, 0.4]],
      ['scene', 'beach', 0.9],
      ['object', 'sand', 0.82, [0, 0.6, 1, 0.4]],
      ['attribute', 'motion blur', 0.18],
    ],
    rating: 4, flag: 'pick', stack: { id: 'st-biscuit', pos: 0 },
  },
  {
    id: 'DSC04513', file: 'DSC04513.jpg', w: 1536, h: 1024, size: 324_220, folder: 'f-beach',
    camera: 'ILCE-1', lens: 'FE 70-200mm f/2.8 GM OSS II', iso: 400, aperture: 4, shutter: 1 / 2000, focal: 135,
    when: ago(16, 17, 3, 1), added: base - 16 * DAY,
    title: 'Biscuit — landing', caption: 'Burst 2 of 3.',
    keywords: ['dog', 'beach', 'action', 'biscuit', 'burst'],
    detections: [
      ['object', 'dog', 0.96, [0.28, 0.38, 0.44, 0.36]],
      ['scene', 'beach', 0.9],
      ['object', 'wave', 0.44, [0, 0.5, 1, 0.2]],
    ],
    rating: 5, flag: 'pick', stack: { id: 'st-biscuit', pos: 1 }, edited: true,
  },
  {
    id: 'DSC04514', file: 'DSC04514.jpg', w: 1500, h: 1024, size: 314_329, folder: 'f-beach',
    camera: 'ILCE-1', lens: 'FE 70-200mm f/2.8 GM OSS II', iso: 500, aperture: 4, shutter: 1 / 1600, focal: 140,
    when: ago(16, 17, 3, 2), added: base - 16 * DAY,
    title: 'Biscuit — shake off', caption: 'Burst 3 of 3. Slight miss-focus.',
    keywords: ['dog', 'beach', 'action', 'biscuit', 'burst'],
    detections: [
      ['object', 'dog', 0.9, [0.3, 0.36, 0.4, 0.38]],
      ['scene', 'beach', 0.88],
      ['attribute', 'soft focus', 0.63],
    ],
    rating: 2, flag: 'reject', stack: { id: 'st-biscuit', pos: 2 },
  },
  {
    id: '_DSF1187', file: '_DSF1187.jpg', w: 1536, h: 1024, size: 324_822, folder: 'f-city',
    camera: 'X-T5', lens: 'XF 23mm f/2 R WR', iso: 1600, aperture: 2, shutter: 1 / 60, focal: 23,
    when: ago(13, 21, 48), added: base - 13 * DAY,
    title: 'Shibuya, after rain', caption: 'Handheld at 1/60 — needs noise work.',
    keywords: ['city', 'night', 'rain', 'neon', 'street', 'tokyo'],
    detections: [
      ['scene', 'city at night', 0.95],
      ['object', 'building', 0.88, [0, 0, 1, 0.7]],
      ['attribute', 'neon', 0.8],
      ['object', 'street', 0.76, [0, 0.66, 1, 0.34]],
      ['attribute', 'high noise', 0.7],
    ],
    rating: 4, label: 'purple', gps: { lat: 35.6595, lon: 139.7005, place: 'Shibuya, Tokyo, JP' },
  },
  {
    id: 'DSC_3309', file: 'DSC_3309.jpg', w: 1536, h: 1024, size: 165_320, folder: 'f-macro',
    camera: 'NIKON Z 8', lens: 'NIKKOR Z MC 105mm f/2.8 VR S', iso: 200, aperture: 5.6, shutter: 1 / 320, focal: 105,
    when: ago(10, 9, 24), added: base - 10 * DAY,
    title: 'Cosmos, backlit', caption: 'Focus stacked from 4 frames.',
    keywords: ['macro', 'flower', 'garden', 'backlit', 'cosmos'],
    detections: [
      ['object', 'flower', 0.97, [0.28, 0.2, 0.44, 0.6]],
      ['attribute', 'backlit', 0.85],
      ['object', 'petal', 0.8, [0.2, 0.16, 0.6, 0.68]],
      ['scene', 'garden', 0.66],
    ],
    rating: 4, flag: 'pick',
  },
  {
    id: '_MG_7744', file: '_MG_7744.jpg', w: 1536, h: 1024, size: 148_478, folder: 'f-river',
    camera: 'Canon EOS R5', lens: 'RF 100-500mm f/4.5-7.1 L IS USM', iso: 800, aperture: 5.6, shutter: 1 / 2500, focal: 400,
    when: ago(8, 7, 51), added: base - 8 * DAY,
    title: 'Kingfisher on the post', caption: 'Waited two hours for this perch.',
    keywords: ['bird', 'kingfisher', 'wildlife', 'river', 'perch'],
    detections: [
      ['object', 'bird', 0.98, [0.42, 0.36, 0.2, 0.2]],
      ['object', 'kingfisher', 0.9, [0.42, 0.36, 0.2, 0.2]],
      ['scene', 'river', 0.74],
      ['attribute', 'clean background', 0.88],
    ],
    rating: 5, flag: 'pick', label: 'green', edited: true,
  },
  {
    id: 'DSC06620', file: 'DSC06620.jpg', w: 1536, h: 1024, size: 453_882, folder: 'f-table',
    camera: 'ILCE-1', lens: 'FE 90mm f/2.8 Macro G', iso: 100, aperture: 4, shutter: 1 / 125, focal: 90,
    when: ago(4, 12, 40), added: base - 4 * DAY,
    title: 'Ramen, overhead', caption: 'Client wants steam kept.',
    keywords: ['food', 'ramen', 'overhead', 'restaurant', 'commercial'],
    detections: [
      ['object', 'food', 0.96, [0.24, 0.2, 0.52, 0.6]],
      ['object', 'bowl', 0.9, [0.26, 0.22, 0.48, 0.56]],
      ['attribute', 'steam', 0.58],
      ['scene', 'table', 0.7],
    ],
    rating: 4, stack: { id: 'st-ramen', pos: 0 },
  },
  {
    id: 'DSC06621', file: 'DSC06621.jpg', w: 1024, h: 1024, size: 295_536, folder: 'f-table',
    camera: 'ILCE-1', lens: 'FE 90mm f/2.8 Macro G', iso: 100, aperture: 4, shutter: 1 / 125, focal: 90,
    when: ago(4, 12, 41), added: base - 4 * DAY,
    title: 'Ramen, square', caption: 'Same frame, cropped for social.',
    keywords: ['food', 'ramen', 'square', 'social'],
    detections: [
      ['object', 'food', 0.95, [0.14, 0.12, 0.72, 0.76]],
      ['object', 'bowl', 0.9, [0.16, 0.14, 0.68, 0.72]],
    ],
    rating: 3, stack: { id: 'st-ramen', pos: 1 },
  },
  {
    id: 'DSC_1178', file: 'DSC_1178.jpg', w: 1536, h: 1024, size: 171_163, folder: 'f-desert',
    camera: 'NIKON Z 8', lens: 'NIKKOR Z 70-200mm f/2.8 VR S', iso: 64, aperture: 11, shutter: 1 / 800, focal: 100,
    when: ago(2, 16, 55), added: base - 2 * DAY,
    title: 'Dune ridge lines', caption: 'Compressed at 100mm.',
    keywords: ['desert', 'dunes', 'minimal', 'landscape', 'morocco'],
    detections: [
      ['scene', 'desert', 0.96],
      ['object', 'sand', 0.93, [0, 0.3, 1, 0.7]],
      ['attribute', 'high contrast', 0.72],
      ['scene', 'sky', 0.8, [0, 0, 1, 0.32]],
    ],
    rating: 5, flag: 'pick', gps: { lat: 31.0998, lon: -4.0133, place: 'Erg Chebbi, MA' },
  },
  {
    id: '_DSF2245', file: '_DSF2245.jpg', w: 1536, h: 1024, size: 442_787, folder: 'f-cabin',
    camera: 'X-T5', lens: 'XF 16mm f/1.4 R WR', iso: 200, aperture: 8, shutter: 1 / 500, focal: 16,
    when: ago(1, 13, 15), added: base - DAY,
    title: 'Cabin, first snow', caption: 'Imported yesterday — not indexed yet.',
    keywords: ['snow', 'cabin', 'winter', 'architecture', 'trip 2026'],
    detections: [
      ['object', 'cabin', 0.92, [0.3, 0.34, 0.4, 0.4]],
      ['scene', 'snow', 0.94],
      ['object', 'tree', 0.7, [0.02, 0.2, 0.24, 0.7]],
      ['attribute', 'overexposed highlights', 0.34],
    ],
    rating: 0,
  },
];

const FOLDERS: { id: string; name: string; path: string }[] = [
  { id: 'f-lofoten', name: '2026-09-14 Lofoten Coast', path: '/Volumes/Archive/2026/2026-09-14 Lofoten Coast' },
  { id: 'f-studio', name: '2026-09-18 Studio Portraits', path: '/Volumes/Archive/2026/2026-09-18 Studio Portraits' },
  { id: 'f-beach', name: '2026-09-22 Beach Run', path: '/Volumes/Archive/2026/2026-09-22 Beach Run' },
  { id: 'f-city', name: '2026-09-25 City Nights', path: '/Volumes/Archive/2026/2026-09-25 City Nights' },
  { id: 'f-macro', name: '2026-09-28 Garden Macro', path: '/Volumes/Archive/2026/2026-09-28 Garden Macro' },
  { id: 'f-river', name: '2026-10-01 River Kings', path: '/Volumes/Archive/2026/2026-10-01 River Kings' },
  { id: 'f-table', name: '2026-10-03 Table & Still Life', path: '/Volumes/Archive/2026/2026-10-03 Table' },
  { id: 'f-still', name: '2026-10-05 Product Shelf', path: '/Volumes/Archive/2026/2026-10-05 Product Shelf' },
  { id: 'f-desert', name: '2026-10-07 Desert Light', path: '/Volumes/Archive/2026/2026-10-07 Desert Light' },
  { id: 'f-cabin', name: '2026-10-08 Snow Cabin', path: '/Volumes/Archive/2026/2026-10-08 Snow Cabin' },
];

export const demoVolumes: Volume[] = [
  { id: 'v-archive', label: 'Archive (internal SSD)', online: true, uuid: 'A1B2-C3D4' },
  { id: 'v-sd', label: 'CFexpress B — 512 GB', online: false, uuid: 'E5F6-G7H8' },
];

export const demoFolders: Folder[] = FOLDERS.map((f) => ({
  id: f.id,
  name: f.name,
  path: f.path,
  volumeId: 'v-archive',
}));

export const demoPhotos: Photo[] = SEEDS.map((s) => ({
  id: s.id,
  folderId: s.folder,
  filename: s.file,
  ext: 'jpg',
  src: `${P}/${s.file}`,
  size: s.size,
  mtime: Date.parse(s.when),
  width: s.w,
  height: s.h,
  captureTime: s.when,
  addedTime: s.added,
  camera: s.camera,
  cameraSerial: `${s.camera.split(' ')[0]}-${(s.id.charCodeAt(0) * 977) % 99999}`,
  lens: s.lens,
  iso: s.iso,
  aperture: s.aperture,
  shutter: s.shutter,
  focalMm: s.focal,
  rating: s.rating ?? 0,
  flag: s.flag ?? 'none',
  colorLabel: s.label ?? 'none',
  gps: s.gps,
  title: s.title,
  caption: s.caption,
  copyright: '© 2026 Swell Demo Library',
  creator: 'Swell Demo',
  stackId: s.stack?.id,
  stackPosition: s.stack?.pos ?? 0,
  isVirtualCopy: false,
  importId: s.folder === 'f-cabin' ? 'imp-latest' : 'imp-sept',
  missing: false,
  hasEdits: !!s.edited,
  editedAt: s.edited ? s.added + DAY : 0,
  indexState: s.folder === 'f-cabin' ? 'pending' : 'indexed',
}));

export const demoKeywords: Keyword[] = (() => {
  const set = new Map<string, Keyword>();
  const parentOf: Record<string, string> = {
    portrait: 'people', headshot: 'people', expression: 'people',
    landscape: 'nature', fjord: 'nature', mountains: 'nature', beach: 'nature', river: 'nature',
    garden: 'nature', desert: 'nature', dunes: 'nature', snow: 'nature', winter: 'nature',
    dog: 'animals', bird: 'animals', kingfisher: 'animals', wildlife: 'animals', biscuit: 'animals',
    food: 'work', ramen: 'work', product: 'work', commercial: 'work', restaurant: 'work', still_life: 'work',
    city: 'place', night: 'place', street: 'place', tokyo: 'place', shibuya: 'place', architecture: 'place',
    studio: 'light', 'golden hour': 'light', backlit: 'light', neon: 'light', 'natural light': 'light',
    macro: 'technique', burst: 'technique', action: 'technique', square: 'technique', overhead: 'technique',
    minimal: 'technique', editorial: 'work', social: 'work', reflection: 'nature', rain: 'place',
    cabin: 'place', flower: 'nature', cosmos: 'nature', petal: 'nature', water: 'nature', sky: 'nature',
    sand: 'nature', perch: 'animals', steam: 'work', bowl: 'work', table: 'work', ceramic: 'work',
    mug: 'work', amara: 'people', ivo: 'people', beard: 'people', 'trip 2026': 'projects', norway: 'place',
    morocco: 'place', japan: 'place',
  };
  const add = (name: string, id?: string) => {
    const key = name.replace(/\s+/g, '_');
    if (!set.has(key)) {
      const parent = parentOf[key];
      set.set(key, {
        id: id ?? `kw-${key}`,
        name,
        parentId: parent ? `kw-${parent.replace(/\s+/g, '_')}` : undefined,
        synonyms: [],
        exportFlag: true,
      });
    }
  };
  for (const top of ['people', 'nature', 'animals', 'work', 'place', 'light', 'technique', 'projects']) add(top, `kw-${top}`);
  for (const s of SEEDS) for (const k of s.keywords) add(k);
  return [...set.values()];
})();

export const demoKeywordIndex: Record<string, string[]> = Object.fromEntries(
  SEEDS.map((s) => [s.id, s.keywords.map((k) => `kw-${k.replace(/\s+/g, '_')}`)]),
);

export const demoDetections: Detection[] = SEEDS.flatMap((s) =>
  s.detections.map(([kind, label, score, bbox], i) => ({
    id: `det-${s.id}-${i}`,
    photoId: s.id,
    kind: kind as Detection['kind'],
    label,
    score,
    bbox: bbox as [number, number, number, number] | undefined,
    modelVer: 'heuristic-1',
    provider: 'heuristic' as const,
  })),
);

export const demoCollections: Collection[] = [
  {
    id: 'col-quick',
    name: 'Quick Collection',
    kind: 'target',
    rules: [],
    match: 'all',
    photoIds: ['DSC_8421', '_MG_7744'],
    sortOrder: 'manual',
    createdAt: base - 30 * DAY,
  },
  {
    id: 'col-keepers',
    name: 'Keepers — client review',
    kind: 'manual',
    rules: [],
    match: 'all',
    photoIds: ['DSC_8421', '_MG_2233', 'DSC04513', '_MG_7744', 'DSC_1178'],
    sortOrder: 'manual',
    createdAt: base - 5 * DAY,
  },
  {
    id: 'col-smart-picks',
    name: '4★ and up',
    kind: 'smart',
    rules: [{ id: 'r1', field: 'rating', op: 'greaterThan', value: 3 }],
    match: 'all',
    photoIds: [],
    sortOrder: 'rating',
    createdAt: base - 12 * DAY,
  },
  {
    id: 'col-smart-people',
    name: 'Has people',
    kind: 'smart',
    rules: [{ id: 'r2', field: 'detected', op: 'contains', value: 'person' }],
    match: 'all',
    photoIds: [],
    sortOrder: 'captureTime',
    createdAt: base - 9 * DAY,
  },
  {
    id: 'col-smart-soft',
    name: 'Possibly soft',
    kind: 'smart',
    rules: [{ id: 'r3', field: 'sharpness', op: 'lessThan', value: 0.42 }],
    match: 'all',
    photoIds: [],
    sortOrder: 'captureTime',
    createdAt: base - 2 * DAY,
  },
  {
    id: 'col-set-2026',
    name: 'Trip 2026',
    kind: 'set',
    rules: [],
    match: 'all',
    photoIds: ['col-keepers'],
    sortOrder: 'manual',
    createdAt: base - 20 * DAY,
  },
];

export const demoStacks = ['st-amara', 'st-biscuit', 'st-ramen'];
