/**
 * F5 Analog film, F6 print object and F8 CJK mounting families
 * (docs/style-system-and-engine-plan.md §2): film rebates with sprocket
 * rows and generic edge print, filed and torn edges, instant cards, paper and
 * silk textures, vertical inscriptions with a seal, and the hanging scroll.
 *
 * Edge print is generic or user text — never a manufacturer's wordmark.
 */

import { shiftColor } from '../layout/compose';
import { defaultStyle, type FieldChip, type ImprintConfig, type LayerConfig } from '../types';
import type { KnobOption } from './knobs';
import { paramStyle, type ParamStyle, type StyleBody } from './params';
import { chips, literal, ratioCanvas, round4, SANS, SANS_BOLD, SERIF } from './gallery';

export type MaterialStyleId = 'film-135' | 'film-120' | 'filed-negative' | 'instant' | 'deckle-print' | 'vertical-title' | 'hanging-scroll';

const KAI = 'LXGWWenKai-Regular.ttf' as const;
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

function body(canvas: ImprintConfig['canvas'], layers: LayerConfig[]): StyleBody {
  return { canvas, regions: [], defaults: defaultStyle, custom_text: '', logo_position: 'right', layers };
}

const grainLayer = (on: boolean): LayerConfig[] => on ? [{ id: 'grain', kind: 'texture', box: 'photo', texture: 'grain', scale: 0.22, opacity: 0.32, z: 'over' }] : [];

const FILM_TONES = { black: { rebate: '#141210', print: '#E3A33F', hole: '#ECE8E0' }, amber: { rebate: '#B9682E', print: '#3B1F0F', hole: '#F2E6D2' } } as const;
const TONE_OPTIONS: readonly KnobOption[] = [{ value: 'black', label: '正片黑边' }, { value: 'amber', label: '负片橙边' }];

// ── 135: rebate with two sprocket rows, edge print and frame numbers ──
// Proportions follow 35 mm film measured against the 24 mm frame height:
// 2.79 × 1.98 mm perforations on a 4.75 mm pitch, about 5 mm of rebate.

type FilmParams = { edge: string; frame: string; tone: string; grain: boolean };

function film135(p: FilmParams): StyleBody {
  const tone = FILM_TONES[p.tone === 'amber' ? 'amber' : 'black'];
  const rebate = 0.21, gap = 0.045, holeW = 0.116, holeH = 0.0825, pitch = 0.198, outer = 0.035;
  const printStyle: TextStyle = { font_family: SANS_BOLD, bold: true, color: tone.print, tracking: 140 };
  const layers: LayerConfig[] = [
    { id: 'holes-top', kind: 'pattern', box: 'margin-top', axis: 'x', cross: outer, w: holeW, h: holeH, pitch, radius: 0.012, color: tone.hole },
    { id: 'holes-bottom', kind: 'pattern', box: 'margin-bottom', axis: 'x', cross: rebate - outer - holeH, w: holeW, h: holeH, pitch, radius: 0.012, color: tone.hole },
    ...grainLayer(p.grain),
  ];
  if (p.edge) layers.push(text('edge-print', 'margin-top', 'bottom-left', gap + 0.03, -0.014, 0.03, literal(p.edge), printStyle, 0.6));
  if (p.frame) layers.push(text('frame-number', 'margin-bottom', 'top-left', gap + 0.03, 0.014, 0.03, literal(`${p.frame}  ▶  ${p.frame}A`), printStyle, 0.4));
  return body(ratioCanvas(tone.rebate, { top: rebate, right: gap, bottom: rebate, left: gap }), layers);
}

// ── 120: wide rebate on every side, edge text and frame number, no sprockets ──

