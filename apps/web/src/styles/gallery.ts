/**
 * F1 Passe-partout / F7 fine-art family (docs/style-system-and-engine-plan.md §2).
 *
 * The photo sits in a mat window: ratio margins with a weighted ("drop")
 * bottom, an optional inner reveal band and bevel core line (the `mat`
 * layer), and a quiet caption locked to a register in the lower margin.
 * Every style is rebuilt from a few parameters, so its knobs stay simple and
 * a photo's exception patch against the album look stays small.
 */

import { isDarkBackground } from '../colorScheme';
import { defaultStyle, type FieldChip, type ImprintConfig, type LayerConfig } from '../types';
import type { KnobOption, StyleKnob } from './knobs';

export type GalleryStyleId = 'museum-mat' | 'double-reveal' | 'black-core' | 'float-mount' | 'signed-proof';
export type CoreKind = 'white' | 'black' | 'none';

export interface GalleryParams {
  /** Mat / board / paper colour (the canvas background). */
  mat: string;
  /** Side and top margin as a ratio of the photo short edge. */
  width: number;
  core: CoreKind;
  /** Inner reveal band colour (double mat), or null. */
  reveal: string | null;
  details: boolean;
  /** Caption title; stored as config.custom_text so per-photo exceptions stay readable. */
  title: string;
  edition: string;
}

type CaptionLayout = 'centered' | 'flush' | 'proof';

interface GallerySpec {
  drop: number;
  layout: CaptionLayout;
  float: boolean;
  bevel: boolean;
  defaults: GalleryParams;
}

export const MAT_SWATCHES: readonly KnobOption[] = [
  { value: '#F4F1EA', label: '暖白' },
  { value: '#FFFFFF', label: '纯白' },
  { value: '#E6E3DD', label: '石灰' },
  { value: '#2B2A28', label: '炭灰' },
  { value: '#111111', label: '黑' },
];

export const REVEAL_SWATCHES: readonly KnobOption[] = [
  { value: '#6B2E2A', label: '酒红' },
  { value: '#2F3E4C', label: '石板蓝' },
  { value: '#4E5A3A', label: '橄榄' },
  { value: '#9A7438', label: '赭石' },
  { value: '#1C1C1C', label: '黑' },
];

const CORE_OPTIONS: readonly KnobOption[] = [
  { value: 'white', label: '白芯' },
  { value: 'black', label: '黑芯' },
  { value: 'none', label: '无' },
];

const base = { core: 'none' as CoreKind, reveal: null, details: true, title: '', edition: '' };

export const GALLERY_SPECS: Record<GalleryStyleId, GallerySpec> = {
  'museum-mat': { drop: 1.3, layout: 'centered', float: false, bevel: true, defaults: { ...base, mat: '#F4F1EA', width: 0.14, core: 'white' } },
  'double-reveal': { drop: 1.3, layout: 'centered', float: false, bevel: true, defaults: { ...base, mat: '#F4F1EA', width: 0.15, core: 'white', reveal: '#6B2E2A' } },
  'black-core': { drop: 1.25, layout: 'centered', float: false, bevel: false, defaults: { ...base, mat: '#FAFAF8', width: 0.16, core: 'black' } },
  'float-mount': { drop: 1.35, layout: 'flush', float: true, bevel: false, defaults: { ...base, mat: '#E9E6E0', width: 0.11 } },
  'signed-proof': { drop: 1.7, layout: 'proof', float: false, bevel: false, defaults: { ...base, mat: '#FFFFFF', width: 0.09, edition: '1/25' } },
};

const CORE_COLORS: Record<Exclude<CoreKind, 'none'>, string> = { white: '#FBFAF6', black: '#1B1B1B' };
const CORE_WIDTH = { white: 0.0022, black: 0.0018 } as const;
const REVEAL_WIDTH = 0.0045;
const TITLE_SIZE = 0.0165;
const DETAIL_SIZE = 0.0092;
const SERIF = 'NotoSerifCJKsc-Regular.otf' as const;
const SANS = 'NotoSansCJKsc-Regular.otf' as const;
const DETAIL_FIELDS: FieldChip[] = ['camera_model', 'lens_model', 'focal_length', 'aperture', 'shutter', 'iso'].map((field_id) => ({ field_id: field_id as FieldChip['field_id'] }));

const round4 = (value: number) => Math.round(value * 10000) / 10000;

function ink(mat: string) {
  return isDarkBackground(mat)
    ? { title: '#ECE8E0', detail: '#9C978E' }
    : { title: '#34312C', detail: '#8C877E' };
}

