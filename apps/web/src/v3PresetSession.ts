/**
 * Preset session transition — the ONE authoritative path from a ProductPreset
 * to the editor's live state bundle.
 *
 * Every entry point that changes which preset is active — initial mount, reset,
 * preset picker click, and the contract test suite — must go through
 * `createPresetSession(preset)`. Any other path is a bug: it would silently
 * diverge from what the reset button and the preset picker produce.
 *
 * The returned session is a fresh deep clone; the caller may freely mutate it
 * without affecting the source preset definition.
 */

import {
  defaultControlSurface,
  type ControlSurface,
  type MainControlConfig,
  type RegionOverrides,
  type RootOverrides,
  type SlotOverrides,
  type WatermarkConfigV3,
} from './v3Types';
import { productPresetsV3 } from './v3PresetDefinitions';
import type { ProductPresetV3 } from './v3TemplateModel';

export interface PresetSession {
  template: WatermarkConfigV3;
  controls: MainControlConfig;
  controlSurface: ControlSurface;
  slotOverrides: SlotOverrides;
  regionOverrides: RegionOverrides;
  rootOverrides: RootOverrides;
}

export function getProductPreset(id: string): ProductPresetV3 {
  const preset = productPresetsV3.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`getProductPreset: unknown preset id "${id}"`);
  }
  return preset;
}

/** 首屏与重置直接使用预设列表第一项，不维护独立默认方案。 */
export function getFirstProductPreset(): ProductPresetV3 {
  const preset = productPresetsV3[0];
  if (!preset) throw new Error('getFirstProductPreset: product preset list is empty');
  return preset;
}

/**
 * Produce a fresh, mutation-safe editor session from a product preset.
 *
 * The session's overrides are always empty — presets carry no overrides;
 * overrides are per-user tweaks accumulated *after* selection.
 */
export function createPresetSession(preset: ProductPresetV3): PresetSession {
  return {
    template: structuredClone(preset.template.config),
    controls: structuredClone(preset.mainControls),
    controlSurface: structuredClone(preset.template.controlSurface ?? defaultControlSurface),
    slotOverrides: {},
    regionOverrides: {},
    rootOverrides: {},
  };
}

/** 首次打开与刷新时直接创建第一个产品预设的 session。 */
export function createInitialPresetSession(): PresetSession {
  return createPresetSession(getFirstProductPreset());
}