function film120(p: FilmParams): StyleBody {
  const tone = FILM_TONES[p.tone === 'amber' ? 'amber' : 'black'];
  const r = 0.085;
  const printStyle: TextStyle = { font_family: SANS_BOLD, bold: true, color: tone.print, tracking: 160 };
  const layers: LayerConfig[] = [...grainLayer(p.grain)];
  if (p.edge) layers.push(text('edge-print', 'margin-top', 'middle-left', r, 0, 0.026, literal(p.edge), printStyle, 0.6));
  if (p.frame) layers.push(text('frame-number', 'margin-top', 'middle-right', -r, 0, 0.026, literal(p.frame), printStyle, 0.2));
  layers.push({ id: 'notch', kind: 'rect', box: 'margin-right', anchor: 'middle-right', w: 0.02, h: 0.06, color: tone.hole });
  return body(ratioCanvas(tone.rebate, { top: r, right: r, bottom: r, left: r }), layers);
}

// ── Filed negative carrier: a black border whose inner edge bites into the photo ──

type FiledParams = { roughness: number; width: number; grain: boolean };

function filed(p: FiledParams): StyleBody {
  return body(ratioCanvas('#0E0E0E', { top: p.width, right: p.width, bottom: p.width, left: p.width }), [
    { id: 'filed', kind: 'deckle', box: 'photo', depth: round4(p.roughness), seed: 135, color: '#0E0E0E', z: 'over' },
    ...grainLayer(p.grain),
  ]);
}

// ── Instant card: thin even sides, a deep lower lip and a handwritten caption ──

type InstantParams = { caption: string; date: boolean; paper: string; texture: boolean };

function instant(p: InstantParams): StyleBody {
  const side = 0.085, top = 0.1, bottom = 0.36;
  const layers: LayerConfig[] = p.texture ? [{ id: 'paper', kind: 'texture', box: 'canvas', texture: 'paper', scale: 0.5, opacity: 0.55 }] : [];
  if (p.caption) layers.push(text('caption', 'margin-bottom', 'middle-left', side + 0.02, -0.02, 0.05, literal(p.caption), { font_family: KAI, bold: false, color: '#2D2A26' }, 0.8));
  if (p.date) layers.push(text('date', 'margin-bottom', 'middle-right', -(side + 0.02), 0.06, 0.026, [{ field_id: 'datetime', format: 'date' }], { font_family: KAI, bold: false, color: '#6B655C' }, 0.4));
  return body(ratioCanvas(p.paper, { top, right: side, bottom, left: side }), layers);
}

// ── Deckle-edged print on a wall: torn paper edges, a quiet serif title ──

type DeckleParams = { title: string; wall: string; roughness: number; details: boolean };

function deckle(p: DeckleParams): StyleBody {
  const w = 0.16, bottom = 0.21, torn = 0.045;
  // A solid wall margin, then the torn band just inside it, so the paper edge never touches the canvas border.
  const layers: LayerConfig[] = [
    { id: 'paper', kind: 'texture', box: 'canvas', texture: 'paper', scale: 0.45, opacity: 0.7 },
    { id: 'torn', kind: 'deckle', box: 'canvas', inset: torn, depth: round4(p.roughness), seed: 7, color: p.wall, z: 'under' },
    { id: 'wall', kind: 'keyline', box: 'canvas', offset: -torn, width: torn, color: p.wall },
  ];
  const ink = { title: '#34312C', detail: '#8C877E' };
  if (p.title) layers.push(text('title', 'margin-bottom', 'top-center', 0, 0.06, 0.017, literal(p.title), { font_family: SERIF, bold: false, color: ink.title, tracking: 30 }, 0.6));
  if (p.details) layers.push(text('details', 'margin-bottom', 'top-center', 0, p.title ? 0.092 : 0.06, 0.0092, chips(['camera_model', ...SETTINGS]), { font_family: SANS, bold: false, color: ink.detail, tracking: 40 }, 0.6));
  return body(ratioCanvas('#F3EFE6', { top: w, right: w, bottom, left: w }), layers);
}

// ── Vertical title with a seal (竖排题签) ──

type VerticalParams = { title: string; seal: string; show_seal: boolean; paper: string; side: string };

