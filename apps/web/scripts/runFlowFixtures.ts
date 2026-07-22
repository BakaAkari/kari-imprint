import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeLayout, type RegionConfig, type SlotConfig, type StyleConfig, type WatermarkConfig } from '../src/v3_layout/layoutEngine';

const defaultStyle: StyleConfig = {
  font_size: 16, font_size_level: null, font_size_ratio: null,
  size_reference: 'region_height', color: '#222222',
  font_family: 'NotoSansCJKsc-Bold.otf', bold: true, line_height: 1.2,
  text_direction: null,
};

const fixturePath = resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/v3_flow_layout_cases.json');
const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as Array<any>;
const output = cases.map((entry) => {
  const raw = entry.config.regions[0];
  const slots = Object.fromEntries(Object.entries(raw.slots).map(([id, value]: [string, any]) => [id, {
    enabled: value.enabled,
    content: value.logo !== undefined
      ? { path: value.logo, size_level: 'medium', size_ratio: null, orientation: 'upright', placement: value.placement ?? 'center', track: 'span' }
      : { chips: [{ field_id: value.text }], separator: ' ' },
    style: defaultStyle,
  } satisfies SlotConfig]));
  const region: RegionConfig = {
    ...raw,
    layout: {
      mode: raw.layout.mode,
      main_alignment: 'space-between', cross_alignment: 'center', track_order: 'photo-outward',
      track_gap: { mode: 'short_edge_ratio', value: 0.012 },
      item_gap: { mode: 'short_edge_ratio', value: 0.012 },
      track_ratios: [0.6, 0.4],
    },
    slots,
  };
  const config: WatermarkConfig = {
    schema_version: 3,
    canvas: { margins: entry.config.canvas.margins, background: '#FFFFFF', border_radius: 0,
      border: { enabled: false, width_level: 'medium', color: '#FFFFFF' } },
    regions: [region], defaults: defaultStyle,
  };
  const layout = computeLayout(config, entry.image[0], entry.image[1]);
  return {
    id: entry.id,
    canvas: layout.canvas,
    image_rect: layout.image_rect,
    elements: layout.elements.map(el => ({ id: el.id, type: el.type, rect: el.rect, anchor: el.anchor })),
  };
});
process.stdout.write(JSON.stringify(output));
