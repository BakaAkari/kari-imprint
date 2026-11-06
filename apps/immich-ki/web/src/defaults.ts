import type { FieldId } from '../../../web/src/types';

// Style presets live in the shared catalog: ../../../web/src/stylePresets.ts.

/** Fields offered as quick toggles for each text line. */
export const QUICK_FIELD_OPTIONS: FieldId[] = [
  'camera_model', 'lens_model', 'focal_length', 'aperture', 'shutter', 'iso', 'datetime', 'make', 'artist',
];

/** Background swatches; the last entry is reached through the custom colour input. */
export const BACKGROUND_SWATCHES: { value: string; label: string }[] = [
  { value: '#FFFFFF', label: '白' },
  { value: '#F4F1EA', label: '米白' },
  { value: '#E9E9E9', label: '浅灰' },
  { value: '#1A1A1A', label: '深灰' },
  { value: '#000000', label: '黑' },
];
