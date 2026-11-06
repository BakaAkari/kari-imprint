/**
 * Writes every catalog style's build() to
 * packages/kari-core/tests/fixtures/style_catalog.json, so Python can
 * validate, lay out and render the exact configs the apps produce, and the
 * TS/Python parity run covers every style. Run: npm run export:styles
 * (verifyPresetContract.mts fails when the file is stale).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogFixture } from './styleCatalogFixture';

const target = resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/style_catalog.json');
writeFileSync(target, `${JSON.stringify(catalogFixture(), null, 1)}\n`);
console.log(`wrote ${target}`);
