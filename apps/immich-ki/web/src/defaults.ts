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

/** Default 60px white space on the three sides the information frame does not occupy. */
export const DEFAULT_FRAME_MARGIN = 60;

/** Margins for a given frame position: 60px on the three non-frame sides. */
export function marginsForFrame(position: 'footer' | 'left' | 'right'): ImprintConfig['canvas']['margins'] {
  return position === 'footer'
    ? { top: DEFAULT_FRAME_MARGIN, right: DEFAULT_FRAME_MARGIN, bottom: 0, left: DEFAULT_FRAME_MARGIN }
    : position === 'left'
      ? { top: DEFAULT_FRAME_MARGIN, right: DEFAULT_FRAME_MARGIN, bottom: DEFAULT_FRAME_MARGIN, left: 0 }
      : { top: DEFAULT_FRAME_MARGIN, right: 0, bottom: DEFAULT_FRAME_MARGIN, left: DEFAULT_FRAME_MARGIN };
}

/** System default watermark layout: dual-track footer, auto-matched device logo on the right. */
export function buildDefaultConfig(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: { margins: marginsForFrame('footer'), background: '#FFFFFF', border_radius: 0, border: { enabled: false, width_level: 'medium', color: '#FFFFFF' } },
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.15, layout: defaultFlowLayout(),
      slots: {
        // The top-left track is larger and bold; the lower track is medium
        // and regular so the two metadata lines keep visual hierarchy.
        'primary-start': { enabled: true, style: { ...defaultStyle, font_size_level: 'medium', font_family: 'NotoSansCJKsc-Bold.otf', bold: true }, content: { chips: chips(DEFAULT_TRACK_FIELDS.top), separator: ' ' } },
        'secondary-start': { enabled: true, style: { ...defaultStyle, font_size_level: 'medium', font_family: 'NotoSansCJKsc-Regular.otf', bold: false }, content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: true, style: null, content: { path: '', size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}
