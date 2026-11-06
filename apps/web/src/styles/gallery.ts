/**
 * F1 Passe-partout / F7 fine-art family (docs/style-system-and-engine-plan.md §2).
 *
 * The photo sits in a mat window: ratio margins with a weighted ("drop")
 * bottom, an optional inner reveal band and bevel core line (the `mat`
 * layer), and a quiet caption locked to a register in the lower margin.
 */

import { isDarkBackground } from '../colorScheme';
import { defaultStyle, type FieldChip, type ImprintConfig, type LayerConfig } from '../types';
import type { KnobOption } from './knobs';
import { paramStyle, type KnobDef, type ParamStyle, type StyleBody } from './params';

export type GalleryStyleId = 'museum-mat' | 'double-reveal' | 'black-core' | 'float-mount' | 'signed-proof';

export type GalleryParams = {
  /** Mat / board / paper colour (the canvas background). */
  mat: string;
  /** Side and top margin as a ratio of the photo short edge. */
  width: number;
  core: 'white' | 'black' | 'none';
  /** Inner reveal band colour (double mat); '' for none. */
  reveal: string;
  details: boolean;
  title: string;
  edition: string;
};

type CaptionLayout = 'centered' | 'flush' | 'proof';

export const PAPER_SWATCHES: readonly KnobOption[] = [
  { value: '#F4F1EA', label: '暖白' },
  { value: '#FFFFFF', label: '纯白' },
  { value: '#E6E3DD', label: '石灰' },
  { value: '#2B2A28', label: '炭灰' },
  { value: '#111111', label: '黑' },
];

export const ACCENT_SWATCHES: readonly KnobOption[] = [
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

const CORE_COLORS = { white: '#FBFAF6', black: '#1B1B1B' } as const;
const CORE_WIDTH = { white: 0.0022, black: 0.0018 } as const;
const REVEAL_WIDTH = 0.0045;
const TITLE_SIZE = 0.0165;
const DETAIL_SIZE = 0.0092;
export const SERIF = 'NotoSerifCJKsc-Regular.otf' as const;
export const SERIF_BOLD = 'NotoSerifCJKsc-Bold.otf' as const;
export const SANS = 'NotoSansCJKsc-Regular.otf' as const;
export const SANS_BOLD = 'NotoSansCJKsc-Bold.otf' as const;
export const DETAIL_FIELDS: FieldChip['field_id'][] = ['camera_model', 'lens_model', 'focal_length', 'aperture', 'shutter', 'iso'];

export const round4 = (value: number) => Math.round(value * 10000) / 10000;
export const chips = (fields: readonly FieldChip['field_id'][]): FieldChip[] => fields.map((field_id) => ({ field_id }));
export const literal = (text: string): FieldChip[] => [{ field_id: 'custom_text', custom_text: text }];

/** Caption ink for a paper colour: a title tone and a quieter detail tone. */
export function paperInk(paper: string) {
  return isDarkBackground(paper)
    ? { title: '#ECE8E0', detail: '#9C978E', rule: '#6E6A63' }
    : { title: '#34312C', detail: '#8C877E', rule: '#B9B3A8' };
}

/** Shared canvas block for ratio-margin styles. */
export function ratioCanvas(background: string, margins: { top: number; right: number; bottom: number; left: number }, extra: Partial<ImprintConfig['canvas']> = {}): ImprintConfig['canvas'] {
  return {
    margins: { top: round4(margins.top), right: round4(margins.right), bottom: round4(margins.bottom), left: round4(margins.left) },
    margin_unit: 'short_edge_ratio',
    background,
    border_radius: 0,
    border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
    ...extra,
  };
}

interface GallerySpec { drop: number; layout: CaptionLayout; float: boolean; bevel: boolean; defaults: GalleryParams }

const base: GalleryParams = { mat: '#F4F1EA', width: 0.14, core: 'none', reveal: '', details: true, title: '', edition: '' };

const SPECS: Record<GalleryStyleId, GallerySpec> = {
  'museum-mat': { drop: 1.3, layout: 'centered', float: false, bevel: true, defaults: { ...base, core: 'white' } },
  'double-reveal': { drop: 1.3, layout: 'centered', float: false, bevel: true, defaults: { ...base, width: 0.15, core: 'white', reveal: '#6B2E2A' } },
  'black-core': { drop: 1.25, layout: 'centered', float: false, bevel: false, defaults: { ...base, mat: '#FAFAF8', width: 0.16, core: 'black' } },
  'float-mount': { drop: 1.35, layout: 'flush', float: true, bevel: false, defaults: { ...base, mat: '#E9E6E0', width: 0.11 } },
  'signed-proof': { drop: 1.7, layout: 'proof', float: false, bevel: false, defaults: { ...base, mat: '#FFFFFF', width: 0.09, edition: '1/25' } },
};

function captionLayers(spec: GallerySpec, p: GalleryParams): LayerConfig[] {
  const bottom = p.width * spec.drop;
  const colors = paperInk(p.mat);
  const title = (anchor: string, offsetX: number, offsetY: number, maxWidth: number): LayerConfig => ({
    id: 'caption-title', kind: 'text', box: 'margin-bottom', anchor, offset_x: round4(offsetX), offset_y: round4(offsetY), max_width: maxWidth,
    size: TITLE_SIZE,
    content: { chips: literal(p.title), separator: ' ' },
    style: { font_family: SERIF, bold: false, color: colors.title, tracking: 20 },
  });
  const details = (anchor: string, offsetX: number, offsetY: number, maxWidth: number): LayerConfig => ({
    id: 'caption-details', kind: 'text', box: 'margin-bottom', anchor, offset_x: round4(offsetX), offset_y: round4(offsetY), max_width: maxWidth,
    size: DETAIL_SIZE,
    content: { chips: chips(DETAIL_FIELDS), separator: '  ·  ' },
    style: { font_family: SANS, bold: false, color: colors.detail, tracking: 40 },
  });
  const row = bottom * 0.26;
  const layers: LayerConfig[] = [];
  if (p.title) {
    if (spec.layout === 'centered') layers.push(title('top-center', 0, row, 0.7));
    else if (spec.layout === 'flush') layers.push(title('top-left', p.width, row, 0.45));
    else layers.push(title('top-center', 0, row, 0.4));
  }
  if (spec.layout === 'proof' && p.edition) {
    layers.push({
      id: 'caption-edition', kind: 'text', box: 'margin-bottom', anchor: 'top-left', offset_x: round4(p.width), offset_y: round4(row), max_width: 0.25,
      size: TITLE_SIZE * 0.9,
      content: { chips: literal(p.edition), separator: ' ' },
      style: { font_family: SERIF, bold: false, color: colors.title, tracking: 80 },
    });
  }
  if (p.details) {
    const level = row + (TITLE_SIZE - DETAIL_SIZE) / 2;
    if (spec.layout === 'centered') layers.push(details('top-center', 0, p.title ? row + TITLE_SIZE * 2 : row, 0.7));
    else layers.push(details('top-right', -p.width, level, spec.layout === 'flush' ? 0.45 : 0.3));
  }
  return layers;
}

function construct(spec: GallerySpec) {
  return (p: GalleryParams): StyleBody => {
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
      canvas: ratioCanvas(p.mat, { top: p.width, right: p.width, bottom: p.width * spec.drop, left: p.width },
        spec.float ? { effect: { background: 'solid', photo_radius: 0, shadow: true } } : {}),
      regions: [],
      defaults: defaultStyle,
      custom_text: '',
      logo_position: 'right',
      layers,
    };
  };
}

