import { defaultFlowLayout, defaultStyle, type FieldChip, type FieldId, type ImprintConfig } from '../../../web/src/types';

/** Which EXIF fields each left track shows by default. */
export const DEFAULT_TRACK_FIELDS: { top: FieldId[]; bottom: FieldId[] } = {
  top: ['camera_model', 'lens_model'],
  bottom: ['focal_length', 'aperture', 'shutter', 'iso'],
};

/** Fields offered as quick toggles in the typography panel. */
export const QUICK_FIELD_OPTIONS: FieldId[] = [
  'camera_model', 'lens_model', 'focal_length', 'aperture', 'shutter', 'iso', 'datetime',
];

const chips = (fields: FieldId[]): FieldChip[] => fields.map(field_id => ({ field_id }));

/** System default watermark layout: dual-track footer, auto-matched device logo on the right. */
export function buildDefaultConfig(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: { margins: { top: 0, right: 0, bottom: 0, left: 0 }, background: '#FFFFFF', border_radius: 0, border: { enabled: false, width_level: 'medium', color: '#FFFFFF' } },
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.15, layout: defaultFlowLayout(),
      slots: {
        // The top-left track is slightly larger; both default tracks use the
        // bold face so the metadata remains legible over the white footer.
        'primary-start': { enabled: true, style: { ...defaultStyle, font_size_level: 'medium', font_family: 'NotoSansCJKsc-Bold.otf', bold: true }, content: { chips: chips(DEFAULT_TRACK_FIELDS.top), separator: ' ' } },
        'secondary-start': { enabled: true, style: { ...defaultStyle, font_size_level: 'small', font_family: 'NotoSansCJKsc-Bold.otf', bold: true }, content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: true, style: null, content: { path: '', size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}
