import type { ExifFieldValues } from '../api';
import type { FieldChip, TextContent } from '../types';

export function resolveText(chip: FieldChip, customText: string, fieldValues: ExifFieldValues): string {
  if (chip.field_id === 'custom_text') return chip.custom_text || customText || '';
  if (chip.field_id === 'empty') return '';
  return fieldValues[chip.field_id] ?? '';
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
