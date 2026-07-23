/**
 * V3 产品预设定义 — 单一真相源
 *
 * 每个预设是一份**自包含、显式、深冻结**的产品状态快照：
 *   template.config — Chrome：canvas 参数、defaults 样式、region 骨架 + flow 布局。
 *                     Controlled slots（footer 文本、Logo 资源）不在 template 中出现，
 *                     完全由 mainControls 决定，杜绝两处权威。
 *   mainControls   — Behavior：完整、显式声明所有 MainControlConfig 字段。
 *                    每个预设独立持有完整参数，不存在单独的全局默认方案。
 *   controlSurface — 预设允许主控制面影响的结构。
 *
 * 开发期通过 deepFreeze 保证预设不可变；调用方通过
 * `createPresetSession` (v3PresetSession.ts) 拿到 mutation-safe 深拷贝。
 * 稳定性回归见 apps/web/scripts/verifyPresetContract.mts。
 */

import {
  defaultControlSurface,
  presetDefaultBaseV3,
  presetMinimalBaseV3,
  presetSoftCardBaseV3,
  type ControlSurface,
  type MainControlConfig,
} from './v3Types';
import type { LayoutTemplateV3, ProductPresetV3 } from './v3TemplateModel';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// Vite exposes import.meta.env.PROD; deep-freeze only outside production builds
// to keep the cost off the hot path in shipped code.
const IS_DEV = !(import.meta as ImportMeta).env?.PROD;
const finalize = <T,>(value: T): T => (IS_DEV ? deepFreeze(value) : Object.freeze(value) as T);

export const footerControlSurface: ControlSurface = finalize(structuredClone(defaultControlSurface));

export const layoutTemplatesV3: Record<string, LayoutTemplateV3> = {
  brandFooter: {
    id: 'brandFooter',
    name: '品牌底栏模板',
    description: '底部区域驱动的 EXIF + Logo 模板',
    config: presetDefaultBaseV3,
    controlSurface: footerControlSurface,
  },
  minimalFooter: {
    id: 'minimalFooter',
    name: '极简底栏模板',
    description: '极简参数信息模板',
    config: presetMinimalBaseV3,
    controlSurface: footerControlSurface,
  },
  polaroidFooter: {
    id: 'polaroidFooter',
    name: '拍立得底栏模板',
    description: '暖白纸边 + 底部信息模板',
    config: presetSoftCardBaseV3,
    controlSurface: footerControlSurface,
  },
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
  logo_position: 'right',
  text_sizes: {
    primary_start: 'medium',
    primary_end: 'medium',
    secondary_start: 'medium',
    secondary_end: 'medium',
  },
  logo_size: 'medium',
  signature_size: 'medium',
  border_enabled: true,
  border_width_level: 'small',
  primary_start: [{ field_id: 'make' }, { field_id: 'camera_model' }],
  primary_end: [{ field_id: 'shutter' }, { field_id: 'iso' }],
  secondary_start: [
    { field_id: 'focal_length' },
    { field_id: 'aperture' },
    { field_id: 'shutter' },
    { field_id: 'iso' },
  ],
  secondary_end: [],
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

export const productPresetsV3: readonly ProductPresetV3[] = finalize([
  {
    id: 'default',
    name: '品牌底栏',
    description: '手机影像风：左侧 EXIF，右侧品牌 Logo',
    category: 'brand',
    template: layoutTemplatesV3.brandFooter,
    mainControls: brandFooterControls,
  },
  {
    id: 'minimal',
    name: '极简参数',
    description: '低干扰：仅保留核心拍摄参数',
    category: 'minimal',
    template: layoutTemplatesV3.minimalFooter,
    mainControls: minimalFooterControls,
  },
  {
    id: 'soft-card',
    name: '拍立得白边',
    description: '暖白纸边 + 底部信息区',
    category: 'polaroid',
    template: layoutTemplatesV3.polaroidFooter,
    mainControls: softCardControls,
  },
]);
