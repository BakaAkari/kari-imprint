import { defaultFlowLayout, defaultStyle, type FieldChip, type FieldId, type ImprintConfig, type StyleConfig } from '../../../web/src/types';

/** Which EXIF fields each track shows by default. */
export const DEFAULT_TRACK_FIELDS: { top: FieldId[]; bottom: FieldId[] } = {
  top: ['camera_model', 'lens_model'],
  bottom: ['focal_length', 'aperture', 'shutter', 'iso'],
};

/** Product styles; every style carries at most one information frame. */
export type StylePresetId = 'classic' | 'minimal' | 'dark' | 'blur' | 'plain';

export const STYLE_PRESETS: { id: StylePresetId; label: string; caption: string }[] = [
  { id: 'classic', label: '经典', caption: '机身镜头 + 参数 + 品牌 Logo' },
  { id: 'minimal', label: '极简单行', caption: '一行机身与参数，无 Logo' },
  { id: 'dark', label: '深色', caption: '深底浅字，Logo 自动反白' },
  { id: 'blur', label: '模糊背景', caption: '照片悬浮于自身模糊背景' },
  { id: 'plain', label: '纯留白', caption: '只加留白，不加文字' },
];

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

const chips = (fields: FieldId[]): FieldChip[] => fields.map(field_id => ({ field_id }));

/** Default 60px white space on the three sides the information frame does not occupy. */
export const DEFAULT_FRAME_MARGIN = 60;

export type FrameSide = 'footer' | 'left' | 'right';

/** Margins for a given frame position: `value` px on the three non-frame sides. */
export function marginsForFrame(position: FrameSide, value = DEFAULT_FRAME_MARGIN): ImprintConfig['canvas']['margins'] {
  return position === 'footer'
    ? { top: value, right: value, bottom: 0, left: value }
    : position === 'left'
      ? { top: value, right: value, bottom: value, left: 0 }
      : { top: value, right: 0, bottom: value, left: value };
}

export type CanvasEffect = { background: 'solid' | 'blur'; photo_radius: number; shadow: boolean };
export const NO_EFFECT: CanvasEffect = { background: 'solid', photo_radius: 0, shadow: false };

/** Read the optional canvas effect without depending on the field being present. */
export function canvasEffect(config: ImprintConfig): CanvasEffect {
  const effect = (config.canvas as { effect?: Partial<CanvasEffect> }).effect;
  return { ...NO_EFFECT, ...(effect ?? {}) };
}

export function withCanvasEffect(config: ImprintConfig, patch: Partial<CanvasEffect>): ImprintConfig {
  const effect = { ...canvasEffect(config), ...patch };
  const canvas = { ...config.canvas } as ImprintConfig['canvas'] & { effect?: CanvasEffect };
  if (effect.background === 'solid' && effect.photo_radius === 0 && !effect.shadow) delete canvas.effect;
  else canvas.effect = effect;
  return { ...config, canvas };
}

const text = (patch: Partial<StyleConfig>): StyleConfig => ({ ...defaultStyle, ...patch });
const BOLD = 'NotoSansCJKsc-Bold.otf' as const;
const REGULAR = 'NotoSansCJKsc-Regular.otf' as const;

function baseCanvas(background = '#FFFFFF'): ImprintConfig['canvas'] {
  return { margins: marginsForFrame('footer'), background, border_radius: 0, border: { enabled: false, width_level: 'medium', color: '#FFFFFF' } };
}

/** 经典：双轨底栏，右侧自动识别品牌 Logo。 */
export function buildDefaultConfig(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: baseCanvas(),
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.15, layout: defaultFlowLayout(),
      slots: {
        // The upper line is bold, the lower line regular; both medium so the
        // two metadata lines keep a calm, legible hierarchy.
        'primary-start': { enabled: true, style: text({ font_size_level: 'medium', font_family: BOLD, bold: true }), content: { chips: chips(DEFAULT_TRACK_FIELDS.top), separator: ' ' } },
        'secondary-start': { enabled: true, style: text({ font_size_level: 'medium', font_family: REGULAR, bold: false }), content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: true, style: null, content: { path: '', size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

/** 极简单行：一行内左侧机身、右侧参数，无 Logo。 */
export function buildMinimalConfig(): ImprintConfig {
  return {
    schema_version: 3,
    canvas: baseCanvas(),
    regions: [{
      id: 'footer', type: 'footer-bar', enabled: true, height: 0.1,
      layout: { ...defaultFlowLayout(), mode: 'single-track' },
      slots: {
        // One line in a thin bar: use the large step so it reads at the same
        // visual size as the classic two-line text.
        'primary-start': { enabled: true, style: text({ font_size_level: 'large', font_family: BOLD, bold: true }), content: { chips: chips(['camera_model']), separator: ' ' } },
        'primary-end': { enabled: true, style: text({ font_size_level: 'large', font_family: REGULAR, bold: false, color: '#6E6E6E' }), content: { chips: chips(DEFAULT_TRACK_FIELDS.bottom), separator: ' ' } },
        asset: { enabled: false, style: null, content: null },
      },
    }],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

/** 深色：经典结构，深底浅字。 */
export function buildDarkConfig(): ImprintConfig {
  const config = buildDefaultConfig();
  const region = config.regions[0];
  const slots = region.slots!;
  slots['primary-start'] = { ...slots['primary-start'], style: { ...slots['primary-start'].style!, color: '#F2F2F2' } };
  slots['secondary-start'] = { ...slots['secondary-start'], style: { ...slots['secondary-start'].style!, color: '#9A9A9A' } };
  return { ...config, canvas: { ...config.canvas, background: '#141414' } };
}

/** 模糊背景：照片悬浮在自身模糊背景上，圆角 + 柔和投影，浅色文字。 */
export function buildBlurConfig(shortEdge?: number): ImprintConfig {
  const config = buildDefaultConfig();
  const slots = config.regions[0].slots!;
  slots['primary-start'] = { ...slots['primary-start'], style: { ...slots['primary-start'].style!, color: '#FFFFFF' } };
  slots['secondary-start'] = { ...slots['secondary-start'], style: { ...slots['secondary-start'].style!, color: '#D9D9D9' } };
  const margin = shortEdge ? Math.max(DEFAULT_FRAME_MARGIN, Math.round(shortEdge * 0.06)) : DEFAULT_FRAME_MARGIN * 3;
  const base: ImprintConfig = { ...config, canvas: { ...config.canvas, background: '#1A1A1A', margins: marginsForFrame('footer', margin) } };
  return withCanvasEffect(base, { background: 'blur', photo_radius: 0.015, shadow: true });
}

/** 纯留白：不添加信息条，只保留四边留白。 */
export function buildPlainConfig(): ImprintConfig {
  const m = DEFAULT_FRAME_MARGIN;
  return {
    schema_version: 3,
    canvas: { ...baseCanvas(), margins: { top: m, right: m, bottom: m, left: m } },
    regions: [],
    defaults: defaultStyle,
    custom_text: '',
    logo_position: 'right',
  };
}

export function buildStyleConfig(id: StylePresetId, shortEdge?: number): ImprintConfig {
  switch (id) {
    case 'classic': return buildDefaultConfig();
    case 'minimal': return buildMinimalConfig();
    case 'dark': return buildDarkConfig();
    case 'blur': return buildBlurConfig(shortEdge);
    case 'plain': return buildPlainConfig();
  }
}
