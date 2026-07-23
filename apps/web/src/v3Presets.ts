import type { ControlSurface, MainControlConfig, WatermarkConfigV3 } from './v3Types';
import { productPresetsV3 } from './v3PresetDefinitions';
import type { PresetCategory } from './v3TemplateModel';
import type { RailPreset } from './components/ImagePresetRail';

export type WatermarkPresetV3 = RailPreset<WatermarkConfigV3> & {
  category: PresetCategory;
  mainControls: MainControlConfig;
  controlSurface?: ControlSurface;
};

export const watermarkPresetsV3: readonly WatermarkPresetV3[] = productPresetsV3.map((preset) => ({
  id: preset.id,
  name: preset.name,
  description: preset.description,
  category: preset.category,
  config: preset.template.config,
  mainControls: preset.mainControls,
  controlSurface: preset.template.controlSurface,
}));

export const watermarkPresetMetaV3: Record<string, Pick<WatermarkPresetV3, 'category' | 'mainControls' | 'controlSurface'>> =
  Object.fromEntries(
    productPresetsV3.map((preset) => [preset.id, {
      category: preset.category,
      mainControls: preset.mainControls,
      controlSurface: preset.template.controlSurface,
    }]),
  );

export const defaultPresetMetaV3 = watermarkPresetMetaV3.default;
