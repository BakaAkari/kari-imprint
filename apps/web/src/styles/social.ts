/**
 * F4 Social canvas and F9 colour-derived families
 * (docs/style-system-and-engine-plan.md §2): fixed-aspect canvases that never
 * crop the photo, platform safe areas, and colours taken from the photo
 * palette (`@palette_N[:tone]`, resolved at paint time from the palette fields).
 */

import { defaultStyle, type FieldChip, type ImprintConfig, type LayerConfig } from '../types';
import type { KnobOption } from './knobs';
import { paramStyle, type ParamStyle, type StyleBody } from './params';
import { chips, literal, paperInk, ratioCanvas, round4, SANS, SERIF, SERIF_BOLD } from './gallery';

export type SocialStyleId = 'no-crop' | 'story-card' | 'palette-card' | 'tonal-mat';

const SETTINGS: FieldChip['field_id'][] = ['focal_length', 'aperture', 'shutter', 'iso'];
type TextStyle = NonNullable<Extract<LayerConfig, { kind: 'text' }>['style']>;
type Box = Extract<LayerConfig, { kind: 'text' }>['box'];

function text(id: string, box: Box, anchor: string, x: number, y: number, size: number, content: FieldChip[], style: TextStyle, maxWidth?: number, separator = '  ·  '): LayerConfig {
  return {
    id, kind: 'text', box, anchor, offset_x: round4(x), offset_y: round4(y), size: round4(size),
    ...(maxWidth ? { max_width: maxWidth } : {}),
    content: { chips: content, separator }, style,
  };
}

const RATIOS: Record<string, [number, number]> = { '4:5': [4, 5], '1:1': [1, 1], '3:4': [3, 4], '9:16': [9, 16] };

type Ground = 'white' | 'black' | 'tone' | 'blur';
const GROUNDS: readonly KnobOption[] = [
  { value: 'white', label: '白' }, { value: 'black', label: '黑' }, { value: 'tone', label: '取色' }, { value: 'blur', label: '模糊' },
];

/** Canvas + background layer for a ground choice; ink follows the ground. */
function ground(kind: string, margins: number, extra: Partial<ImprintConfig['canvas']>) {
  const dark = kind === 'black' || kind === 'blur';
  const canvas = ratioCanvas(dark ? '#111111' : '#FFFFFF', { top: margins, right: margins, bottom: margins, left: margins }, {
    ...extra,
    ...(kind === 'blur' ? { effect: { background: 'blur' as const, photo_radius: 0, shadow: true } } : {}),
  });
  const layers: LayerConfig[] = kind === 'tone' ? [{ id: 'ground', kind: 'fill', box: 'canvas', color: '@palette_1:pale' }] : [];
  const ink = dark ? { title: '#F2F2F2', detail: '#A8A8A8' } : { title: '#2A2A2A', detail: '#7A7A7A' };
  return { canvas, layers, ink };
}

function body(canvas: ImprintConfig['canvas'], layers: LayerConfig[]): StyleBody {
  return { canvas, regions: [], defaults: defaultStyle, custom_text: '', logo_position: 'right', layers };
}

// ── No-crop: the photo uncropped on a fixed-aspect canvas ──

type NoCropParams = { ratio: string; ground: string; caption: boolean };

function noCrop(p: NoCropParams): StyleBody {
  const g = ground(p.ground as Ground, 0.035, { frame_aspect: { ratio: RATIOS[p.ratio] ?? [4, 5], align: 'center' } });
  const layers = [...g.layers];
  if (p.caption) layers.push(text('caption', 'margin-bottom', 'middle-center', 0, 0, 0.0145, chips(['camera_model', ...SETTINGS]),
    { font_family: SANS, bold: false, color: g.ink.detail, tracking: 60 }, 0.9));
  return body(g.canvas, layers);
}

// ── Story card: 9:16 with the Instagram Story safe area holding the title ──

type StoryParams = { ground: string; title: string; details: boolean };

function story(p: StoryParams): StyleBody {
  const g = ground(p.ground as Ground, 0.05, { frame_aspect: { ratio: [9, 16], align: 'center' }, safe_area: 'ig-story' });
  const layers = [...g.layers];
  if (p.title) layers.push(text('story-title', 'safe', 'top-center', 0, 0.02, 0.05, literal(p.title), { font_family: SERIF_BOLD, bold: true, color: g.ink.title, tracking: -10 }, 0.9));
  if (p.details) layers.push(text('story-details', 'safe', 'top-center', 0, p.title ? 0.095 : 0.02, 0.016, chips(['camera_model', ...SETTINGS]),
    { font_family: SANS, bold: false, color: g.ink.detail, tracking: 80 }, 0.9));
  return body(g.canvas, layers);
}

// ── Palette card: the photo and its colour swatches with hex codes ──

type PaletteParams = { paper: string; count: string; labels: boolean; title: string };