function vertical(p: VerticalParams): StyleBody {
  const right = p.side !== 'left';
  const column = 0.26, m = 0.08;
  const box: Box = right ? 'margin-right' : 'margin-left';
  const layers: LayerConfig[] = [
    { id: 'paper', kind: 'texture', box: 'canvas', texture: 'paper', scale: 0.5, opacity: 0.6 },
  ];
  if (p.title) layers.push(text('title', box, 'middle-center', 0, -0.03, 0.07, literal(p.title), { font_family: KAI, bold: false, color: '#2A2522', text_direction: 'vertical-glyphs', line_height: 1.18 }));
  if (p.show_seal && p.seal) {
    const chars = Array.from(p.seal).length;
    const size = 0.07, glyph = chars > 1 ? 0.03 : 0.044, lineHeight = 1.05, lift = 0.06;
    // The vertical stack is glyphs × advance tall; bottom-anchor it so it is centred in the seal.
    const stack = chars * glyph * lineHeight;
    layers.push({ id: 'seal', kind: 'rect', box, anchor: 'bottom-center', offset_y: -lift, w: size, h: size, radius: 0.006, color: '#B3261E' });
    layers.push(text('seal-text', box, 'bottom-center', 0, -(lift + (size - stack) / 2), glyph, literal(p.seal),
      { font_family: KAI, bold: false, color: '#FBEFE6', text_direction: 'vertical-glyphs', line_height: lineHeight }));
  }
  return body(ratioCanvas(p.paper, { top: m, right: right ? column : m, bottom: m, left: right ? m : column }), layers);
}

// ── Hanging scroll (立轴): tall silk mount, rods, two hanging flaps ──

type ScrollParams = { mount: string; title: string; flaps: boolean; texture: boolean };

function scroll(p: ScrollParams): StyleBody {
  const side = 0.12, top = 0.5, bottom = 0.3;
  const rod = '#3A2A1F';
  const layers: LayerConfig[] = [];
  if (p.texture) layers.push({ id: 'silk', kind: 'texture', box: 'canvas', texture: 'silk', scale: 0.35, opacity: 0.55 });
  layers.push({ id: 'border', kind: 'mat', reveal: { width: 0.022, color: '#EFE7D6' }, core: null });
  layers.push({ id: 'rod-top', kind: 'rect', box: 'canvas', anchor: 'top-left', h: 0.035, color: rod });
  layers.push({ id: 'rod-bottom', kind: 'rect', box: 'canvas', anchor: 'bottom-left', h: 0.05, color: rod });
  if (p.flaps) {
    const flap = shiftColor(p.mount, -28);
    layers.push({ id: 'flap-left', kind: 'rect', box: 'margin-top', anchor: 'top-center', offset_x: -0.17, offset_y: 0.035, w: 0.014, h: 0.3, color: flap });
    layers.push({ id: 'flap-right', kind: 'rect', box: 'margin-top', anchor: 'top-center', offset_x: 0.17, offset_y: 0.035, w: 0.014, h: 0.3, color: flap });
  }
  if (p.title) layers.push(text('title', 'margin-top', 'middle-right', -0.06, 0.04, 0.034, literal(p.title), { font_family: KAI, bold: false, color: '#2A2522', text_direction: 'vertical-glyphs', line_height: 1.15 }));
  return body(ratioCanvas(p.mount, { top, right: side, bottom, left: side }), layers);
}

