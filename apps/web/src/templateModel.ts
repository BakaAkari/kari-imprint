import type { ControlSurface, ImprintConfig } from './types';

export type PresetCategory = 'brand' | 'polaroid' | 'archive' | 'social' | 'minimal' | 'custom';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  config: ImprintConfig;
  controlSurface?: ControlSurface;
}
