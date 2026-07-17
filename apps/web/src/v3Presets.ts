import type { RailPreset } from './components/ImagePresetRail';
import {
  presetDefaultBaseV3,
  presetMinimalBaseV3,
  presetSidesBaseV3,
  presetSoftCardBaseV3,
  type MainControlConfig,
  type WatermarkConfigV3,
} from './v3Types';
import { defaultMainControls } from './v3Types';

export interface PresetMeta {
  id: string;
  name: string;
  description: string;
  mainControls: MainControlConfig;
}

export const watermarkPresetsV3: RailPreset<WatermarkConfigV3>[] = [
  {
    id: 'default',
    name: '默认排版',
    description: '底部栏：左上品牌+型号，左下参数，右侧自动 Logo',
    config: presetDefaultBaseV3,
  },
  {
    id: 'minimal',
    name: '极简参数',
    description: '仅右下显示核心拍摄参数',
    config: presetMinimalBaseV3,
  },
  {
    id: 'soft-card',
    name: '圆角卡片',
    description: '圆角+高底栏，适合社交媒体',
    config: presetSoftCardBaseV3,
  },
  {
    id: 'sides',
    name: '左右居中',
    description: '底部 Logo + 左侧垂直参数',
    config: presetSidesBaseV3,
  },
];

export const watermarkPresetMetaV3: Record<string, { mainControls: MainControlConfig }> = {
  default: {
    mainControls: {
      scheme: 'dark',
      footer_mode: 'dual-row',
      logo_position: 'right',
      text_sizes: { top_left: 'medium', bottom_left: 'medium', top_right: 'medium', bottom_right: 'medium', left_row: 'medium', right_row: 'medium' },
      logo_size: 'medium',
      signature_size: 'medium',
      top_left: [{ field_id: 'make' }, { field_id: 'camera_model' }],
      bottom_left: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
      top_right: [],
      bottom_right: [],
      left_row: [{ field_id: 'make' }, { field_id: 'camera_model' }, { field_id: 'focal_length' }, { field_id: 'aperture' }],
      right_row: [{ field_id: 'shutter' }, { field_id: 'iso' }],
      custom_text: '',
      logo_path: '',
      signature_path: '',
      border_enabled: false, border_width_level: 'medium',    },
  },
  minimal: {
    mainControls: {
      scheme: 'dark',
      footer_mode: 'dual-row',
      logo_position: 'right',
      text_sizes: { top_left: 'medium', bottom_left: 'medium', top_right: 'medium', bottom_right: 'medium', left_row: 'medium', right_row: 'medium' },
      logo_size: 'medium',
      signature_size: 'medium',
      top_left: [],
      bottom_left: [],
      top_right: [],
      bottom_right: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
      left_row: [],
      right_row: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'shutter' }, { field_id: 'iso' }],
      custom_text: '',
      logo_path: '',
      signature_path: '',
      border_enabled: false, border_width_level: 'medium',    },
  },
  'soft-card': {
    mainControls: {
      scheme: 'dark',
      footer_mode: 'dual-row',
      logo_position: 'right',
      text_sizes: { top_left: 'medium', bottom_left: 'medium', top_right: 'medium', bottom_right: 'medium', left_row: 'medium', right_row: 'medium' },
      logo_size: 'medium',
      signature_size: 'medium',
      top_left: [{ field_id: 'custom_text', custom_text: 'AKARI PHOTO' }],
      bottom_left: [{ field_id: 'datetime' }],
      top_right: [{ field_id: 'camera_model' }],
      bottom_right: [{ field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'iso' }],
      left_row: [{ field_id: 'custom_text', custom_text: 'AKARI PHOTO' }],
      right_row: [{ field_id: 'camera_model' }, { field_id: 'focal_length' }, { field_id: 'aperture' }, { field_id: 'iso' }],
      custom_text: 'AKARI PHOTO',
      logo_path: '',
      signature_path: '',
      border_enabled: false, border_width_level: 'medium',    },
  },
  sides: {
    mainControls: {
      scheme: 'dark',
      footer_mode: 'dual-row',
      logo_position: 'left',
      text_sizes: { top_left: 'medium', bottom_left: 'medium', top_right: 'medium', bottom_right: 'medium', left_row: 'medium', right_row: 'medium' },
      logo_size: 'medium',
      signature_size: 'medium',
      top_left: [],
      bottom_left: [],
      top_right: [],
      bottom_right: [],
      left_row: [],
      right_row: [],
      custom_text: '',
      logo_path: '',
      signature_path: '',
      border_enabled: false, border_width_level: 'medium',    },
  },
};

export const defaultPresetMetaV3 = watermarkPresetMetaV3['default'];

/**
 * 根据预设 base config 对象引用查找对应的 mainControls。
 */
export function getPresetMainControls(template: WatermarkConfigV3): MainControlConfig {
  for (const preset of watermarkPresetsV3) {
    if (preset.config === template) {
      const meta = watermarkPresetMetaV3[preset.id];
      if (meta) {
        return { ...defaultMainControls, ...meta.mainControls };
      }
    }
  }
  return defaultMainControls;
}
