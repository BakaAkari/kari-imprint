/**
 * V3 WatermarkConfig 类型定义
 *
 * 与 V2 的区别：
 * - 不再区分 corners/sides，改用 Region 列表
 * - 所有尺寸/位置使用声明式配置
 * - 支持 size_reference 控制字号基准
 */

export type FieldId =
  | 'camera_model'
  | 'lens_model'
  | 'focal_length'
  | 'aperture'
  | 'shutter'
  | 'iso'
  | 'datetime'
  | 'make'
  | 'artist'
  | 'gps'
  | 'custom_text'
  | 'empty';

/** Placeholder values for Canvas skeleton preview when no image EXIF is available. */
export const PLACEHOLDER_EXIF: Record<FieldId, string> = {
  camera_model: 'GFX100S II',
  lens_model: 'GF80mmF1.7 R WR',
  focal_length: '80mm',
  aperture: 'F1.7',
  shutter: '1/250s',
  iso: 'ISO400',
  datetime: '2026.07.10',
  make: 'FUJIFILM',
  artist: 'Baka Akari',
  gps: 'Shanghai',
  custom_text: 'AKARI PHOTO',
  empty: '',
};

export type FieldChip = {
  field_id: FieldId;
  custom_text?: string;
};

export interface TextContent {
  chips: FieldChip[];
  separator: string;
}

export interface LogoContent {
  path: string;
  color: string;
  size_level: SizeLevel | null;
  size_ratio: number | null;
}

export interface SignatureContent {
  path: string;
  invert_mono: boolean;
  size_level: SizeLevel | null;
  size_ratio: number | null;
}

export type Content = TextContent | LogoContent | SignatureContent;

export type SizeReference = 'region_height' | 'short_edge' | 'long_edge';
export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type FontFamily = 'NotoSansCJKsc-Regular.otf' | 'NotoSansCJKsc-Bold.otf';

export interface StyleConfig {
  font_size: number | null;
  font_size_level: SizeLevel | null;
  font_size_ratio: number | null;
  size_reference: SizeReference;
  color: string;
  font_family: FontFamily;
  bold: boolean;
  line_height: number;
}

export interface SlotConfig {
  enabled: boolean;
  content: Content | null;
  style: StyleConfig | null;
}

export type RegionType = 'footer-bar' | 'side-edge' | 'free';

export interface RegionConfig {
  id: string;
  type: RegionType;
  enabled: boolean;
  slots?: Record<string, SlotConfig>;
  edge?: 'left' | 'right';
  width?: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  alignment?: 'start' | 'center' | 'end';
  anchor?: Anchor;
  offset_x?: number;
  offset_y?: number;
  offset_unit?: 'pixel' | 'short_edge_ratio';
  /** footer-bar 高度占图片短边的比例；由布局引擎解析为实际像素高度。 */
  height?: number;
}

export interface MarginsConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BorderConfig {
  enabled: boolean;
  width_level: SizeLevel;
  color: string;
}

export interface CanvasConfig {
  margins: MarginsConfig;
  background: string;
  border_radius: number;
  border: BorderConfig;
}

export interface WatermarkConfigV3 {
  schema_version: 2;
  canvas: CanvasConfig;
  regions: RegionConfig[];
  defaults: StyleConfig;
  custom_text?: string;
  /** 追踪当前应用的预设 id，用于主界面显示和重置。 */
  preset_id?: string;
  /** 底部控制条模式：双排/单排。 */
  footer_mode?: FooterMode;
  /** Logo 在底栏的位置：左/中/右。 */
  logo_position?: LogoPosition;
}

export const fieldOptionsV3: { id: FieldId; label: string }[] = [
  { id: 'camera_model', label: '相机型号' },
  { id: 'lens_model', label: '镜头型号' },
  { id: 'focal_length', label: '焦距' },
  { id: 'aperture', label: '光圈' },
  { id: 'shutter', label: '快门' },
  { id: 'iso', label: 'ISO' },
  { id: 'datetime', label: '拍摄日期' },
  { id: 'make', label: '厂商品牌' },
  { id: 'artist', label: '作者' },
  { id: 'gps', label: '地理位置' },
  { id: 'custom_text', label: '自定义文本' },
];

// 主界面参数化控制类型
export type SizeLevel = 'small' | 'medium' | 'large';
export type PresetSize = SizeLevel;
export type ColorScheme = 'dark' | 'light';
export type FooterMode = 'dual-row' | 'single-row';
export type LogoPosition = 'left' | 'center' | 'right';

