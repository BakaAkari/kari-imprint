/**
 * V3 WatermarkConfig 类型定义
 *
 * 与 V2 的区别：
 * - 不再区分 corners/sides，改用 Region 列表
 * - 所有尺寸/位置使用声明式配置
 * - 支持 size_reference 控制字号基准
 */

import { FONT_SIZE_RATIOS, LOGO_SIZE_RATIOS, SIGNATURE_SIZE_RATIOS } from './designTokens';

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
  size_level: SizeLevel | null;
  size_ratio: number | null;
  orientation: AssetOrientation;
  placement: AssetPlacement;
  track: AssetTrack;
}

export interface SignatureContent {
  path: string;
  invert_mono: boolean;
  size_level: SizeLevel | null;
  size_ratio: number | null;
  orientation: AssetOrientation;
  placement: AssetPlacement;
  track: AssetTrack;
}

export type Content = TextContent | LogoContent | SignatureContent;

export type SizeReference = 'region_height' | 'short_edge' | 'long_edge';
export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type Alignment = 'start' | 'center' | 'end';
export type TextDirection = 'horizontal' | 'rotate-cw' | 'rotate-ccw' | 'vertical-glyphs';
export type TextOrientationPolicy = 'auto' | 'horizontal' | 'rotate-with-edge' | TextDirection;
export type AssetOrientation = 'upright' | 'follow-flow' | 'rotate-cw' | 'rotate-ccw';
export type AssetPlacement = 'start' | 'center' | 'end';
export type AssetTrack = 'primary' | 'secondary' | 'span';
export type FlowMode = 'single-track' | 'dual-track';
export type LayoutStructure = 'footer' | 'side-left' | 'side-right';
export type FlowSlotId = 'primary-start' | 'primary-end' | 'secondary-start' | 'secondary-end' | 'asset';
export interface PaddingConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
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
  text_direction: TextDirection | null;
}

export interface SlotConfig {
  enabled: boolean;
  content: Content | null;
  style: StyleConfig | null;
}

export type RegionType = 'footer-bar' | 'side-bar' | 'free';

export interface FlowLayoutConfig {
  mode: FlowMode;
  main_alignment: 'start' | 'center' | 'end' | 'space-between';
  cross_alignment: Alignment;
  track_order: 'photo-outward' | 'outward-photo';
  track_gap: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  item_gap: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  track_ratios: [number, number];
}

export interface RegionConfig {
  id: string;
  type: RegionType;
  enabled: boolean;
  slots?: Record<string, SlotConfig>;
  edge?: 'left' | 'right';
  width?: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  alignment?: Alignment;
  vertical_alignment?: Alignment;
  padding?: Partial<PaddingConfig>;
  layout?: FlowLayoutConfig;
  text_orientation?: TextOrientationPolicy;
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
  schema_version: 3;
  canvas: CanvasConfig;
  regions: RegionConfig[];
  defaults: StyleConfig;
  custom_text?: string;
  /** 追踪当前应用的预设 id，用于主界面显示和重置。 */
  preset_id?: string;
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

export const FLOW_MODE_LABELS: Record<FlowMode, string> = {
  'dual-track': '上下双排',
  'single-track': '单排',
};

export const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  left: '左',
  center: '中',
  right: '右',
};

export type FooterTextSlot = 'primary_start' | 'primary_end' | 'secondary_start' | 'secondary_end';
export type FooterTextSizes = Record<FooterTextSlot, SizeLevel>;

export interface MainControlConfig {
  scheme: ColorScheme;
  layout_structure: LayoutStructure;
  flow_mode: FlowMode;
  logo_enabled: boolean;
  logo_position: LogoPosition;
  text_sizes: FooterTextSizes;
  logo_size: SizeLevel;
  signature_size: SizeLevel;
  primary_start: FieldChip[];
  primary_end: FieldChip[];
  secondary_start: FieldChip[];
  secondary_end: FieldChip[];
  custom_text: string;
  logo_path: string;
  signature_path: string;
  border_enabled: boolean;
  border_width_level: SizeLevel;
}

