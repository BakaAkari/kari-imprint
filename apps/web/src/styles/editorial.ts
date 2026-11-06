/**
 * F2 Editorial / magazine family (docs/style-system-and-engine-plan.md §2).
 *
 * The photo is laid out as a page: display type, hairlines and an
 * asymmetric grid carry the hierarchy instead of boxes and shadows.
 */

import { defaultStyle, type FieldChip, type LayerConfig } from '../types';
import type { KnobOption } from './knobs';
import { paramStyle, type ParamStyle, type StyleBody } from './params';
import { chips, literal, paperInk, ratioCanvas, round4, SANS, SANS_BOLD, SERIF, SERIF_BOLD } from './gallery';

export type EditorialStyleId = 'masthead' | 'plate' | 'swiss-grid' | 'colophon';

const PAPERS: readonly KnobOption[] = [
  { value: '#F2EFE8', label: '新闻纸' },
  { value: '#FBFAF7', label: '书页白' },
  { value: '#FFFFFF', label: '纯白' },
  { value: '#1A1A1A', label: '墨黑' },
];

const SWISS_ACCENTS: readonly KnobOption[] = [
  { value: '#D8392B', label: '瑞士红' },
  { value: '#1F4FB8', label: '钴蓝' },
  { value: '#E8B32A', label: '铬黄' },
  { value: '#111111', label: '黑' },
];

const SETTINGS: FieldChip['field_id'][] = ['focal_length', 'aperture', 'shutter', 'iso'];
const dated = (format: NonNullable<FieldChip['format']>): FieldChip[] => [{ field_id: 'datetime', format }];

type TextStyle = NonNullable<Extract<LayerConfig, { kind: 'text' }>['style']>;
function text(id: string, box: Extract<LayerConfig, { kind: 'text' }>['box'], anchor: string, x: number, y: number, size: number,
  content: FieldChip[], style: TextStyle, maxWidth?: number, separator = '  ·  '): LayerConfig {
  return {
    id, kind: 'text', box, anchor, offset_x: round4(x), offset_y: round4(y), size: round4(size),
    ...(maxWidth ? { max_width: maxWidth } : {}),
    content: { chips: content, separator }, style,
  };
}

function body(background: string, margins: { top: number; right: number; bottom: number; left: number }, layers: LayerConfig[]): StyleBody {
  return { canvas: ratioCanvas(background, margins), regions: [], defaults: defaultStyle, custom_text: '', logo_position: 'right', layers };
}

// ── Masthead: a big title above the photo, a hairline, a folio line below ──

type MastheadParams = { paper: string; title: string; kicker: string; title_size: number; details: boolean };

function masthead(p: MastheadParams): StyleBody {
  const ink = paperInk(p.paper);
  const side = 0.075;
  const titleSize = p.title_size;
  const top = round4(0.07 + titleSize * 1.25 + 0.05);
  const layers: LayerConfig[] = [
    { id: 'masthead-rule', kind: 'rule', box: 'photo', edge: 'top', offset: 0.024, width: 0.0012, color: ink.title },
    text('masthead-title', 'margin-top', 'bottom-left', side, -0.042, titleSize, literal(p.title), { font_family: SERIF_BOLD, bold: true, color: ink.title, tracking: -15 }, 0.85),
    text('masthead-kicker', 'margin-top', 'bottom-left', side, -(0.042 + titleSize * 1.22 + 0.006), 0.0115,
      p.kicker ? literal(p.kicker) : dated('month-year'), { font_family: SANS_BOLD, bold: true, color: ink.detail, tracking: 220, text_case: 'upper' }, 0.85),
    text('folio-date', 'margin-bottom', 'top-left', side, 0.032, 0.0105, dated('long'), { font_family: SERIF, bold: false, color: ink.title, tracking: 10 }, 0.4),
  ];
  if (p.details) {
    layers.push(text('folio-details', 'margin-bottom', 'top-right', -side, 0.033, 0.0095, chips(['camera_model', 'lens_model', ...SETTINGS]),
      { font_family: SANS, bold: false, color: ink.detail, tracking: 40 }, 0.55));
  }
  return body(p.paper, { top, right: side, bottom: 0.11, left: side }, layers);
}

// ── Plate: a book plate with a tracked plate number and a serif title ──

type PlateParams = { paper: string; plate: string; title: string; width: number; details: boolean };

function plate(p: PlateParams): StyleBody {
  const ink = paperInk(p.paper);
  const w = p.width;
  const layers: LayerConfig[] = [];
  if (p.plate) layers.push(text('plate-number', 'margin-bottom', 'top-left', w, 0.042, 0.0098, literal(`PLATE ${p.plate}`),
    { font_family: SANS_BOLD, bold: true, color: ink.detail, tracking: 260 }, 0.4));
  layers.push(text('plate-title', 'margin-bottom', 'top-left', w, p.plate ? 0.064 : 0.042, 0.021, literal(p.title),
    { font_family: SERIF, bold: false, color: ink.title, tracking: 0 }, 0.6));
  if (p.details) {
    layers.push(text('plate-details', 'margin-bottom', 'top-left', w, p.plate ? 0.101 : 0.079, 0.0094, chips(['camera_model', 'lens_model', ...SETTINGS]),
      { font_family: SANS, bold: false, color: ink.detail, tracking: 30 }, 0.7));
  }
  return body(p.paper, { top: w, right: w, bottom: round4(w + 0.12), left: w }, layers);
}

// ── Swiss grid: a wide text column, an accent bar, grotesk title, a fact list ──

