/**
 * F3 Overlay family (docs/style-system-and-engine-plan.md §2): information
 * lives on the photo — a seven-segment date stamp, a frosted caption band,
 * viewfinder brackets, cinema letterbox bars, a translucent "shot on" badge.
 */

import { defaultStyle, type FieldChip, type LayerConfig } from '../types';
import type { KnobOption } from './knobs';
import { paramStyle, type ParamStyle, type StyleBody } from './params';
import { chips, literal, ratioCanvas, round4, SANS, SANS_BOLD } from './gallery';

export type OverlayStyleId = 'date-stamp' | 'glass-caption' | 'viewfinder' | 'cinema' | 'corner-badge';

const SETTINGS: FieldChip['field_id'][] = ['focal_length', 'aperture', 'shutter', 'iso'];
type TextStyle = NonNullable<Extract<LayerConfig, { kind: 'text' }>['style']>;
type Box = Extract<LayerConfig, { kind: 'text' }>['box'];

function text(id: string, box: Box, anchor: string, x: number, y: number, size: number, content: FieldChip[], style: TextStyle, maxWidth?: number, separator = '  ·  '): LayerConfig {
  return {
    id, kind: 'text', box, anchor, offset_x: round4(x), offset_y: round4(y), size: round4(size), z: 'over',
    ...(maxWidth ? { max_width: maxWidth } : {}),
    content: { chips: content, separator }, style,
  };
}

/** Full-bleed canvas (no margins), or a thin even white frame. */
function bleed(layers: LayerConfig[], frame = 0, background = '#FFFFFF'): StyleBody {
  return {
    canvas: ratioCanvas(background, { top: frame, right: frame, bottom: frame, left: frame }),
    regions: [], defaults: defaultStyle, custom_text: '', logo_position: 'right', layers,
  };
}

const INK = { dark: { text: '#FFFFFF', soft: '#D8D8D8', panel: '#000000' }, light: { text: '#141414', soft: '#4A4A4A', panel: '#FFFFFF' } } as const;
const TINTS: readonly KnobOption[] = [{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }];

// ── Date stamp ──────────────────────────────────────────────────────────

type StampParams = { color: string; size: number; corner: string; frame: boolean };

function dateStamp(p: StampParams): StyleBody {
  const right = p.corner !== 'bottom-left';
  return bleed([{
    id: 'stamp', kind: 'segments', box: 'photo', anchor: right ? 'bottom-right' : 'bottom-left',
    offset_x: right ? -0.055 : 0.055, offset_y: -0.05, height: round4(p.size),
    content: { chips: [{ field_id: 'datetime', format: 'stamp' }], separator: ' ' }, color: p.color, glow: true,
  }], p.frame ? 0.028 : 0);
}

// ── Glass caption: a frosted band across the bottom (or top) of the photo ──

type GlassParams = { tint: string; title: string; details: boolean; position: string };

function glass(p: GlassParams): StyleBody {
  const ink = INK[p.tint === 'light' ? 'light' : 'dark'];
  const top = p.position === 'top';
  const band = 0.15, edge = 0.045, titleSize = 0.026, detailSize = 0.012, gap = 0.014;
  const anchor = top ? 'top-left' : 'bottom-left';
  const layers: LayerConfig[] = [
    { id: 'glass', kind: 'rect', box: 'photo', anchor, h: band, color: ink.panel, opacity: p.tint === 'light' ? 0.38 : 0.3, blur: 0.018, z: 'over' },
  ];
  // Lines stack from the band's photo edge inward: title first at the top, details first at the bottom.
  const titleOffset = top ? edge : -(edge + (p.details ? detailSize + gap : 0));
  const detailOffset = top ? edge + (p.title ? titleSize + gap : 0) : -edge;
  if (p.title) layers.push(text('glass-title', 'photo', anchor, 0.055, titleOffset, titleSize, literal(p.title), { font_family: SANS_BOLD, bold: true, color: ink.text, tracking: 10 }, 0.7));
  if (p.details) layers.push(text('glass-details', 'photo', anchor, 0.055, detailOffset, detailSize, chips(['camera_model', 'lens_model', ...SETTINGS]),
    { font_family: SANS, bold: false, color: ink.soft, tracking: 40 }, 0.85));
  return bleed(layers);
}