function paletteCard(p: PaletteParams): StyleBody {
  const ink = paperInk(p.paper);
  const side = 0.05, swatch = 0.085, gap = 0.016;
  const count = Math.max(3, Math.min(6, Number(p.count) || 6));
  const layers: LayerConfig[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = side + i * (swatch + gap);
    layers.push({ id: `swatch-${i + 1}`, kind: 'rect', box: 'margin-bottom', anchor: 'top-left', offset_x: round4(x), offset_y: 0.05, w: swatch, h: swatch, color: `@palette_${i + 1}` });
    if (p.labels) layers.push(text(`swatch-${i + 1}-hex`, 'margin-bottom', 'top-left', x, 0.05 + swatch + 0.014, 0.0092,
      [{ field_id: `palette_${i + 1}` as FieldChip['field_id'] }], { font_family: SANS, bold: false, color: ink.detail, tracking: 60 }, 0.12));
  }
  if (p.title) layers.push(text('palette-title', 'margin-bottom', 'top-right', -side, 0.05, 0.022, literal(p.title), { font_family: SERIF, bold: false, color: ink.title }, 0.4));
  layers.push(text('palette-details', 'margin-bottom', 'top-right', -side, p.title ? 0.084 : 0.05, 0.0098, chips(['camera_model', 'lens_model']),
    { font_family: SANS, bold: false, color: ink.detail, tracking: 40 }, 0.4));
  return body(ratioCanvas(p.paper, { top: side, right: side, bottom: 0.24, left: side }), layers);
}

// ── Tonal mat: a gallery mat whose board and reveal come from the photo ──

type TonalParams = { tone: string; width: number; reveal: boolean; title: string; details: boolean };

function tonalMat(p: TonalParams): StyleBody {
  const w = p.width, bottom = w * 1.3;
  const layers: LayerConfig[] = [
    { id: 'board', kind: 'fill', box: 'canvas', color: `@palette_1:${p.tone === 'soft' ? 'soft' : 'pale'}` },
    { id: 'mat', kind: 'mat', reveal: p.reveal ? { width: 0.0045, color: '@palette_2:deep' } : null, core: { width: 0.0022, color: '#FBFAF6', bevel: true } },
  ];
  const row = bottom * 0.26;
  if (p.title) layers.push(text('caption-title', 'margin-bottom', 'top-center', 0, row, 0.0165, literal(p.title), { font_family: SERIF, bold: false, color: '#2E2B27', tracking: 20 }, 0.7));
  if (p.details) layers.push(text('caption-details', 'margin-bottom', 'top-center', 0, p.title ? row + 0.033 : row, 0.0092,
    chips(['camera_model', 'lens_model', ...SETTINGS]), { font_family: SANS, bold: false, color: '#5E5A53', tracking: 40 }, 0.7));
  return body(ratioCanvas('#F4F1EA', { top: w, right: w, bottom, left: w }), layers);
}

const RATIO_OPTIONS: readonly KnobOption[] = Object.keys(RATIOS).map((value) => ({ value, label: value }));
const PAPERS: readonly KnobOption[] = [{ value: '#FFFFFF', label: '白' }, { value: '#F2EFE8', label: '米白' }, { value: '#151515', label: '黑' }];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each style has its own parameter shape
export const SOCIAL_STYLES: Record<SocialStyleId, ParamStyle<any>> = {
  'no-crop': paramStyle<NoCropParams>('no-crop', { ratio: '4:5', ground: 'white', caption: false }, noCrop, [
    { kind: 'choice', key: 'ratio', label: '画布比例', options: RATIO_OPTIONS },
    { kind: 'choice', key: 'ground', label: '底色', options: GROUNDS },
    { kind: 'toggle', key: 'caption', label: '参数小字' },
  ]),
  'story-card': paramStyle<StoryParams>('story-card', { ground: 'tone', title: 'Untitled', details: true }, story, [
    { kind: 'choice', key: 'ground', label: '底色', options: GROUNDS },
    { kind: 'text', key: 'title', label: '标题', placeholder: '可留空', maxLength: 60 },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
  'palette-card': paramStyle<PaletteParams>('palette-card', { paper: '#FFFFFF', count: '6', labels: true, title: '' }, paletteCard, [
    { kind: 'swatch', key: 'paper', label: '纸色', options: PAPERS },
    { kind: 'choice', key: 'count', label: '色块数', options: [{ value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' }] },
    { kind: 'toggle', key: 'labels', label: '色值' },
    { kind: 'text', key: 'title', label: '标题', placeholder: '可留空', maxLength: 60 },
  ]),
  'tonal-mat': paramStyle<TonalParams>('tonal-mat', { tone: 'pale', width: 0.14, reveal: true, title: '', details: true }, tonalMat, [
    { kind: 'choice', key: 'tone', label: '卡纸色调', options: [{ value: 'pale', label: '浅' }, { value: 'soft', label: '中' }] },
    { kind: 'range', key: 'width', label: '卡纸宽度', min: 0.06, max: 0.25, step: 0.005 },
    { kind: 'toggle', key: 'reveal', label: '取色内衬' },
    { kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 160 },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
};