type SwissParams = { paper: string; accent: string; title: string; side: string; details: boolean };

function swiss(p: SwissParams): StyleBody {
  const ink = paperInk(p.paper);
  const column = 0.44;
  const gutter = 0.05;
  const left = p.side !== 'right';
  // The column sits in the wide margin; text starts one gutter in from the photo-side edge of the canvas.
  const box = left ? 'margin-left' : 'margin-right';
  const x = gutter;
  const layers: LayerConfig[] = [
    { id: 'swiss-bar', kind: 'rect', box, anchor: 'top-left', offset_x: x, w: 0.06, h: 0.007, color: p.accent },
    text('swiss-title', box, 'top-left', x, 0.035, 0.074, literal(p.title), { font_family: SANS_BOLD, bold: true, color: ink.title, tracking: -30 }, 0.82),
  ];
  if (p.details) {
    const rows: [string, FieldChip[], boolean][] = [
      ['swiss-camera', chips(['camera_model']), true],
      ['swiss-lens', chips(['lens_model']), false],
      ['swiss-settings', chips(SETTINGS), false],
      ['swiss-date', dated('date'), false],
    ];
    const step = 0.021;
    rows.forEach(([id, content, strong], index) => {
      const fromBottom = (rows.length - 1 - index) * step;
      layers.push(text(id, box, 'bottom-left', x, -fromBottom, 0.0118, content,
        { font_family: strong ? SANS_BOLD : SANS, bold: strong, color: strong ? ink.title : ink.detail, tracking: 10 }, 0.8, '   '));
    });
  }
  const m = 0.05;
  return body(p.paper, { top: m, right: left ? m : column, bottom: m, left: left ? column : m }, layers);
}

// ── Colophon: title, hairline, and a label/value table under the photo ──

type ColophonParams = { paper: string; title: string; details: boolean };

function colophon(p: ColophonParams): StyleBody {
  const ink = paperInk(p.paper);
  const side = 0.08;
  const layers: LayerConfig[] = [
    { id: 'colophon-rule', kind: 'rule', box: 'photo', edge: 'bottom', offset: 0.034, width: 0.001, color: ink.rule },
    text('colophon-title', 'margin-bottom', 'top-left', side, 0.056, 0.022, literal(p.title), { font_family: SERIF, bold: false, color: ink.title }, 0.84),
  ];
  if (p.details) {
    const rows: [string, string, FieldChip[]][] = [
      ['camera', 'CAMERA', chips(['camera_model'])],
      ['lens', 'LENS', chips(['lens_model'])],
      ['exposure', 'EXPOSURE', chips(SETTINGS)],
      ['date', 'DATE', dated('long')],
    ];
    rows.forEach(([id, label, content], index) => {
      const y = 0.102 + index * 0.024;
      layers.push(text(`colophon-${id}-label`, 'margin-bottom', 'top-left', side, y + 0.0015, 0.0082, literal(label),
        { font_family: SANS_BOLD, bold: true, color: ink.detail, tracking: 180 }, 0.2));
      layers.push(text(`colophon-${id}`, 'margin-bottom', 'top-left', side + 0.12, y, 0.0112, content,
        { font_family: SERIF, bold: false, color: ink.title }, 0.6, '   '));
    });
  }
  return body(p.paper, { top: side, right: side, bottom: p.details ? 0.23 : 0.12, left: side }, layers);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each style has its own parameter shape
export const EDITORIAL_STYLES: Record<EditorialStyleId, ParamStyle<any>> = {
  masthead: paramStyle<MastheadParams>('masthead', { paper: '#F2EFE8', title: 'Untitled', kicker: '', title_size: 0.072, details: true }, masthead, [
    { kind: 'swatch', key: 'paper', label: '纸色', options: PAPERS },
    { kind: 'text', key: 'title', label: '刊头标题', placeholder: 'Field Notes', maxLength: 60 },
    { kind: 'text', key: 'kicker', label: '期号行', placeholder: '留空则显示拍摄月份', maxLength: 60 },
    { kind: 'range', key: 'title_size', label: '标题字号', min: 0.045, max: 0.11, step: 0.005 },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
  plate: paramStyle<PlateParams>('plate', { paper: '#FBFAF7', plate: '1', title: 'Untitled', width: 0.11, details: true }, plate, [
    { kind: 'swatch', key: 'paper', label: '纸色', options: PAPERS },
    { kind: 'text', key: 'plate', label: '图版编号', placeholder: '12', maxLength: 12 },
    { kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 120 },
    { kind: 'range', key: 'width', label: '留白', min: 0.06, max: 0.2, step: 0.005 },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
  'swiss-grid': paramStyle<SwissParams>('swiss-grid', { paper: '#FFFFFF', accent: '#D8392B', title: 'Untitled', side: 'left', details: true }, swiss, [
    { kind: 'swatch', key: 'accent', label: '强调色', options: SWISS_ACCENTS },
    { kind: 'swatch', key: 'paper', label: '纸色', options: PAPERS },
    { kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 60 },
    { kind: 'choice', key: 'side', label: '文字栏', options: [{ value: 'left', label: '左' }, { value: 'right', label: '右' }] },
    { kind: 'toggle', key: 'details', label: '参数列表' },
  ]),
  colophon: paramStyle<ColophonParams>('colophon', { paper: '#FBFAF7', title: 'Untitled', details: true }, colophon, [
    { kind: 'swatch', key: 'paper', label: '纸色', options: PAPERS },
    { kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 120 },
    { kind: 'toggle', key: 'details', label: '参数表' },
  ]),
};
