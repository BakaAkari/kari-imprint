import type { ControlSurface, ImprintConfig } from './types';

export type PresetCategory = 'brand' | 'polaroid' | 'archive' | 'social' | 'minimal' | 'gallery' | 'editorial' | 'custom';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  config: ImprintConfig;
  controlSurface?: ControlSurface;
}