// ── Viewfinder: corner brackets, an optional crosshair and a spec line ──

type ViewfinderParams = { color: string; crosshair: boolean; details: boolean };

function viewfinder(p: ViewfinderParams): StyleBody {
  const inset = 0.045, arm = 0.075, t = 0.0032;
  const layers: LayerConfig[] = [];
  const corners: [string, number, number][] = [['top-left', 1, 1], ['top-right', -1, 1], ['bottom-left', 1, -1], ['bottom-right', -1, -1]];
  for (const [anchor, sx, sy] of corners) {
    layers.push({ id: `vf-${anchor}-h`, kind: 'rect', box: 'photo', anchor, offset_x: sx * inset, offset_y: sy * inset, w: arm, h: t, color: p.color, opacity: 0.92, z: 'over' });
    layers.push({ id: `vf-${anchor}-v`, kind: 'rect', box: 'photo', anchor, offset_x: sx * inset, offset_y: sy * inset, w: t, h: arm, color: p.color, opacity: 0.92, z: 'over' });
  }
  if (p.crosshair) {
    layers.push({ id: 'vf-cross-h', kind: 'rect', box: 'photo', anchor: 'middle-center', w: 0.05, h: 0.0022, color: p.color, opacity: 0.8, z: 'over' });
    layers.push({ id: 'vf-cross-v', kind: 'rect', box: 'photo', anchor: 'middle-center', w: 0.0022, h: 0.05, color: p.color, opacity: 0.8, z: 'over' });
  }
  if (p.details) {
    layers.push(text('vf-spec', 'photo', 'bottom-center', 0, -(inset + 0.004), 0.0135, chips(SETTINGS), { font_family: SANS_BOLD, bold: true, color: p.color, tracking: 160 }, 0.6, '    '));
    layers.push(text('vf-model', 'photo', 'top-center', 0, inset + 0.004, 0.0115, chips(['camera_model']), { font_family: SANS, bold: false, color: p.color, tracking: 200, text_case: 'upper' }, 0.5));
  }
  return bleed(layers);
}

// ── Cinema: letterbox bars, a subtitle line, a quiet meta line ──

type CinemaParams = { aspect: string; title: string; details: boolean };

function cinema(p: CinemaParams): StyleBody {
  const layers: LayerConfig[] = [
    { id: 'bars', kind: 'letterbox', aspect: Number(p.aspect) || 2.39, color: '#000000' },
  ];
  if (p.title) layers.push(text('subtitle', 'letterbox-bottom', 'middle-center', 0, 0, 0.026, literal(p.title), { font_family: SANS, bold: false, color: '#F2F2F2', tracking: 20 }, 0.85));
  if (p.details) {
    layers.push(text('cinema-meta', 'letterbox-top', 'middle-left', 0.045, 0, 0.0115, chips(['camera_model', 'lens_model']), { font_family: SANS, bold: false, color: '#8C8C8C', tracking: 160, text_case: 'upper' }, 0.6));
    layers.push(text('cinema-date', 'letterbox-top', 'middle-right', -0.045, 0, 0.0115, [{ field_id: 'datetime', format: 'date' }], { font_family: SANS, bold: false, color: '#8C8C8C', tracking: 160 }, 0.3));
  }
  return bleed(layers, 0, '#000000');
}

// ── Corner badge: a frosted rounded badge with the brand mark and model ──

type BadgeParams = { tint: string; corner: string; logo: boolean; details: boolean };

