import type { ControlSurface, MainControlConfig, ImprintConfig } from './types';

export type PresetCategory = 'brand' | 'polaroid' | 'archive' | 'social' | 'minimal' | 'custom';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  config: ImprintConfig;
  controlSurface?: ControlSurface;
}

export interface ProductPreset {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  template: LayoutTemplate;
  mainControls: MainControlConfig;
}
