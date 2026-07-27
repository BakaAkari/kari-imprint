import type { ControlSurface, MainControlConfig, ImprintConfig } from './types';
import { productPresets } from './presetDefinitions';
import type { PresetCategory } from './templateModel';
import type { RailPreset } from './components/ImagePresetRail';

export type ImprintPreset = RailPreset<ImprintConfig> & {
  category: PresetCategory;
  mainControls: MainControlConfig;
  controlSurface?: ControlSurface;
};

export const imprintPresets: readonly ImprintPreset[] = productPresets.map((preset) => ({
  id: preset.id,
  name: preset.name,
  description: preset.description,
  category: preset.category,
  config: preset.template.config,
  mainControls: preset.mainControls,
  controlSurface: preset.template.controlSurface,
}));

export const imprintPresetMeta: Record<string, Pick<ImprintPreset, 'category' | 'mainControls' | 'controlSurface'>> =
  Object.fromEntries(
    productPresets.map((preset) => [preset.id, {
      category: preset.category,
      mainControls: preset.mainControls,
      controlSurface: preset.template.controlSurface,
    }]),
  );

export const defaultPresetMeta = imprintPresetMeta.default;