function captionLayers(spec: GallerySpec, p: GalleryParams): LayerConfig[] {
  const bottom = p.width * spec.drop;
  const colors = ink(p.mat);
  const title = (anchor: string, offsetX: number, offsetY: number, maxWidth?: number): LayerConfig => ({
    id: 'caption-title', kind: 'text', box: 'margin-bottom', anchor, offset_x: round4(offsetX), offset_y: round4(offsetY),
    ...(maxWidth ? { max_width: maxWidth } : {}),
    size: TITLE_SIZE,
    content: { chips: [{ field_id: 'custom_text' }], separator: ' ' },
    style: { font_family: SERIF, bold: false, color: colors.title, tracking: 20 },
  });
  const details = (anchor: string, offsetX: number, offsetY: number, maxWidth: number): LayerConfig => ({
    id: 'caption-details', kind: 'text', box: 'margin-bottom', anchor, offset_x: round4(offsetX), offset_y: round4(offsetY), max_width: maxWidth,
    size: DETAIL_SIZE,
    content: { chips: DETAIL_FIELDS.map((chip) => ({ ...chip })), separator: '  ·  ' },
    style: { font_family: SANS, bold: false, color: colors.detail, tracking: 40 },
  });
  const row = bottom * 0.26;
  const layers: LayerConfig[] = [];
  if (spec.layout === 'centered') {
    layers.push(title('top-center', 0, row, 0.7));
    if (p.details) layers.push(details('top-center', 0, row + TITLE_SIZE * 2, 0.7));
  } else if (spec.layout === 'flush') {
    layers.push(title('top-left', p.width, row, 0.45));
    if (p.details) layers.push(details('top-right', -p.width, row + (TITLE_SIZE - DETAIL_SIZE) / 2, 0.45));
  } else {
    // An empty edition chip would fall back to the title (custom_text), so omit the layer.
    if (p.edition) layers.push({
      id: 'caption-edition', kind: 'text', box: 'margin-bottom', anchor: 'top-left', offset_x: round4(p.width), offset_y: round4(row), max_width: 0.25,
      size: TITLE_SIZE * 0.9,
      content: { chips: [{ field_id: 'custom_text', custom_text: p.edition }], separator: ' ' },
      style: { font_family: SERIF, bold: false, color: colors.title, tracking: 80 },
    });
    layers.push(title('top-center', 0, row, 0.4));
    if (p.details) layers.push(details('top-right', -p.width, row + (TITLE_SIZE - DETAIL_SIZE) / 2, 0.3));
  }
  return layers;
}

export function buildGallery(id: GalleryStyleId, params?: Partial<GalleryParams>): ImprintConfig {
  const spec = GALLERY_SPECS[id];
  const p: GalleryParams = { ...spec.defaults, ...params };
  const w = round4(p.width);
  const layers: LayerConfig[] = [];
  if (p.core !== 'none' || p.reveal) {
    layers.push({
      id: 'mat', kind: 'mat',
      reveal: p.reveal ? { width: REVEAL_WIDTH, color: p.reveal } : null,
      core: p.core !== 'none' ? { width: CORE_WIDTH[p.core], color: CORE_COLORS[p.core], bevel: spec.bevel } : null,
    });
  }
  layers.push(...captionLayers(spec, p));
  return {
    schema_version: 3,
    style_id: id,
    canvas: {
      margins: { top: w, right: w, bottom: round4(p.width * spec.drop), left: w },
      margin_unit: 'short_edge_ratio',
      background: p.mat,
      border_radius: 0,
      border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
      ...(spec.float ? { effect: { background: 'solid' as const, photo_radius: 0, shadow: true } } : {}),
    },
    regions: [],
    defaults: defaultStyle,
    custom_text: p.title,
    logo_position: 'right',
    layers,
  };
}

/** Recover the parameters a gallery config was built from. */
export function readGallery(id: GalleryStyleId, config: ImprintConfig): GalleryParams {
  const spec = GALLERY_SPECS[id];
  const layers = config.layers ?? [];
  const mat = layers.find((layer) => layer.kind === 'mat');
  const core = mat && mat.kind === 'mat' ? mat.core : null;
  const edition = layers.find((layer) => layer.id === 'caption-edition');
  return {
    mat: config.canvas.background,
    width: config.canvas.margin_unit === 'short_edge_ratio' ? config.canvas.margins.left : spec.defaults.width,
    core: core ? (isDarkBackground(core.color) ? 'black' : 'white') : 'none',
    reveal: mat && mat.kind === 'mat' ? mat.reveal?.color ?? null : null,
    details: layers.some((layer) => layer.id === 'caption-details'),
    title: config.custom_text ?? '',
    edition: edition && edition.kind === 'text' ? edition.content.chips[0]?.custom_text ?? '' : '',
  };
}

/** Rebuild with one parameter changed, keeping parts the style does not own (the signature). */
function rebuild(id: GalleryStyleId, config: ImprintConfig, patch: Partial<GalleryParams>): ImprintConfig {
  const next = buildGallery(id, { ...readGallery(id, config), ...patch });
  return { ...next, regions: config.regions.filter((region) => region.type === 'free') };
}

export function galleryKnobs(id: GalleryStyleId): StyleKnob[] {
  const param = <K extends keyof GalleryParams>(key: K) => ({
    get: (config: ImprintConfig) => readGallery(id, config)[key],
    set: (config: ImprintConfig, value: GalleryParams[K]) => rebuild(id, config, { [key]: value } as Partial<GalleryParams>),
  });
  const matLabel = id === 'float-mount' ? '底板颜色' : id === 'signed-proof' ? '纸色' : '卡纸颜色';
  const widthLabel = id === 'float-mount' || id === 'signed-proof' ? '留白' : '卡纸宽度';
  const knobs: StyleKnob[] = [
    { id: 'mat', kind: 'swatch', label: matLabel, options: MAT_SWATCHES, ...param('mat') },
  ];
  if (id === 'double-reveal') knobs.push({ id: 'reveal', kind: 'swatch', label: '内衬颜色', options: REVEAL_SWATCHES, ...param('reveal') } as StyleKnob);
  knobs.push({ id: 'width', kind: 'range', label: widthLabel, min: 0.06, max: 0.25, step: 0.005, ...param('width') });
  if (id === 'museum-mat') knobs.push({ id: 'core', kind: 'choice', label: '斜切芯线', options: CORE_OPTIONS, ...param('core') } as StyleKnob);
  knobs.push({ id: 'title', kind: 'text', label: '标题', placeholder: '作品标题', maxLength: 160, ...param('title') });
  if (id === 'signed-proof') knobs.push({ id: 'edition', kind: 'text', label: '版次', placeholder: '1/25、AP 1/3', maxLength: 40, ...param('edition') });
  knobs.push({ id: 'details', kind: 'toggle', label: '拍摄参数', ...param('details') });
  return knobs.slice(0, 5);
}
