import { STYLE_PRESETS } from '../src/stylePresets';
import type { ImprintConfig } from '../src/types';

export interface CatalogCase {
  id: string;
  app: string;
  image: [number, number];
  config: ImprintConfig;
}

/** One landscape and one portrait case per style, built at the photo's short edge. */
export function catalogFixture(): CatalogCase[] {
  const sizes: [number, number][] = [[3000, 2000], [2000, 3000]];
  return STYLE_PRESETS.flatMap((preset) => sizes.map((image) => ({
    id: `${preset.id}@${image[0]}x${image[1]}`,
    app: preset.app,
    image,
    config: preset.build({ shortEdge: Math.min(...image) }),
  })));
}