function badge(p: BadgeParams): StyleBody {
  const ink = INK[p.tint === 'light' ? 'light' : 'dark'];
  const right = p.corner === 'bottom-right';
  const anchor = right ? 'bottom-right' : 'bottom-left';
  const s = right ? -1 : 1;
  const inset = 0.04, w = 0.31, h = 0.074, pad = 0.022, logoH = 0.03, logoW = 0.09;
  const layers: LayerConfig[] = [
    { id: 'badge', kind: 'rect', box: 'photo', anchor, offset_x: s * inset, offset_y: -inset, w, h, radius: 0.014, blur: 0.012, color: ink.panel, opacity: 0.42, z: 'over' },
  ];
  const textX = s * (inset + pad + (p.logo ? logoW + 0.016 : 0));
  if (p.logo) layers.push({ id: 'badge-logo', kind: 'logo', box: 'photo', anchor, offset_x: s * (inset + pad), offset_y: -(inset + (h - logoH) / 2), height: logoH, path: '', z: 'over' });
  layers.push(text('badge-model', 'photo', anchor, textX, -(inset + (p.details ? h / 2 + 0.002 : (h - 0.018) / 2)), 0.018, chips(['camera_model']),
    { font_family: SANS_BOLD, bold: true, color: ink.text, tracking: 0 }, 0.2));
  if (p.details) layers.push(text('badge-settings', 'photo', anchor, textX, -(inset + 0.017), 0.0105, chips(SETTINGS), { font_family: SANS, bold: false, color: ink.soft, tracking: 30 }, 0.2, '  '));
  // Full bleed hides the background; it only selects the logo ink (light logos on the dark badge).
  return bleed(layers, 0, p.tint === 'light' ? '#FFFFFF' : '#111111');
}

const STAMP_COLORS: readonly KnobOption[] = [
  { value: '#FF8A1F', label: '橙' }, { value: '#FF4B2B', label: '红' }, { value: '#FFD23F', label: '黄' },
];
const MARK_COLORS: readonly KnobOption[] = [
  { value: '#FFFFFF', label: '白' }, { value: '#FFB347', label: '琥珀' }, { value: '#7CFC9A', label: '荧光绿' },
];
const CORNERS: readonly KnobOption[] = [{ value: 'bottom-left', label: '左下' }, { value: 'bottom-right', label: '右下' }];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each style has its own parameter shape
export const OVERLAY_STYLES: Record<OverlayStyleId, ParamStyle<any>> = {
  'date-stamp': paramStyle<StampParams>('date-stamp', { color: '#FF8A1F', size: 0.045, corner: 'bottom-right', frame: false }, dateStamp, [
    { kind: 'swatch', key: 'color', label: '颜色', options: STAMP_COLORS },
    { kind: 'range', key: 'size', label: '大小', min: 0.03, max: 0.08, step: 0.0025 },
    { kind: 'choice', key: 'corner', label: '位置', options: CORNERS },
    { kind: 'toggle', key: 'frame', label: '白边' },
  ]),
  'glass-caption': paramStyle<GlassParams>('glass-caption', { tint: 'dark', title: '', details: true, position: 'bottom' }, glass, [
    { kind: 'choice', key: 'tint', label: '毛玻璃', options: TINTS },
    { kind: 'text', key: 'title', label: '标题', placeholder: '可留空', maxLength: 80 },
    { kind: 'choice', key: 'position', label: '位置', options: [{ value: 'bottom', label: '底部' }, { value: 'top', label: '顶部' }] },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
  viewfinder: paramStyle<ViewfinderParams>('viewfinder', { color: '#FFFFFF', crosshair: false, details: true }, viewfinder, [
    { kind: 'swatch', key: 'color', label: '颜色', options: MARK_COLORS },
    { kind: 'toggle', key: 'crosshair', label: '中心十字' },
    { kind: 'toggle', key: 'details', label: '参数' },
  ]),
  cinema: paramStyle<CinemaParams>('cinema', { aspect: '2.39', title: '', details: true }, cinema, [
    { kind: 'choice', key: 'aspect', label: '画幅', options: [{ value: '2.39', label: '2.39:1' }, { value: '2', label: '2:1' }, { value: '1.85', label: '1.85:1' }] },
    { kind: 'text', key: 'title', label: '字幕', placeholder: '一句台词或标题', maxLength: 80 },
    { kind: 'toggle', key: 'details', label: '片头信息' },
  ]),
  'corner-badge': paramStyle<BadgeParams>('corner-badge', { tint: 'dark', corner: 'bottom-left', logo: true, details: true }, badge, [
    { kind: 'choice', key: 'tint', label: '底色', options: TINTS },
    { kind: 'choice', key: 'corner', label: '位置', options: CORNERS },
    { kind: 'toggle', key: 'logo', label: '品牌 Logo' },
    { kind: 'toggle', key: 'details', label: '拍摄参数' },
  ]),
};