export type PreviewAspectRatio = '3:2' | '4:3' | '16:9' | '1:1' | '2:3';

export interface AspectRatioOption {
  id: PreviewAspectRatio;
  label: string;
  width: number;
  height: number;
}

export const PREVIEW_ASPECT_RATIOS: AspectRatioOption[] = [
  { id: '3:2', label: '3:2', width: 900, height: 600 },
  { id: '4:3', label: '4:3', width: 800, height: 600 },
  { id: '16:9', label: '16:9', width: 960, height: 540 },
  { id: '1:1', label: '1:1', width: 600, height: 600 },
  { id: '2:3', label: '2:3', width: 600, height: 900 },
];

export const FOOTER_MODE_LABELS: Record<FooterMode, string> = {
  'dual-row': '左右双排',
  'single-row': '左右单排',
};

export const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  left: '左',
  center: '中',
  right: '右',
};

export type FooterTextSlot = 'top_left' | 'bottom_left' | 'top_right' | 'bottom_right' | 'left_row' | 'right_row';
export type FooterTextSizes = Record<FooterTextSlot, SizeLevel>;

export interface MainControlConfig {
  scheme: ColorScheme;
  footer_mode: FooterMode;
  logo_position: LogoPosition;
  text_sizes: FooterTextSizes;
  logo_size: SizeLevel;
  signature_size: SizeLevel;
  top_left: FieldChip[];
  bottom_left: FieldChip[];
  top_right: FieldChip[];
  bottom_right: FieldChip[];
  left_row: FieldChip[];
  right_row: FieldChip[];
  custom_text: string;
  logo_path: string;
  signature_path: string;
  border_enabled: boolean;
  border_width_level: SizeLevel;
}

export interface WatermarkPresetV3 {
  id: string;
  name: string;
  description: string;
  // 基于中等大小/黑色/标准密度的基准配置
  base: WatermarkConfigV3;
  // 默认主界面控制
  mainControls: MainControlConfig;
}

/** 从字段 id 获取显示标签。 */
export function getFieldLabel(fieldId: FieldId): string {
  const option = fieldOptionsV3.find((o) => o.id === fieldId);
  return option?.label ?? fieldId;
}

/** 快速创建一个字段 chip。 */
export function fieldChip(fieldId: FieldId, customText?: string): FieldChip {
  return customText ? { field_id: fieldId, custom_text: customText } : { field_id: fieldId };
}

/** 将一个 chip 转换为可保存的字符串 key。 */
export function chipKey(chip: FieldChip): string {
  return chip.field_id === 'custom_text' && chip.custom_text
    ? `custom_text:${chip.custom_text}`
    : chip.field_id;
}

export const FOOTER_HEIGHT_RATIO = 0.09;
export const FONT_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.125, medium: 0.16, large: 0.20 };
export const LOGO_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.50, medium: 0.60, large: 0.72 };
export const SIGNATURE_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.15, medium: 0.20, large: 0.25 };

export const colorSchemes: Record<ColorScheme, { text: string; logo: string; background: string; border: string }> = {
  dark: { text: '#222222', logo: '#D8D8D6', background: '#FFFFFF', border: '#FFFFFF' },
  light: { text: '#F5F5F5', logo: '#FFFFFF', background: '#1A1A1A', border: '#1A1A1A' },
};

// ── 预设配置 ────────────────────────────────────────────

export const defaultStyle: StyleConfig = {
  font_size: null,
  font_size_level: 'medium',
  font_size_ratio: null,
  size_reference: 'region_height',
  color: '#222222',
  font_family: 'NotoSansCJKsc-Bold.otf',
  bold: true,
  line_height: 1.2,
};

export const presetDefaultBaseV3: WatermarkConfigV3 = {
  schema_version: 2,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      // height 由 applyMainControls 统一计算，不在预设中硬编码
      slots: {
        'left-top': {
          enabled: true,
          content: {
            chips: [{ field_id: 'make' }, { field_id: 'camera_model' }],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#222222' },
        },
        'left-bottom': {
          enabled: true,
          content: {
            chips: [
              { field_id: 'focal_length' },
              { field_id: 'aperture' },
              { field_id: 'shutter' },
              { field_id: 'iso' },
            ],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#222222' },
        },
        'right-top': { enabled: false, content: null, style: null },
        'right-bottom': { enabled: false, content: null, style: null },
        'center': { enabled: false, content: null, style: null },
        'left-logo': { enabled: false, content: null, style: null },
        'right-logo': {
          enabled: true,
          content: { path: '', color: '#D8D8D6', size_level: 'medium', size_ratio: null },
          style: null,
        },
      },
    },
  ],
};