function knobsFor(id: GalleryStyleId): KnobDef<GalleryParams>[] {
  const paperLabel = id === 'float-mount' ? '底板颜色' : id === 'signed-proof' ? '纸色' : '卡纸颜色';
  const widthLabel = id === 'float-mount' || id === 'signed-proof' ? '留白' : '卡纸宽度';
  const defs: KnobDef<GalleryParams>[] = [{ kind: 'swatch', key: 'mat', label: paperLabel, options: PAPER_SWATCHES }];
  if (id === 'double-reveal') defs.push({ kind: 'swatch', key: 'reveal', label: '内衬颜色', options: ACCENT_SWATCHES });
  defs.push({ kind: 'range', key: 'width', label: widthLabel, min: 0.06, max: 0.25, step: 0.005 });
  if (id === 'museum-mat') defs.push({ kind: 'choice', key: 'core', label: '斜切芯线', options: CORE_OPTIONS });
  defs.push({ kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 160 });
  if (id === 'signed-proof') defs.push({ kind: 'text', key: 'edition', label: '版次', placeholder: '1/25、AP 1/3', maxLength: 40 });
  defs.push({ kind: 'toggle', key: 'details', label: '拍摄参数' });
  return defs;
}

export const GALLERY_STYLES: Record<GalleryStyleId, ParamStyle<GalleryParams>> = Object.fromEntries(
  (Object.keys(SPECS) as GalleryStyleId[]).map((id) => [id, paramStyle(id, SPECS[id].defaults, construct(SPECS[id]), knobsFor(id))]),
) as Record<GalleryStyleId, ParamStyle<GalleryParams>>;
