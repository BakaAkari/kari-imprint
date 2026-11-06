/**
 * Style catalog — the single source of truth for every product style in every app.
 *
 * Each entry owns its identity (id / name / caption / category), the app whose
 * picker lists it, and a `build()` that yields a complete, fresh ImprintConfig.
 * Ids are unique across apps so a style can later be offered in more than one
 * place without renaming.
 *
 * Two authoring models coexist on purpose; they are not interchangeable:
 *   - `kind: 'controlled'` (web editor): a chrome-only LayoutTemplate plus a full
 *     MainControlConfig. The editor keeps them apart as a session
 *     (presetSession.ts) and `build()` is exactly what that session resolves to.
 *     Controlled slots (footer text, Logo asset) never appear in the template.
 *   - `kind: 'framed'` (immich-ki): a builder emitting the full config directly,
 *     with white space on the three sides the information frame does not use.
 *
 * The catalog is deep-frozen; `build()` always returns an unfrozen deep copy.
 * Contract coverage: apps/web/scripts/verifyPresetContract.mts.
 */

import {
  DEFAULT_CANVAS_EFFECT,
  defaultControlSurface,
  defaultFlowLayout,
  defaultStyle,
  resolveConfig,
  type CanvasEffect,
  type ControlSurface,
  type FieldChip,
  type FieldId,
  type ImprintConfig,
  type MainControlConfig,
  type StyleConfig,
} from './types';
import type { LayoutTemplate, PresetCategory } from './templateModel';
import { EDITORIAL_STYLES, type EditorialStyleId } from './styles/editorial';
import { OVERLAY_STYLES, type OverlayStyleId } from './styles/overlay';
import { SOCIAL_STYLES, type SocialStyleId } from './styles/social';
import { MATERIAL_STYLES, type MaterialStyleId } from './styles/material';
import { GALLERY_STYLES, type GalleryStyleId } from './styles/gallery';
import type { StyleKnob } from './styles/knobs';

export type { StyleKnob } from './styles/knobs';

export type StyleApp = 'web' | 'immich-ki';

export interface StyleBuildOptions {
  /** Short edge of the photo in pixels; styles whose white space scales with the photo use it. */
  shortEdge?: number;
}

interface StylePresetBase {
  id: string;
  name: string;
  caption: string;
  category: PresetCategory;
  app: StyleApp;
  build: (options?: StyleBuildOptions) => ImprintConfig;
}

export interface ControlledStylePreset extends StylePresetBase {
  kind: 'controlled';
  template: LayoutTemplate;
  mainControls: MainControlConfig;
}

export interface FramedStylePreset extends StylePresetBase {
  kind: 'framed';
  id: FramedStyleId;
  /** Engine-built styles declare their few user-facing controls (at most five). */
  knobs?: readonly StyleKnob[];
}

export type StylePreset = ControlledStylePreset | FramedStylePreset;

export type FramedStyleId = 'classic' | 'minimal-line' | 'dark' | 'blur' | 'plain' | GalleryStyleId | EditorialStyleId | OverlayStyleId | SocialStyleId | MaterialStyleId;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ── Framed-style building blocks (also used by the immich-ki editor) ─────

/** Which EXIF fields each track shows by default. */
export const DEFAULT_TRACK_FIELDS: { top: FieldId[]; bottom: FieldId[] } = {
  top: ['camera_model', 'lens_model'],
  bottom: ['focal_length', 'aperture', 'shutter', 'iso'],
};

/** Default 60px white space on the three sides the information frame does not occupy. */
export const DEFAULT_FRAME_MARGIN = 60;

export type FrameSide = 'footer' | 'left' | 'right';

/** Margins for a given frame position: `value` px on the three non-frame sides. */
export function marginsForFrame(position: FrameSide, value = DEFAULT_FRAME_MARGIN): ImprintConfig['canvas']['margins'] {
  return position === 'footer'
    ? { top: value, right: value, bottom: 0, left: value }
    : position === 'left'
      ? { top: value, right: value, bottom: value, left: 0 }
      : { top: value, right: 0, bottom: value, left: value };
}

/** Read the optional canvas effect without depending on the field being present. */
export function canvasEffect(config: ImprintConfig): CanvasEffect {
  return { ...DEFAULT_CANVAS_EFFECT, ...(config.canvas.effect ?? {}) };
}

