import type { ControlSurface, MainControlConfig, ImprintConfig } from './types';
import { WEB_STYLE_PRESETS } from './stylePresets';
import type { PresetCategory } from './templateModel';
import type { RailPreset } from './components/ImagePresetRail';

export type ImprintPreset = RailPreset<ImprintConfig> & {
  category: PresetCategory;
  mainControls: MainControlConfig;
  controlSurface?: ControlSurface;
};

export const imprintPresets: readonly ImprintPreset[] = WEB_STYLE_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  description: preset.caption,
  category: preset.category,
  config: preset.template.config,
  mainControls: preset.mainControls,
  controlSurface: preset.template.controlSurface,
}));

export const imprintPresetMeta: Record<string, Pick<ImprintPreset, 'category' | 'mainControls' | 'controlSurface'>> =
  Object.fromEntries(
    WEB_STYLE_PRESETS.map((preset) => [preset.id, {
      category: preset.category,
      mainControls: preset.mainControls,
      controlSurface: preset.template.controlSurface,
    }]),
  );

export const defaultPresetMeta = imprintPresetMeta.default;
