import type { ExifFieldValues } from '../api';
import type { FieldChip, TextContent } from '../types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DATE_FORMATS = ['date', 'year', 'month-year', 'long', 'cn', 'stamp'] as const;
export type DateFormat = typeof DATE_FORMATS[number];

/** Mirror of render_values.format_date; unknown formats and unparsable values pass through. */
export function formatDate(raw: string, fmt: string): string {
  const match = raw ? /^(\d{4})[:\-./](\d{1,2})[:\-./](\d{1,2})/.exec(raw.trim()) : null;
  if (!match || !(DATE_FORMATS as readonly string[]).includes(fmt)) return raw;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  switch (fmt) {
    case 'date': return `${pad(year, 4)}.${pad(month)}.${pad(day)}`;
    case 'year': return pad(year, 4);
    case 'month-year': return `${MONTHS[month - 1].slice(0, 3).toUpperCase()} ${pad(year, 4)}`;
    case 'long': return `${day} ${MONTHS[month - 1]} ${pad(year, 4)}`;
    case 'cn': return `${year}年${month}月${day}日`;
    default: return `'${pad(year % 100)} ${pad(month)} ${pad(day)}`;
  }
}

export function resolveText(chip: FieldChip, customText: string, fieldValues: ExifFieldValues): string {
  if (chip.field_id === 'custom_text') return chip.custom_text || customText || '';
  if (chip.field_id === 'empty') return '';
  const value = fieldValues[chip.field_id] ?? '';
  return chip.field_id === 'datetime' && chip.format ? formatDate(value, chip.format) : value;
}

/**
 * Mirrors ``_build_text`` in kari_core/processor/renderer.py: empty values add
 * no separator, the make is dropped when the camera model on the same line
 * already starts with it ("Canon" + "Canon EOS R5"), and a lens that repeats
 * the model on the same line loses that prefix.
 */
export function buildText(content: TextContent, customText: string, fieldValues: ExifFieldValues): string {
  const make = (fieldValues.make ?? '').trim().toLowerCase();
  const model = (fieldValues.camera_model ?? '').trim().toLowerCase();
  const redundantMake = !!make && content.chips.some(c => c.field_id === 'camera_model')
    && (model === make || model.startsWith(make + ' '));
  const hasModel = content.chips.some(c => c.field_id === 'camera_model');
  const rawModel = (fieldValues.camera_model ?? '').trim();
  const texts = content.chips
    .filter(c => c.field_id !== 'empty' && !(c.field_id === 'make' && redundantMake))
    .map(c => {
      const value = resolveText(c, customText, fieldValues);
      // Phone lenses repeat the model ("iPhone 15 Pro back triple camera…"); drop that prefix.
      if (c.field_id === 'lens_model' && hasModel && rawModel && value.toLowerCase().startsWith(rawModel.toLowerCase() + ' ')) {
        return value.slice(rawModel.length + 1).trim();
      }
      return value;
    })
    .filter(Boolean);
  return texts.join(content.separator);
}