export function withCanvasEffect(config: ImprintConfig, patch: Partial<CanvasEffect>): ImprintConfig {
  const effect = { ...canvasEffect(config), ...patch };
  const canvas = { ...config.canvas };
  if (effect.background === 'solid' && effect.photo_radius === 0 && !effect.shadow) delete canvas.effect;
  else canvas.effect = effect;
  return { ...config, canvas };
}

const chips = (fields: FieldId[]): FieldChip[] => fields.map(field_id => ({ field_id }));
const text = (patch: Partial<StyleConfig>): StyleConfig => ({ ...defaultStyle, ...patch });
const BOLD = 'NotoSansCJKsc-Bold.otf' as const;
const REGULAR = 'NotoSansCJKsc-Regular.otf' as const;

function frameCanvas(background = '#FFFFFF'): ImprintConfig['canvas'] {
  return { margins: marginsForFrame('footer'), background, border_radius: 0, border: { enabled: false, width_level: 'medium', color: '#FFFFFF' } };
}

/** 经典：双轨底栏，右侧自动识别品牌 Logo。 */
function buildClassic(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: frameCanvas(),
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.15, layout: defaultFlowLayout(),
      slots: {
        // The upper line is bold, the lower line regular; both medium so the
        // two metadata lines keep a calm, legible hierarchy.
        'primary-start': { enabled: true, style: text({ font_size_level: 'medium', font_family: BOLD, bold: true }), content: { chips: chips(DEFAULT_TRACK_FIELDS.top), separator: ' ' } },
        'secondary-start': { enabled: true, style: text({ font_size_level: 'medium', font_family: REGULAR, bold: false }), content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: true, style: null, content: { path: '', size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

/** 极简单行：一行内左侧机身、右侧参数，无 Logo。 */
function buildMinimalLine(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: frameCanvas(),
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.1,
      layout: { ...defaultFlowLayout(), mode: 'single-track' },
      slots: {
        // One line in a thin bar: use the large step so it reads at the same
        // visual size as the classic two-line text.
        'primary-start': { enabled: true, style: text({ font_size_level: 'large', font_family: BOLD, bold: true }), content: { chips: chips(['camera_model']), separator: ' ' } },
        'primary-end': { enabled: true, style: text({ font_size_level: 'large', font_family: REGULAR, bold: false, color: '#6E6E6E' }), content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: false, style: null, content: null },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

/** 深色：经典结构，深底浅字。 */
function buildDark(): ImprintConfig {
  const config = buildClassic();
  const region = config.regions[0];
  const slots = region.slots!;
  slots['primary-start'] = { ...slots['primary-start'], style: { ...slots['primary-start'].style!, color: '#F2F2F2' } };
  slots['secondary-start'] = { ...slots['secondary-start'], style: { ...slots['secondary-start'].style!, color: '#9A9A9A' } };
  return { ...config, canvas: { ...config.canvas, background: '#141414' } };
}

/** 模糊背景：照片悬浮在自身模糊背景上，圆角 + 柔和投影，浅色文字。 */
function buildBlur(shortEdge?: number): ImprintConfig {
  const config = buildClassic();
  const slots = config.regions[0].slots!;
  slots['primary-start'] = { ...slots['primary-start'], style: { ...slots['primary-start'].style!, color: '#FFFFFF' } };
  slots['secondary-start'] = { ...slots['secondary-start'], style: { ...slots['secondary-start'].style!, color: '#D9D9D9' } };
  const margin = shortEdge ? Math.max(DEFAULT_FRAME_MARGIN, Math.round(shortEdge * 0.06)) : DEFAULT_FRAME_MARGIN * 3;
  const base: ImprintConfig = { ...config, canvas: { ...config.canvas, background: '#1A1A1A', margins: marginsForFrame('footer', margin) } };
  return withCanvasEffect(base, { background: 'blur', photo_radius: 0.015, shadow: true });
}

/** 纯留白：不添加信息条，只保留四边留白。 */
function buildPlain(): ImprintConfig {
  const m = DEFAULT_FRAME_MARGIN;
  return {
    schema_version: 3,
    canvas: { ...frameCanvas(), margins: { top: m, right: m, bottom: m, left: m } },
    regions: [],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

// ── Controlled-style templates (web editor) ──────────────────────────────
//
// Templates carry only structural chrome MainControlConfig does not own:
// canvas margins/background/border, baseline typography, and the region
// skeleton. resolveConfig() rebuilds every controlled slot from the controls.

const footerControlSurface: ControlSurface = structuredClone(defaultControlSurface);

function footerOnlyTemplate(canvas: ImprintConfig['canvas']): ImprintConfig {
  return {
    schema_version: 3,
    canvas,
    // A private copy so freezing the catalog never freezes the shared defaultStyle.
    defaults: structuredClone(defaultStyle),
    regions: [
      {
        id: 'footer',
        type: 'footer-bar',
        enabled: true,
        layout: defaultFlowLayout(),
        text_orientation: 'auto',
        // height 由 resolveConfig 按 footer_height_level 计算；slots 由 MainControlConfig 权威构造。
      },
    ],
  };
}

const brandFooterTemplate: LayoutTemplate = {
  id: 'brandFooter',
  name: '品牌底栏模板',
  description: '底部区域驱动的 EXIF + Logo 模板',
  config: footerOnlyTemplate({
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: true, width_level: 'small', color: '#FFFFFF' },
  }),
  controlSurface: footerControlSurface,
};

const minimalFooterTemplate: LayoutTemplate = {
  id: 'minimalFooter',
  name: '极简底栏模板',
  description: '极简参数信息模板',
  config: footerOnlyTemplate({
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: false, width_level: 'small', color: '#FFFFFF' },
  }),
  controlSurface: footerControlSurface,
};

const polaroidFooterTemplate: LayoutTemplate = {
  id: 'polaroidFooter',
  name: '拍立得底栏模板',
  description: '暖白纸边 + 底部信息模板',
  config: footerOnlyTemplate({
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    // 圆润 = 照片本身圆角（canvas.effect.photo_radius）。画布外角圆角需要透明，
    // JPEG 成品无法表达，因此 border_radius 已停用，预览与成品都不再应用。
    border_radius: 0,
    effect: { background: 'solid', photo_radius: 0.02, shadow: false },
    // 拍立得的白纸边由 border 实现；controlSurface.border.enabled 打开时由 controls.border_enabled 权威覆盖。
    border: { enabled: true, width_level: 'medium', color: '#FFFFFF' },
  }),
  controlSurface: footerControlSurface,
};

/**
 * 品牌底栏 —— 现代影像风：完整 EXIF 铺陈，默认开启浅色边框，Logo 自动跟随品牌。
 * logo_enabled=true：品牌预设的 Logo 是核心元素，需要显示。
 */
const brandFooterControls: MainControlConfig = {
  scheme: 'dark',
  layout_structure: 'footer',
  flow_mode: 'dual-track',
  logo_enabled: true,
  logo_position: 'center',
  text_sizes: {
    primary_start: 'large',
    primary_end: 'medium',
    secondary_start: 'medium',
    secondary_end: 'medium',
  },
  logo_size: 'large',
  signature_size: 'medium',
  footer_height_level: 'medium',
  logo_variant: '',
  border_enabled: true,
  border_width_level: 'small',
  primary_start: [{ field_id: 'make' }, { field_id: 'camera_model' }],
  primary_end: [
    { field_id: 'focal_length' },
    { field_id: 'shutter' },
    { field_id: 'aperture' },
    { field_id: 'iso' },
  ],
  secondary_start: [{ field_id: 'lens_model' }],
  secondary_end: [{ field_id: 'gps' }, { field_id: 'datetime' }],
  custom_text: '',
  logo_path: '',
  signature_path: '',
};

/**
 * 极简参数 —— 最低信息密度：仅底部一行核心参数、无 Logo、无边框。
 * logo_enabled=false：极简预设明确不显示 Logo，也不预留布局空间；
 * 用户仍可在右侧 Logo 区手动开启，参数完全显式，不依赖隐藏 controlSurface。
 */
const minimalFooterControls: MainControlConfig = {
  scheme: 'dark',
  layout_structure: 'footer',
  flow_mode: 'single-track',
  logo_enabled: false,
  logo_position: 'right',
  text_sizes: {
    primary_start: 'medium',
    primary_end: 'medium',
    secondary_start: 'medium',
    secondary_end: 'medium',
  },
  logo_size: 'medium',
  signature_size: 'medium',
  footer_height_level: 'medium',
  logo_variant: '',
  border_enabled: false,
  border_width_level: 'small',
  primary_start: [],
  primary_end: [
    { field_id: 'focal_length' },
    { field_id: 'aperture' },
    { field_id: 'shutter' },
    { field_id: 'iso' },
  ],
  secondary_start: [],
  secondary_end: [],
  custom_text: '',
  logo_path: '',
  signature_path: '',
};

/**
 * 拍立得白边 —— 白纸边 + 圆角画布 + 底部标注。
 * border 打开是产品语义（拍立得纸边），非全局默认继承。
 * logo_enabled=true：底部除自定义文本外仍显示品牌 Logo，
 * 保留极简与品牌两种视觉之间的中间态。
 */
const softCardControls: MainControlConfig = {
  scheme: 'dark',
  layout_structure: 'footer',
  flow_mode: 'dual-track',
  logo_enabled: true,
  logo_position: 'right',
  text_sizes: {
    primary_start: 'medium',
    primary_end: 'medium',
    secondary_start: 'medium',
    secondary_end: 'medium',
  },
  logo_size: 'medium',
  signature_size: 'medium',
  footer_height_level: 'medium',
  logo_variant: '',
  border_enabled: true,
  border_width_level: 'medium',
  primary_start: [{ field_id: 'custom_text', custom_text: 'AKARI PHOTO' }],
  primary_end: [{ field_id: 'camera_model' }],
  secondary_start: [{ field_id: 'datetime' }],
  secondary_end: [
    { field_id: 'focal_length' },
    { field_id: 'aperture' },
    { field_id: 'iso' },
  ],
  custom_text: 'AKARI PHOTO',
  logo_path: '',
  signature_path: '',
};

/** What a fresh editor session for this preset resolves to — the controlled style's full config. */
function resolveControlled(template: LayoutTemplate, controls: MainControlConfig): ImprintConfig {
  return structuredClone(resolveConfig(template.config, controls, {}, {}, {}, template.controlSurface ?? defaultControlSurface));
}

function controlled(
  meta: Pick<ControlledStylePreset, 'id' | 'name' | 'caption' | 'category'>,
  template: LayoutTemplate,
  mainControls: MainControlConfig,
): ControlledStylePreset {
  return { ...meta, app: 'web', kind: 'controlled', template, mainControls, build: () => resolveControlled(template, mainControls) };
}

function framed(
  meta: Pick<FramedStylePreset, 'id' | 'name' | 'caption' | 'category'>,
  builder: (shortEdge?: number) => ImprintConfig,
  knobs?: readonly StyleKnob[],
): FramedStylePreset {
  return { ...meta, app: 'immich-ki', kind: 'framed', build: (options) => builder(options?.shortEdge), ...(knobs ? { knobs } : {}) };
}

function gallery(id: GalleryStyleId, name: string, caption: string): FramedStylePreset {
  return framed({ id, name, caption, category: 'gallery' }, () => GALLERY_STYLES[id].build(), GALLERY_STYLES[id].knobs);
}

function editorial(id: EditorialStyleId, name: string, caption: string): FramedStylePreset {
  return framed({ id, name, caption, category: 'editorial' }, () => EDITORIAL_STYLES[id].build(), EDITORIAL_STYLES[id].knobs);
}

function material(id: MaterialStyleId, name: string, caption: string, category: PresetCategory): FramedStylePreset {
  return framed({ id, name, caption, category }, () => MATERIAL_STYLES[id].build(), MATERIAL_STYLES[id].knobs);
}

function social(id: SocialStyleId, name: string, caption: string): FramedStylePreset {
  return framed({ id, name, caption, category: 'social' }, () => SOCIAL_STYLES[id].build(), SOCIAL_STYLES[id].knobs);
}

function overlay(id: OverlayStyleId, name: string, caption: string): FramedStylePreset {
  return framed({ id, name, caption, category: 'overlay' }, () => OVERLAY_STYLES[id].build(), OVERLAY_STYLES[id].knobs);
}

// ── Catalog ──────────────────────────────────────────────────────────────

export const STYLE_PRESETS: readonly StylePreset[] = deepFreeze([
  controlled(
    { id: 'default', name: '聚焦', caption: '品牌居中 + 双排参数：左上品牌，右上机型镜头，左下参数，右下时间地点', category: 'brand' },
    brandFooterTemplate,
    brandFooterControls,
  ),
  controlled({ id: 'minimal', name: '简约', caption: '低干扰：仅保留核心拍摄参数', category: 'minimal' }, minimalFooterTemplate, minimalFooterControls),
  controlled({ id: 'soft-card', name: '圆润', caption: '暖白纸边 + 底部信息区', category: 'polaroid' }, polaroidFooterTemplate, softCardControls),
  framed({ id: 'classic', name: '经典', caption: '机身镜头 + 参数 + 品牌 Logo', category: 'brand' }, buildClassic),
  framed({ id: 'minimal-line', name: '极简单行', caption: '一行机身与参数，无 Logo', category: 'minimal' }, buildMinimalLine),
  framed({ id: 'dark', name: '深色', caption: '深底浅字，Logo 自动反白', category: 'brand' }, buildDark),
  framed({ id: 'blur', name: '模糊背景', caption: '照片悬浮于自身模糊背景', category: 'social' }, buildBlur),
  framed({ id: 'plain', name: '纯留白', caption: '只加留白，不加文字', category: 'minimal' }, buildPlain),
  gallery('museum-mat', '美术馆卡纸', '暖白卡纸、下沉底边与白色斜切芯线，标题居中'),
  gallery('double-reveal', '双层卡纸', '内层卡纸露出一圈色边，增加纵深'),
  gallery('black-core', '黑芯', '亮白卡纸配黑色芯线，干净利落'),
  gallery('float-mount', '浮裱', '照片浮在底板上，柔和投影，标题与参数左右对齐'),
  gallery('signed-proof', '签名样张', '版画式留白：左侧版次、居中标题、右侧参数'),
  editorial('masthead', '刊头', '杂志刊头：大标题、期号行与细线，页脚日期与参数'),
  editorial('plate', '图版', '画册图版：字距拉开的编号、衬线标题'),
  editorial('swiss-grid', '瑞士网格', '不对称宽栏、强调色块、无衬线粗标题与参数列表'),
  editorial('colophon', '版权页', '照片下方细线与标签—数值参数表'),
  overlay('date-stamp', '日期戳', '胶片相机式橙色七段数码日期，带柔光'),
  overlay('glass-caption', '毛玻璃字幕', '照片底部（或顶部）一条毛玻璃带，承载标题与参数'),
  overlay('viewfinder', '取景框', '四角取景标记、可选中心十字与参数行'),
  overlay('cinema', '电影宽银幕', '上下遮幅黑边，字幕与片头信息'),
  overlay('corner-badge', '角标', '照片角落的半透明圆角徽章：品牌 Logo、机型与参数'),
  social('no-crop', '不裁切', '固定画布比例（4:5、1:1、3:4、9:16），照片完整保留'),
  social('story-card', '故事卡片', '9:16 画布，标题放在 Instagram 快拍安全区内'),
  social('palette-card', '色卡', '照片下方一排取自照片的色块与色值'),
  social('tonal-mat', '同色卡纸', '卡纸与内衬取自照片自身的颜色'),
  material('film-135', '135 胶片', '黑色片基、两排齿孔、片边文字与画格编号', 'film'),
  material('film-120', '120 胶片', '宽片边、片边文字与画格编号，无齿孔', 'film'),
  material('filed-negative', '锉边底片', '底片夹锉边留下的不规则黑边', 'film'),
  material('instant', '即显相纸', '薄边、下缘宽厚的相纸与手写标注', 'print'),
  material('deckle-print', '毛边版画', '手工纸撕边、纸纹与衬线标题，挂在墙上', 'print'),
  material('vertical-title', '竖排题签', '宣纸纸纹、楷体竖排题签与朱文印', 'cjk'),
  material('hanging-scroll', '立轴', '天头地头、绫边、轴杆与惊燕', 'cjk'),
]);

/** Web editor picker, in display order; the first entry is the initial and reset state. */
export const WEB_STYLE_PRESETS: readonly ControlledStylePreset[] = STYLE_PRESETS.filter(
  (preset): preset is ControlledStylePreset => preset.app === 'web' && preset.kind === 'controlled',
);

/** immich-ki style cards, in display order (number-key shortcuts follow this order). */
export const IMMICH_STYLE_PRESETS: readonly FramedStylePreset[] = STYLE_PRESETS.filter(
  (preset): preset is FramedStylePreset => preset.app === 'immich-ki' && preset.kind === 'framed',
);

export function getStylePreset(id: string): StylePreset {
  const preset = STYLE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`getStylePreset: unknown style id "${id}"`);
  return preset;
}

/** Fresh full config for a framed (immich-ki) style. */
export function buildFramedStyle(id: FramedStyleId, shortEdge?: number): ImprintConfig {
  const preset = getStylePreset(id);
  if (preset.kind !== 'framed') throw new Error(`buildFramedStyle: "${id}" is not a framed style`);
  return preset.build({ shortEdge });
}