export const FOOTER_HEIGHT_RATIO = 0.09;

export { FONT_SIZE_RATIOS, LOGO_SIZE_RATIOS, SIGNATURE_SIZE_RATIOS };

export interface FooterControlSurface {
  enabled: boolean;
  regionId: string;
  heightRatio?: number;
  slots: Partial<Record<FooterTextSlot, string>>;
  logoSlots: Partial<Record<LogoPosition, string>>;
}

export interface SignatureControlSurface {
  enabled: boolean;
  regionId: string;
  slotId: string;
  anchor: Anchor;
  offset_x: number;
  offset_y: number;
  offset_unit: 'pixel' | 'short_edge_ratio';
}

export interface ControlSurface {
  footer: FooterControlSurface;
  logo: { enabled: boolean };
  signature: SignatureControlSurface;
  border: { enabled: boolean };
}

export const defaultControlSurface: ControlSurface = {
  footer: {
    enabled: true,
    regionId: 'footer',
    heightRatio: FOOTER_HEIGHT_RATIO,
    slots: {
      primary_start: 'primary-start',
      primary_end: 'primary-end',
      secondary_start: 'secondary-start',
      secondary_end: 'secondary-end',
    },
    logoSlots: { left: 'asset', center: 'asset', right: 'asset' },
  },
  logo: { enabled: true },
  signature: {
    enabled: true,
    regionId: 'signature',
    slotId: 'sig1',
    anchor: 'bottom-right',
    offset_x: -0.05,
    offset_y: -0.05,
    offset_unit: 'short_edge_ratio',
  },
  border: { enabled: true },
};

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

export const colorSchemes: Record<ColorScheme, { text: string; background: string; border: string }> = {
  dark: { text: '#222222', background: '#FFFFFF', border: '#FFFFFF' },
  light: { text: '#F5F5F5', background: '#1A1A1A', border: '#1A1A1A' },
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
  text_direction: null,
};

/**
 * Preset templates carry only structural chrome that MainControlConfig does not own:
 *   - canvas margins/background/border_radius/border (border further split by controlSurface.border)
 *   - defaults style (baseline typography for slots the controls don't cover)
 *   - region skeleton: id / type / enabled / layout / text_orientation
 *
 * Controlled slots (footer text slots and Logo asset slot) are deliberately absent.
 * MainControlConfig is the single authoritative source for their content, style,
 * enabled flag, and Logo position — resolveConfig() reconstructs them purely from
 * controls, so there is nowhere for a duplicate chip list, font weight, or color
 * to hide inside a preset template.
 */
export const presetDefaultBaseV3: WatermarkConfigV3 = {
  schema_version: 3,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: true, width_level: 'small', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      layout: defaultFlowLayout(),
      text_orientation: 'auto',
      // height 由 applyMainControls 统一计算，不在预设中硬编码
      // slots 由 MainControlConfig 权威构造，模板不携带任何 controlled slot。
    },
  ],
};

export const presetDefaultV3: WatermarkConfigV3 = presetDefaultBaseV3;

export const presetMinimalBaseV3: WatermarkConfigV3 = {
  schema_version: 3,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 0,
    border: { enabled: false, width_level: 'small', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      layout: defaultFlowLayout(),
      text_orientation: 'auto',
    },
  ],
};

export const presetMinimalV3: WatermarkConfigV3 = presetMinimalBaseV3;

export const presetSoftCardBaseV3: WatermarkConfigV3 = {
  schema_version: 3,
  canvas: {
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#FFFFFF',
    border_radius: 24,
    // 拍立得的白纸边由 border 实现；controlSurface.border.enabled 打开时由 controls.border_enabled 权威覆盖。
    border: { enabled: true, width_level: 'medium', color: '#FFFFFF' },
  },
  defaults: defaultStyle,
  regions: [
    {
      id: 'footer',
      type: 'footer-bar',
      enabled: true,
      layout: defaultFlowLayout(),
      text_orientation: 'auto',
    },
  ],
};