export const presetDefaultV3: WatermarkConfigV3 = presetDefaultBaseV3;

export const presetMinimalBaseV3: WatermarkConfigV3 = {
  schema_version: 2,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      // height 由 applyMainControls 统一计算，不在预设中硬编码
      slots: {
        'left-top': { enabled: false, content: null, style: null },
        'left-bottom': { enabled: false, content: null, style: null },
        'right-top': { enabled: false, content: null, style: null },
        'right-bottom': {
          enabled: true,
          content: {
            chips: [
              { field_id: 'focal_length' },
              { field_id: 'aperture' },
              { field_id: 'shutter' },
              { field_id: 'iso' },
            ],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#2C2C2C' },
        },
        'center': { enabled: false, content: null, style: null },
        'left-logo': { enabled: false, content: null, style: null },
        'right-logo': { enabled: false, content: null, style: null },
      },
    },
  ],
};

export const presetMinimalV3: WatermarkConfigV3 = presetMinimalBaseV3;

export const presetSoftCardBaseV3: WatermarkConfigV3 = {
  schema_version: 2,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 24,
    border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      // height 由 applyMainControls 统一计算，不在预设中硬编码
      slots: {
        'left-top': {
          enabled: true,
          content: {
            chips: [{ field_id: 'custom_text', custom_text: 'AKARI PHOTO' }],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#242424' },
        },
        'left-bottom': {
          enabled: true,
          content: {
            chips: [{ field_id: 'datetime' }],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#242424' },
        },
        'right-top': {
          enabled: true,
          content: {
            chips: [{ field_id: 'camera_model' }],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#242424' },
        },
        'right-bottom': {
          enabled: true,
          content: {
            chips: [
              { field_id: 'focal_length' },
              { field_id: 'aperture' },
              { field_id: 'iso' },
            ],
            separator: ' ',
          },
          style: { ...defaultStyle, font_size_level: 'medium', font_size_ratio: null, color: '#242424' },
        },
        'center': { enabled: false, content: null, style: null },
        'left-logo': { enabled: false, content: null, style: null },
        'right-logo': {
          enabled: true,
          content: { path: '', color: '#D8D8D6', size_level: 'medium', size_ratio: null },
          style: null,
        },
      },
    },
  ],
};

export const presetSoftCardV3: WatermarkConfigV3 = presetSoftCardBaseV3;

export const presetSidesBaseV3: WatermarkConfigV3 = {
  schema_version: 2,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: false, width_level: 'medium', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      // height 由 applyMainControls 统一计算，不在预设中硬编码
      slots: {
        'left-top': { enabled: false, content: null, style: null },
        'left-bottom': { enabled: false, content: null, style: null },
        'right-top': { enabled: false, content: null, style: null },
        'right-bottom': { enabled: false, content: null, style: null },
        'center': { enabled: false, content: null, style: null },
        'left-logo': { enabled: false, content: null, style: null },
        'right-logo': { enabled: false, content: null, style: null },
      },
    },
    {
      id: 'side-left',
      type: 'side-edge',
      enabled: true,
      edge: 'left',
      alignment: 'start',
      slots: {
        line1: {
          enabled: true,
          content: {
            chips: [
              { field_id: 'make' },
              { field_id: 'camera_model' },
              { field_id: 'focal_length' },
              { field_id: 'aperture' },
              { field_id: 'shutter' },
              { field_id: 'iso' },
            ],
            separator: ' / ',
          },
          style: { ...defaultStyle, font_size_level: null, font_size_ratio: 0.05, size_reference: 'short_edge' },
        },
      },
    },
  ],
};

export const presetSidesV3: WatermarkConfigV3 = presetSidesBaseV3;

/**
 * SlotOverride — 记录用户在高级编辑中对某个 slot 的手动修改。
 * key 格式为 "regionId:slotId"（如 "footer:left-top"）。
 * 这些 overrides 在 controls 变更后仍被保留。
 */
export interface SlotOverride {
  enabled?: boolean;
  style?: Partial<StyleConfig>;
  content?: Partial<TextContent | LogoContent | SignatureContent>;
}

