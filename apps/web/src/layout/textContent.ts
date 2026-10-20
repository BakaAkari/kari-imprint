import type { ExifFieldValues } from '../api';
import type { FieldChip, TextContent } from '../types';

export function resolveText(chip: FieldChip, customText: string, fieldValues: ExifFieldValues): string {
  if (chip.field_id === 'custom_text') return chip.custom_text || customText || '';
  if (chip.field_id === 'empty') return '';
  return fieldValues[chip.field_id] ?? '';
}

/**
 * Mirrors ``_build_text`` in kari_core/processor/renderer.py: empty values add
 * no separator, and the make is dropped when the camera model on the same
 * line already starts with it ("Canon" + "Canon EOS R5").
 */
export function buildText(content: TextContent, customText: string, fieldValues: ExifFieldValues): string {
  const make = (fieldValues.make ?? '').trim().toLowerCase();
  const model = (fieldValues.camera_model ?? '').trim().toLowerCase();
  const redundantMake = !!make && content.chips.some(c => c.field_id === 'camera_model')
    && (model === make || model.startsWith(make + ' '));
  const texts = content.chips
    .filter(c => c.field_id !== 'empty' && !(c.field_id === 'make' && redundantMake))
    .map(c => resolveText(c, customText, fieldValues))
    .filter(Boolean);
  return texts.join(content.separator);
}