export const presetSoftCardV3: WatermarkConfigV3 = presetSoftCardBaseV3;

/**
 * SlotOverride — 记录用户在高级编辑中对某个 slot 的手动修改。
 * key 格式为 "regionId:slotId"（如 "footer:primary-start"）。
 * 这些 overrides 在 controls 变更后仍被保留。
 */
export interface SlotOverride {
  enabled?: boolean;
  style?: Partial<StyleConfig>;
  content?: Partial<TextContent | LogoContent | SignatureContent>;
}

export type SlotOverrides = Record<string, SlotOverride>;

/**
 * 从模板 + 主控制参数 + 三层 overrides 合成完整 WatermarkConfigV3。
 *
 * 核心原则（与 v3PresetSession + preset 定义共同构成单一真相源）：
 * - Controlled slot（footer 文本 + Logo asset）的 content/style 完全由
 *   `controls` 权威决定；template 中不允许携带任何 controlled slot。
 * - `controls.logo_enabled=false` 时 asset slot 保持 disabled，
 *   Layout 引擎不预留空间，Canvas 不绘制骨架，API payload 与预览一致。
 * - `controlSurface` 声明主控制面在当前 template 上允许影响的结构。
 * - overrides 是用户在选择预设后的临时手动修改；由 V3HomePage 在切换
 *   预设时清空，此函数只按当前值把它们叠加到合成结果上。
 * - 非 footer 区域（free）默认不受 controls 影响。
 */
export interface RegionOverride extends Partial<Omit<RegionConfig, 'id' | 'slots'>> {}
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

export function defaultFlowLayout(): FlowLayoutConfig {
  return {
    mode: 'dual-track', main_alignment: 'space-between', cross_alignment: 'center',
    track_order: 'photo-outward',
    track_gap: { mode: 'short_edge_ratio', value: 0.012 },
    item_gap: { mode: 'short_edge_ratio', value: 0.012 },
    track_ratios: [0.6, 0.4],
  };
}