export type SlotOverrides = Record<string, SlotOverride>;

/**
 * 从模板和主控制参数生成渲染配置。
 *
 * 核心原则：
 * - template 的 per-slot style 被保留（如 font_size_ratio）
 * - controls 只控制 chips 列表、高度、颜色主题、logo 位置
 * - overrides 在 controls 变更后仍持久化
 * - 非 footer 区域（side-edge, free）不受影响
 */
export interface RegionOverride extends Partial<Omit<RegionConfig, 'id' | 'type' | 'slots'>> {}
export type RegionOverrides = Record<string, RegionOverride>;
export interface RootOverrides {
  canvas?: Partial<Omit<CanvasConfig, 'margins'>> & { margins?: Partial<MarginsConfig> };
  defaults?: Partial<StyleConfig>;
}

function normalizeStylePatch(base: StyleConfig, patch: Partial<StyleConfig>): StyleConfig {
  const next = { ...base, ...patch };
  if (patch.font_size !== undefined && patch.font_size !== null) {
    next.font_size_level = null;
    next.font_size_ratio = null;
  } else if (patch.font_size_ratio !== undefined && patch.font_size_ratio !== null) {
    next.font_size = null;
    next.font_size_level = null;
  } else if (patch.font_size_level !== undefined && patch.font_size_level !== null) {
    next.font_size = null;
    next.font_size_ratio = null;
  }
  return next;
}

function mergeSlotOverride(slot: SlotConfig, override: SlotOverride): SlotConfig {
  const next = structuredClone(slot);
  if (override.enabled !== undefined) next.enabled = override.enabled;
  if (override.style) next.style = normalizeStylePatch(next.style ?? defaultStyle, override.style);
  if (override.content && next.content) {
    const content = { ...next.content, ...override.content } as Content;
    if ('size_level' in content && 'size_ratio' in content) {
      const sizePatch = override.content as Partial<LogoContent | SignatureContent>;
      if (sizePatch.size_ratio !== undefined && sizePatch.size_ratio !== null) content.size_level = null;
      if (sizePatch.size_level !== undefined && sizePatch.size_level !== null) content.size_ratio = null;
    }
    next.content = content;
  }
  return next;
}

