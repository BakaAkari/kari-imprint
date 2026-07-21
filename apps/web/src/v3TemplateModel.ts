import type { ControlSurface, MainControlConfig, WatermarkConfigV3 } from './v3Types';

export type PresetCategory = 'brand' | 'polaroid' | 'archive' | 'social' | 'minimal' | 'custom';

export interface LayoutTemplateV3 {
  id: string;
  name: string;
  description: string;
  config: WatermarkConfigV3;
  controlSurface?: ControlSurface;
}

export interface ProductPresetV3 {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  template: LayoutTemplateV3;
  mainControls: MainControlConfig;
}