export function resolveConfig(
  template: WatermarkConfigV3,
  controls: MainControlConfig,
  slotOverrides: SlotOverrides = {},
  regionOverrides: RegionOverrides = {},
  rootOverrides: RootOverrides = {},
  controlSurface: ControlSurface = defaultControlSurface,
): WatermarkConfigV3 {
  const config = structuredClone(template);
  config.schema_version = 3;
  const scheme = colorSchemes[controls.scheme] ?? colorSchemes.dark;
  config.canvas.background = scheme.background;
  config.defaults.color = scheme.text;
  config.custom_text = controls.custom_text;
  config.logo_position = controls.logo_position;
  if (controlSurface.border.enabled) {
    config.canvas.border = {
      enabled: controls.border_enabled,
      width_level: controls.border_width_level,
      color: scheme.border,
    };
    if (rootOverrides.canvas?.border) {
      Object.assign(config.canvas.border, rootOverrides.canvas.border);
    }
  }

  for (const region of config.regions) {
    const regionOverride = regionOverrides[region.id];
    if (regionOverride) Object.assign(region, regionOverride);
    if (!region.slots) continue;
    for (const slot of Object.values(region.slots)) {
      if (slot.style) slot.style.color = scheme.text;
    }
  }

  const footerSurface = controlSurface.footer;
  let footer = config.regions.find((region) => region.id === footerSurface.regionId);
  if (footerSurface.enabled) {
    if (!footer) {
      footer = { id: footerSurface.regionId, type: 'footer-bar', enabled: true, slots: {} };
      config.regions.push(footer);
    }
    footer.enabled = true;
    // 应用布局结构控制（底/左/右）
    if (controls.layout_structure === 'footer') {
      footer.type = 'footer-bar';
      delete (footer as any).edge;
      delete (footer as any).width;
    } else {
      footer.type = 'side-bar';
      footer.edge = controls.layout_structure === 'side-left' ? 'left' : 'right';
      footer.width = { mode: 'short_edge_ratio', value: 0.12 };
      delete (footer as any).height;
    }
    if (footer.type === 'footer-bar') {
      footer.height = footerSurface.heightRatio ?? FOOTER_HEIGHT_RATIO;
    } else if (footer.type === 'side-bar') {
      footer.height = undefined;
      footer.edge ??= 'right';
      footer.width ??= { mode: 'short_edge_ratio', value: 0.12 };
    }
    footer.slots ??= {};

    const chipMap: Partial<Record<FooterTextSlot, FieldChip[]>> = {
      primary_start: controls.primary_start,
      primary_end: controls.primary_end,
      secondary_start: controls.secondary_start,
      secondary_end: controls.secondary_end,
    };
    footer.layout = {
      ...(footer.layout ?? defaultFlowLayout()),
      mode: controls.flow_mode === 'single-track' ? 'single-track' : 'dual-track',
    };
    const controlledSlotIds = new Set<string>([
      ...Object.values(footerSurface.slots).filter((slotId): slotId is string => Boolean(slotId)),
      ...Object.values(footerSurface.logoSlots).filter((slotId): slotId is string => Boolean(slotId)),
    ]);
    for (const slotId of controlledSlotIds) {
      footer.slots[slotId] = { enabled: false, content: null, style: null };
    }
    for (const [logicalId, chips] of Object.entries(chipMap) as [FooterTextSlot, FieldChip[]][]) {
      const slotId = footerSurface.slots[logicalId];
      if (!slotId) continue;
      // Controlled slot 的 content/style 完全由 controls 决定；
      // preset template 中不允许携带任何 controlled slot（见 v3Types.ts 的 preset*Base 定义）。
      footer.slots[slotId] = {
        enabled: chips.length > 0,
        content: chips.length > 0 ? { chips, separator: ' ' } : null,
        style: chips.length > 0 ? {
          ...config.defaults,
          font_size: null,
          font_size_level: controls.text_sizes[logicalId],
          font_size_ratio: null,
          color: scheme.text,
        } : null,
      };
    }

    if (controlSurface.logo.enabled) {
      const logoSlot = footerSurface.logoSlots[controls.logo_position];
      if (logoSlot) {
        if (controls.logo_enabled) {
          footer.slots[logoSlot] = {
            enabled: true,
            content: {
              path: controls.logo_path,
              size_level: controls.logo_size,
              size_ratio: null,
              orientation: 'upright',
              placement: controls.logo_position === 'left' ? 'start' : controls.logo_position === 'right' ? 'end' : 'center',
              track: 'span',
            },
            style: null,
          };
        } else {
          // logo_enabled=false 时明确 disabled，layout 引擎不会预留空间，
          // Canvas 不绘制骨架，PIL 也跳过对应 element。
          footer.slots[logoSlot] = { enabled: false, content: null, style: null };
        }
      }
    }
  }

  const signatureSurface = controlSurface.signature;
  let signatureRegion = config.regions.find((region) => region.id === signatureSurface.regionId);
  if (signatureSurface.enabled && controls.signature_path) {
    if (!signatureRegion) {
      signatureRegion = {
        id: signatureSurface.regionId,
        type: 'free',
        enabled: true,
        anchor: signatureSurface.anchor,
        offset_x: signatureSurface.offset_x,
        offset_y: signatureSurface.offset_y,
        offset_unit: signatureSurface.offset_unit,
        slots: {},
      };
      config.regions.push(signatureRegion);
    }
    signatureRegion.enabled = true;
    signatureRegion.anchor = signatureSurface.anchor;
    signatureRegion.offset_x = signatureSurface.offset_x;
    signatureRegion.offset_y = signatureSurface.offset_y;
    signatureRegion.offset_unit = signatureSurface.offset_unit;
    signatureRegion.slots ??= {};
    signatureRegion.slots[signatureSurface.slotId] = {
      enabled: true,
      content: { path: controls.signature_path, invert_mono: false, size_level: controls.signature_size, size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' },
      style: null,
    };
  } else if (signatureRegion && signatureSurface.enabled) {
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
