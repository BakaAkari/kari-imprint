import {
  defaultControlSurface,
  defaultMainControls,
  presetDefaultBaseV3,
  presetMinimalBaseV3,
  presetSoftCardBaseV3,
  type ControlSurface,
  type MainControlConfig,
} from './v3Types';
import type { LayoutTemplateV3, ProductPresetV3 } from './v3TemplateModel';

const cloneControls = (controls: MainControlConfig): MainControlConfig => structuredClone(controls);
const cloneSurface = (surface: ControlSurface): ControlSurface => structuredClone(surface);

export const footerControlSurface: ControlSurface = cloneSurface(defaultControlSurface);

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

const baseControls: MainControlConfig = {
  ...cloneControls(defaultMainControls),
  layout_structure: 'footer',
  primary_start: [],
  secondary_start: [],
  primary_end: [],
  secondary_end: [],
  custom_text: '',
  logo_path: '',
  signature_path: '',
};

export const productPresetsV3: ProductPresetV3[] = [
  {
    id: 'default',
    name: '品牌底栏',
    description: '手机影像风：左侧 EXIF，右侧品牌 Logo',
    category: 'brand',
    template: layoutTemplatesV3.brandFooter,
    mainControls: {
      ...cloneControls(baseControls),
      primary_start: [{ field_id: 'make' }, { field_id: 'camera_model' }],
      secondary_start: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
      primary_end: [{ field_id: 'shutter' }, { field_id: 'iso' }],
    },
  },
  {
    id: 'minimal',
    name: '极简参数',
    description: '低干扰：仅保留核心拍摄参数',
    category: 'minimal',
    template: layoutTemplatesV3.minimalFooter,
    mainControls: {
      ...cloneControls(baseControls),
      secondary_end: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
      primary_end: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
    },
  },
  {
    id: 'soft-card',
    name: '拍立得白边',
    description: '暖白纸边 + 底部信息区',
    category: 'polaroid',
    template: layoutTemplatesV3.polaroidFooter,
    mainControls: {
      ...cloneControls(baseControls),
      primary_start: [{ field_id: 'custom_text', custom_text: 'AKARI PHOTO' }],
      secondary_start: [{ field_id: 'datetime' }],
      primary_end: [{ field_id: 'camera_model' }],
      secondary_end: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'iso' }],
      custom_text: 'AKARI PHOTO',
    },
  },
];

export function clonePresetControls(preset: ProductPresetV3): MainControlConfig {
  return cloneControls(preset.mainControls);
}