const PAPERS: readonly KnobOption[] = [{ value: '#F6F3EC', label: '奶白' }, { value: '#FFFFFF', label: '纯白' }, { value: '#EFE8D8', label: '米黄' }];
const RICE: readonly KnobOption[] = [{ value: '#F1ECE1', label: '宣纸' }, { value: '#FAF8F3', label: '素白' }, { value: '#E3E1DA', label: '灰绢' }];
const WALLS: readonly KnobOption[] = [{ value: '#2B2926', label: '深墙' }, { value: '#8C8780', label: '灰墙' }, { value: '#D9D4CA', label: '浅墙' }];
const MOUNTS: readonly KnobOption[] = [{ value: '#C9D3C2', label: '青绫' }, { value: '#3E4A5C', label: '靛蓝' }, { value: '#E6DCC6', label: '米黄' }, { value: '#6E5A48', label: '赭褐' }];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each style has its own parameter shape
export const MATERIAL_STYLES: Record<MaterialStyleId, ParamStyle<any>> = {
  'film-135': paramStyle<FilmParams>('film-135', { edge: 'KARI 400', frame: '12', tone: 'black', grain: false }, film135, [
    { kind: 'text', key: 'edge', label: '片边文字', placeholder: '自定义，不使用胶片品牌字标', maxLength: 32 },
    { kind: 'text', key: 'frame', label: '画格编号', placeholder: '12', maxLength: 4 },
    { kind: 'choice', key: 'tone', label: '片基', options: TONE_OPTIONS },
    { kind: 'toggle', key: 'grain', label: '颗粒' },
  ]),
  'film-120': paramStyle<FilmParams>('film-120', { edge: 'KARI PAN 100', frame: '7', tone: 'black', grain: false }, film120, [
    { kind: 'text', key: 'edge', label: '片边文字', placeholder: '自定义，不使用胶片品牌字标', maxLength: 32 },
    { kind: 'text', key: 'frame', label: '画格编号', placeholder: '7', maxLength: 4 },
    { kind: 'choice', key: 'tone', label: '片基', options: TONE_OPTIONS },
    { kind: 'toggle', key: 'grain', label: '颗粒' },
  ]),
  'filed-negative': paramStyle<FiledParams>('filed-negative', { roughness: 0.012, width: 0.07, grain: true }, filed, [
    { kind: 'range', key: 'roughness', label: '锉边粗糙度', min: 0.004, max: 0.03, step: 0.001 },
    { kind: 'range', key: 'width', label: '黑边宽度', min: 0.03, max: 0.15, step: 0.005 },
    { kind: 'toggle', key: 'grain', label: '颗粒' },
  ]),
  instant: paramStyle<InstantParams>('instant', { caption: '', date: true, paper: '#F6F3EC', texture: true }, instant, [
    { kind: 'text', key: 'caption', label: '手写标注', placeholder: '写一句话', maxLength: 30 },
    { kind: 'toggle', key: 'date', label: '日期' },
    { kind: 'swatch', key: 'paper', label: '相纸', options: PAPERS },
    { kind: 'toggle', key: 'texture', label: '纸纹' },
  ]),
  'deckle-print': paramStyle<DeckleParams>('deckle-print', { title: '', wall: '#2B2926', roughness: 0.012, details: true }, deckle, [
    { kind: 'text', key: 'title', label: '标题', placeholder: '作品标题', maxLength: 120 },
    { kind: 'swatch', key: 'wall', label: '墙面', options: WALLS },
    { kind: 'range', key: 'roughness', label: '毛边', min: 0.004, max: 0.03, step: 0.001 },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
  'vertical-title': paramStyle<VerticalParams>('vertical-title', { title: '山行', seal: '影', show_seal: true, paper: '#F1ECE1', side: 'right' }, vertical, [
    { kind: 'text', key: 'title', label: '题签', placeholder: '竖排标题', maxLength: 12 },
    { kind: 'text', key: 'seal', label: '印文', placeholder: '一至二字', maxLength: 2 },
    { kind: 'toggle', key: 'show_seal', label: '钤印' },
    { kind: 'swatch', key: 'paper', label: '纸色', options: RICE },
    { kind: 'choice', key: 'side', label: '题签位置', options: [{ value: 'right', label: '右' }, { value: 'left', label: '左' }] },
  ]),
  'hanging-scroll': paramStyle<ScrollParams>('hanging-scroll', { mount: '#C9D3C2', title: '', flaps: true, texture: true }, scroll, [
    { kind: 'swatch', key: 'mount', label: '裱绫', options: MOUNTS },
    { kind: 'text', key: 'title', label: '题签', placeholder: '竖排标题', maxLength: 12 },
    { kind: 'toggle', key: 'flaps', label: '惊燕' },
    { kind: 'toggle', key: 'texture', label: '绫纹' },
  ]),
};
