/** Pure editor-model regression for immich-ki. Run: node scripts/verify_immich_editor_state.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'apps/immich-ki/web/node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const state = require('../apps/immich-ki/web/src/editor-state.ts');
const defaults = require('../apps/immich-ki/web/src/defaults.ts');
const history = require('../apps/immich-ki/web/src/history.ts');
const { buildDefaultConfig } = defaults;
const frames = c => c.regions.filter(r => r.type !== 'free');

// Lossless load/save of arbitrary stored configs, including unknown-to-UI shapes.
const value = buildDefaultConfig();
value.custom_text = 'legacy fallback';
value.regions[0].slots['primary-end'] = { enabled: false, style: { ...value.defaults, color: '#123456' }, content: { chips: [], separator: ' / ' } };
value.regions.push({ id: 'saved-signature', type: 'free', enabled: false, slots: { sig1: { enabled: true, style: null, content: { path: 'existing-resource', invert_mono: true, size_level: 'small', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } } } });
for (const config of [value, buildDefaultConfig(), { ...buildDefaultConfig(), regions: [] }]) {
  const draft = state.editableConfig(config);
  assert.deepEqual(state.serializeEditorConfig(draft), config, 'load/save must be lossless');
  assert.notEqual(draft, config);
  assert.ok(state.sameConfig(draft, config));
}

// Every style has at most one frame and is detected back as itself.
for (const { id } of defaults.STYLE_PRESETS) {
  const config = defaults.buildStyleConfig(id, 4000);
  assert.ok(frames(config).length <= 1, id);
  assert.equal(state.detectStyle(config), id, `style ${id} must round-trip through detection`);
}

// Position moves the single frame and keeps the chosen white space and thickness.
let c = state.setMarginValue(buildDefaultConfig(), 120);
c = state.setFrameThickness(c, 0.2);
const left = state.setFramePosition(c, 'left');
assert.equal(frames(left).length, 1);
assert.equal(frames(left)[0].type, 'side-bar');
assert.equal(frames(left)[0].edge, 'left');
assert.deepEqual(left.canvas.margins, { top: 120, right: 120, bottom: 120, left: 0 });
assert.equal(state.frameThickness(left), 0.2);
assert.equal(state.marginValue(state.setFramePosition(left, 'footer')), 120);
// Without a frame (plain), position is a no-op rather than silently switching style.
const plain = defaults.buildPlainConfig();
assert.equal(state.setFramePosition(plain, 'left'), plain);

// Switching style keeps orthogonal choices: position, brand, signature, margin.
let custom = state.setFramePosition(buildDefaultConfig(), 'right');
custom = state.setBrandMode(custom, 'canon', 'large');
custom = state.setSignature(custom, { path: 'sig-resource', enabled: true, size: 'medium' });
custom = state.setMarginValue(custom, 90);
const dark = state.applyStylePreset(custom, 'dark');
assert.equal(state.detectStyle(dark), 'dark');
assert.equal(state.framePosition(dark), 'right');
assert.equal(state.brandMode(dark), 'canon');
assert.equal(state.logoSize(dark), 'large');
assert.deepEqual(state.signatureState(dark), { enabled: true, path: 'sig-resource', size: 'medium' });
assert.equal(state.marginValue(dark), 90);
const minimal = state.applyStylePreset(custom, 'minimal');
assert.equal(state.brandMode(minimal), 'off', 'minimal has no logo');
assert.equal(state.framePosition(minimal), 'right');
assert.ok(state.signatureState(state.applyStylePreset(custom, 'plain')).enabled, 'signature survives plain style');

// A field lives on one line only; toggling moves it, untoggling removes it.
let f = buildDefaultConfig();
f = state.toggleLineField(f, 'primary-start', 'focal_length');
assert.ok(state.lineFields(f, 'primary-start').includes('focal_length'));
assert.ok(!state.lineFields(f, 'secondary-start').includes('focal_length'));
f = state.toggleLineField(f, 'primary-start', 'focal_length');
assert.ok(!state.lineFields(f, 'primary-start').includes('focal_length'));
f = state.moveLineField(buildDefaultConfig(), 'secondary-start', 0, 1);
assert.deepEqual(state.lineFields(f, 'secondary-start'), ['aperture', 'focal_length', 'shutter', 'iso']);
// End slots are offered only when no logo occupies that end.
assert.deepEqual(state.availableLines(buildDefaultConfig()), ['primary-start', 'secondary-start']);
assert.deepEqual(state.availableLines(state.setBrandMode(buildDefaultConfig(), 'off')), ['primary-start', 'primary-end', 'secondary-start', 'secondary-end']);

// Weight toggles also switch the font file so bold is real, not synthetic.
const light = state.patchLineStyle(buildDefaultConfig(), 'primary-start', { bold: false });
assert.equal(state.lineStyle(light, 'primary-start').font_family, 'NotoSansCJKsc-Regular.otf');

// A signature without an uploaded graphic is never enabled; removing it drops the region.
assert.equal(state.signatureRegion(state.setSignature(buildDefaultConfig(), { enabled: true })), null);
assert.equal(state.signatureRegion(state.setSignature(custom, { path: '' })), null);

// Effects: the default (no effect) leaves the canvas without an `effect` key.
const blur = state.withCanvasEffect(buildDefaultConfig(), { background: 'blur' });
assert.equal(state.canvasEffect(blur).background, 'blur');
assert.equal('effect' in state.withCanvasEffect(blur, { background: 'solid' }).canvas, false);

// Undo history: continuous edits with the same key coalesce; distinct edits do not.
let doc = { config: buildDefaultConfig(), baseline: buildDefaultConfig(), undo: [], redo: [], lastKey: null, lastAt: 0 };
doc = history.reduce(doc, { type: 'commit', config: state.setMarginValue(doc.config, 70), key: 'margin', at: 1000 });
doc = history.reduce(doc, { type: 'commit', config: state.setMarginValue(doc.config, 80), key: 'margin', at: 1200 });
doc = history.reduce(doc, { type: 'commit', config: state.setFramePosition(doc.config, 'left'), at: 1300 });
assert.equal(doc.undo.length, 2);
doc = history.reduce(doc, { type: 'undo' });
doc = history.reduce(doc, { type: 'undo' });
assert.ok(state.sameConfig(doc.config, buildDefaultConfig()), 'two undos restore the start');
doc = history.reduce(doc, { type: 'redo' });
assert.equal(state.marginValue(doc.config), 80);
assert.equal(history.reduce(doc, { type: 'commit', config: doc.config, at: 9999 }), doc, 'no-op edits do not create history');

console.log('PASS: lossless roundtrip, style detection, orthogonal style switch, position keeps margin/thickness, plain no-op, single-line fields, end-slot rule, weight font, signature rules, effect default, undo coalescing');