export function resolveConfig(
  template: WatermarkConfigV3,
  controls: MainControlConfig,
  slotOverrides: SlotOverrides = {},
  regionOverrides: RegionOverrides = {},
  rootOverrides: RootOverrides = {},
): WatermarkConfigV3 {
  const config = structuredClone(template);
  config.schema_version = 2;
  const scheme = colorSchemes[controls.scheme] ?? colorSchemes.dark;
  config.canvas.background = scheme.background;
  config.defaults.color = scheme.text;
  config.custom_text = controls.custom_text;
  config.footer_mode = controls.footer_mode;
  config.logo_position = controls.logo_position;
  config.canvas.border = {
    enabled: controls.border_enabled,
    width_level: controls.border_width_level,
    color: scheme.border,
  };
  if (rootOverrides.canvas?.border) {
    Object.assign(config.canvas.border, rootOverrides.canvas.border);
  }

  for (const region of config.regions) {
    const regionOverride = regionOverrides[region.id];
    if (regionOverride) Object.assign(region, regionOverride);
    if (!region.slots) continue;
    for (const slot of Object.values(region.slots)) {
      if (slot.style) slot.style.color = scheme.text;
      if (slot.content && 'color' in slot.content) slot.content.color = scheme.logo;
    }
  }

  let footer = config.regions.find((region) => region.type === 'footer-bar');
  if (!footer) {
    footer = { id: 'footer', type: 'footer-bar', enabled: true, slots: {} };
    config.regions.push(footer);
  }
  footer.enabled = true;
  footer.height = FOOTER_HEIGHT_RATIO;
  footer.slots ??= {};

  const chipMap: Partial<Record<FooterTextSlot, FieldChip[]>> = controls.footer_mode === 'dual-row'
    ? { top_left: controls.top_left, bottom_left: controls.bottom_left, top_right: controls.top_right, bottom_right: controls.bottom_right }
    : { left_row: controls.left_row, right_row: controls.right_row };
  const physicalSlot: Record<FooterTextSlot, string> = {
    top_left: 'left-top', bottom_left: 'left-bottom', top_right: 'right-top', bottom_right: 'right-bottom',
    left_row: 'left-top', right_row: 'right-top',
  };
  for (const slotId of ['left-top', 'left-bottom', 'right-top', 'right-bottom']) {
    footer.slots[slotId] = { enabled: false, content: null, style: null };
  }
  for (const [logicalId, chips] of Object.entries(chipMap) as [FooterTextSlot, FieldChip[]][]) {
    const slotId = physicalSlot[logicalId];
    const existing = template.regions.find((region) => region.id === footer!.id)?.slots?.[slotId];
    footer.slots[slotId] = {
      enabled: chips.length > 0,
      content: chips.length > 0 ? { chips, separator: existing?.content && 'separator' in existing.content ? existing.content.separator : ' ' } : null,
      style: chips.length > 0 ? {
        ...(existing?.style ?? config.defaults),
        font_size: null,
        font_size_level: controls.text_sizes[logicalId],
        font_size_ratio: null,
        color: scheme.text,
      } : null,
    };
  }

  for (const slotId of ['left-logo', 'right-logo', 'center']) {
    footer.slots[slotId] = { enabled: false, content: null, style: null };
  }
  const logoSlot = controls.logo_position === 'left' ? 'left-logo' : controls.logo_position === 'right' ? 'right-logo' : 'center';
  footer.slots[logoSlot] = {
    enabled: true,
    content: { path: controls.logo_path, color: scheme.logo, size_level: controls.logo_size, size_ratio: null },
    style: null,
  };

  let signatureRegion = config.regions.find((region) => region.type === 'free');
  if (controls.signature_path) {
    if (!signatureRegion) {
      signatureRegion = { id: 'signature', type: 'free', enabled: true, anchor: 'bottom-right', offset_x: -0.05, offset_y: -0.05, offset_unit: 'short_edge_ratio', slots: {} };
      config.regions.push(signatureRegion);
    }
    signatureRegion.enabled = true;
    signatureRegion.slots ??= {};
    signatureRegion.slots.sig1 = {
      enabled: true,
      content: { path: controls.signature_path, invert_mono: false, size_level: controls.signature_size, size_ratio: null },
      style: null,
    };
  } else if (signatureRegion) {
    signatureRegion.enabled = false;
  }

  for (const [key, override] of Object.entries(slotOverrides)) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const region = config.regions.find((item) => item.id === key.slice(0, separator));
    const slotId = key.slice(separator + 1);
    const slot = region?.slots?.[slotId];
    if (region && slot) region.slots![slotId] = mergeSlotOverride(slot, override);
  }
  if (rootOverrides.canvas) {
    const { margins, ...canvasPatch } = rootOverrides.canvas;
    Object.assign(config.canvas, canvasPatch);
    if (margins) Object.assign(config.canvas.margins, margins);
  }
  if (rootOverrides.defaults) Object.assign(config.defaults, rootOverrides.defaults);
  return config;
}

/**
 * 创建默认 WatermarkConfigV3（用于初始渲染）。
 */
// 主界面控制的缺省值
export const defaultMainControls: MainControlConfig = {
  scheme: 'dark', footer_mode: 'dual-row', logo_position: 'right',
  text_sizes: { top_left: 'medium', bottom_left: 'medium', top_right: 'medium', bottom_right: 'medium', left_row: 'medium', right_row: 'medium' },
  logo_size: 'medium', signature_size: 'medium',
  border_enabled: false, border_width_level: 'medium',
  top_left: [{ field_id: 'make' }, { field_id: 'camera_model' }],
  bottom_left: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
  top_right: [], bottom_right: [],
  left_row: [{ field_id: 'make' }, { field_id: 'camera_model' }, { field_id: 'focal_length' }, { field_id: 'aperture' }],
  right_row: [{ field_id: 'shutter' }, { field_id: 'iso' }],
  custom_text: '', logo_path: '', signature_path: '',
};

export function createDefaultWatermarkConfigV3(): WatermarkConfigV3 {
  return resolveConfig(presetDefaultBaseV3, defaultMainControls);
}

export function inferMainControls(config: WatermarkConfigV3): MainControlConfig {
  const controls = structuredClone(defaultMainControls);
  controls.footer_mode = config.footer_mode ?? controls.footer_mode;
  controls.logo_position = config.logo_position ?? controls.logo_position;
  controls.custom_text = config.custom_text ?? '';
  return controls;
}

export function getPresetMainControls(preset: WatermarkPresetV3): MainControlConfig {
  return preset.mainControls ? structuredClone(preset.mainControls) : structuredClone(defaultMainControls);
}
