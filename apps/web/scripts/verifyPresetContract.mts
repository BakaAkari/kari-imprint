/**
 * Preset contract verification — protects the "one preset = one deterministic
 * state snapshot" invariant end-to-end.
 *
 * Every meaningful preset scenario is exercised through the same
 * `createPresetSession` transition that HomePage calls at mount, reset, and
 * every preset picker click. If this test drifts from the production path, the
 * fault surface is the shared module — not a duplicated test fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeLayout } from '../src/layout/layoutEngine';
import {
  defaultControlSurface,
  resolveConfig,
  colorSchemes,
  type MainControlConfig,
  type SizeLevel,
  type SlotOverrides,
} from '../src/types';
import {
  IMMICH_STYLE_PRESETS,
  STYLE_PRESETS,
  WEB_STYLE_PRESETS,
  getStylePreset,
} from '../src/stylePresets';
import {
  createInitialPresetSession,
  createPresetSession,
  getFirstProductPreset,
  getProductPreset,
} from '../src/presetSession';
import { resolveAutoLogo, resolveAutoLogoWithScheme } from '../src/autoLogo';
import { MAX_KNOBS_PER_STYLE } from '../src/styles/knobs';
import { catalogFixture } from './styleCatalogFixture';
import { formatDate } from '../src/layout/textContent';

let failures = 0;
function pass(label: string) {
  console.log(`  ok  ${label}`);
}
function fail(label: string, detail?: string) {
  failures += 1;
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function assertEqual(label: string, actual: unknown, expected: unknown) {
  if (deepEqual(actual, expected)) pass(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const CONTROL_KEYS: readonly (keyof MainControlConfig)[] = [
  'scheme', 'layout_structure', 'flow_mode', 'logo_enabled', 'logo_position',
  'text_sizes', 'logo_size', 'signature_size', 'footer_height_level', 'logo_variant',
  'primary_start', 'primary_end', 'secondary_start', 'secondary_end',
  'custom_text', 'logo_path', 'signature_path',
  'border_enabled', 'border_width_level',
] as const;

const TEXT_SIZE_KEYS = ['primary_start', 'primary_end', 'secondary_start', 'secondary_end'] as const;

function resolvedFromPreset(id: string) {
  const preset = getProductPreset(id);
  const session = createPresetSession(preset);
  return {
    preset,
    session,
    config: resolveConfig(
      session.template,
      session.controls,
      session.slotOverrides,
      session.regionOverrides,
      session.rootOverrides,
      session.controlSurface,
    ),
  };
}

// ──────────────────────────────────────────────────────────
section('1. Every preset declares all MainControlConfig keys explicitly');
for (const preset of WEB_STYLE_PRESETS) {
  const missing: string[] = [];
  for (const key of CONTROL_KEYS) {
    if (!(key in preset.mainControls)) missing.push(key);
  }
  for (const size of TEXT_SIZE_KEYS) {
    if (!(size in preset.mainControls.text_sizes)) missing.push(`text_sizes.${size}`);
  }
  if (missing.length) fail(`${preset.id}`, `missing keys: ${missing.join(', ')}`);
  else pass(`${preset.id}`);
}

// ──────────────────────────────────────────────────────────
section('2. Preset templates carry NO controlled slot content or style');
for (const preset of WEB_STYLE_PRESETS) {
  const surface = preset.template.controlSurface ?? defaultControlSurface;
  const controlledSlotIds = new Set<string>([
    ...Object.values(surface.footer.slots).filter((v): v is string => Boolean(v)),
    ...Object.values(surface.footer.logoSlots).filter((v): v is string => Boolean(v)),
  ]);
  let ok = true;
  for (const region of preset.template.config.regions) {
    if (region.id !== surface.footer.regionId) continue;
    for (const slotId of Object.keys(region.slots ?? {})) {
      if (controlledSlotIds.has(slotId)) {
        ok = false;
        fail(`${preset.id}`, `template still owns controlled slot "${slotId}"`);
      }
    }
  }
  if (ok) pass(`${preset.id} — no controlled-slot authority in template`);
}

// ──────────────────────────────────────────────────────────
section('3. No independent default controls — initial state is the first preset');
assertEqual('first preset is the initial product state', getFirstProductPreset(), WEB_STYLE_PRESETS[0]);

// ──────────────────────────────────────────────────────────
section('4. Round-trip stability — repeated selection yields deep-equal config');
for (const preset of WEB_STYLE_PRESETS) {
  const a = resolvedFromPreset(preset.id).config;
  const b = resolvedFromPreset(preset.id).config;
  if (deepEqual(a, b)) pass(`${preset.id} idempotent`);
  else fail(`${preset.id}`, 'two consecutive selections diverged');
}

// ──────────────────────────────────────────────────────────
section('5. Initial state and reset both use the first preset directly');
{
  const initial = createInitialPresetSession();
  const initialCfg = resolveConfig(initial.template, initial.controls, initial.slotOverrides, initial.regionOverrides, initial.rootOverrides, initial.controlSurface);
  const firstPreset = WEB_STYLE_PRESETS[0];
  const explicit = resolvedFromPreset(firstPreset.id).config;
  assertEqual('initial mount = createPresetSession(first preset)', initialCfg, explicit);
  assertEqual('first preset defaults border to enabled', initial.controls.border_enabled, true);

  const reset = createPresetSession(getFirstProductPreset());
  const resetCfg = resolveConfig(reset.template, reset.controls, reset.slotOverrides, reset.regionOverrides, reset.rootOverrides, reset.controlSurface);
  assertEqual('reset === fresh first-preset session', resetCfg, explicit);
}

// ──────────────────────────────────────────────────────────
section('6. Override reset — applying preset B after tweaks matches fresh selection');
{
  // Session 1: fresh apply of B
  const s1 = createPresetSession(WEB_STYLE_PRESETS[1]);
  const cfgFresh = resolveConfig(s1.template, s1.controls, s1.slotOverrides, s1.regionOverrides, s1.rootOverrides, s1.controlSurface);

  // Session 2: apply A, tweak overrides, then apply B via the same transition.
  let s2 = createPresetSession(WEB_STYLE_PRESETS[0]);
  const dirtySlots: SlotOverrides = { 'footer:primary-start': { enabled: false } };
  s2 = { ...s2, slotOverrides: dirtySlots, regionOverrides: { footer: { padding: { top: 999 } } }, rootOverrides: { canvas: { border_radius: 42 } } };
  const cfgDirty = resolveConfig(s2.template, s2.controls, s2.slotOverrides, s2.regionOverrides, s2.rootOverrides, s2.controlSurface);
  if (!deepEqual(cfgDirty, cfgFresh)) pass('overrides on preset A change resolved config (sanity)');
  else fail('override sanity', 'overrides had no observable effect — fixture broken');

  s2 = createPresetSession(WEB_STYLE_PRESETS[1]);
  const cfgAfterSwitch = resolveConfig(s2.template, s2.controls, s2.slotOverrides, s2.regionOverrides, s2.rootOverrides, s2.controlSurface);
  assertEqual('preset switch clears overrides', cfgAfterSwitch, cfgFresh);
}

// ──────────────────────────────────────────────────────────
section('7. Auto Logo empty path — layout reserves space, text does not overlap');
function xRange(el: { rect: { x: number; w: number }; anchor: string }): [number, number] {
  if (el.anchor.includes('right')) return [el.rect.x - el.rect.w, el.rect.x];
  if (el.anchor.includes('center')) return [el.rect.x - el.rect.w / 2, el.rect.x + el.rect.w / 2];
  return [el.rect.x, el.rect.x + el.rect.w];
}
for (const preset of WEB_STYLE_PRESETS) {
  const cfg = resolvedFromPreset(preset.id).config;
  const layout = computeLayout(cfg as unknown as Parameters<typeof computeLayout>[0], 1200, 800);
  const asset = layout.elements.find((el) => el.type === 'logo');
  if (!preset.mainControls.logo_enabled) {
    // Presets with logo_enabled=false must produce zero Logo elements — no
    // reserve, no skeleton draw. If any preset drifts to true, this catches it.
    if (asset) fail(`${preset.id} — logo_enabled=false but layout emitted a logo element`);
    else pass(`${preset.id} — logo_enabled=false → no logo element`);
    continue;
  }
  if (!asset) { fail(`${preset.id} — logo_enabled=true but layout has no logo element`); continue; }
  // Center-positioned logos naturally sit between text areas — overlap is expected.
  if (preset.mainControls.logo_position === 'center') {
    pass(`${preset.id} — logo center position (overlap check skipped)`);
    continue;
  }
  const [aLeft, aRight] = xRange(asset);
  const textEls = layout.elements.filter((el) => el.type === 'text');
  const overlaps = textEls.some((t) => {
    const [tLeft, tRight] = xRange(t);
    return !(tRight <= aLeft || tLeft >= aRight);
  });
  if (!overlaps) pass(`${preset.id} — text does not overlap auto-Logo`);
  else fail(`${preset.id}`, 'text overlaps auto-Logo reserved region');
}

// ──────────────────────────────────────────────────────────
section('8. Every MainControlConfig field maps 1:1 into resolved config');
for (const preset of WEB_STYLE_PRESETS) {
  const { config, session } = resolvedFromPreset(preset.id);
  const controls = session.controls;
  const surface = session.controlSurface;
  const footer = config.regions.find((r) => r.id === surface.footer.regionId);
  const label = `${preset.id}`;

  // scheme
  const scheme = colorSchemes[controls.scheme];
  assertEqual(`${label} · scheme→canvas.background`, config.canvas.background, scheme.background);
  assertEqual(`${label} · scheme→defaults.color`, config.defaults.color, scheme.text);

  // layout_structure → region.type/edge
  const expectedType = controls.layout_structure === 'footer' ? 'footer-bar' : 'side-bar';
  assertEqual(`${label} · layout_structure→region.type`, footer?.type, expectedType);
  if (controls.layout_structure !== 'footer') {
    const expectedEdge = controls.layout_structure === 'side-left' ? 'left' : 'right';
    assertEqual(`${label} · layout_structure→region.edge`, footer?.edge, expectedEdge);
  }

  // flow_mode
  assertEqual(`${label} · flow_mode→layout.mode`, footer?.layout?.mode, controls.flow_mode);

  // border_enabled / width_level (controlSurface.border.enabled = true for all bundled surfaces)
  assertEqual(`${label} · border_enabled→canvas.border.enabled`, config.canvas.border.enabled, controls.border_enabled);
  assertEqual(`${label} · border_width_level→canvas.border.width_level`, config.canvas.border.width_level, controls.border_width_level);
  assertEqual(`${label} · border color follows scheme`, config.canvas.border.color, scheme.border);

  // custom_text → propagated to config
  assertEqual(`${label} · custom_text`, config.custom_text ?? '', controls.custom_text);

  // logo_enabled → asset slot enabled/existence; logo_position → placement
  const assetSlot = footer?.slots?.asset;
  if (controls.logo_enabled) {
    if (!assetSlot?.enabled) {
      fail(`${label} · logo_enabled=true expects asset enabled`, JSON.stringify(assetSlot));
    } else {
      pass(`${label} · logo_enabled=true → asset enabled`);
      const expectedPlacement = controls.logo_position === 'left' ? 'start' : controls.logo_position === 'right' ? 'end' : 'center';
      if (assetSlot.content && 'placement' in assetSlot.content) {
        assertEqual(`${label} · logo_position→placement`, assetSlot.content.placement, expectedPlacement);
      } else {
        fail(`${label} · logo asset content missing`, JSON.stringify(assetSlot));
      }
      assertEqual(`${label} · logo_path`, (assetSlot.content && 'path' in assetSlot.content) ? assetSlot.content.path : null, controls.logo_path);
      assertEqual(`${label} · logo_size→content.size_level`, (assetSlot.content && 'size_level' in assetSlot.content) ? assetSlot.content.size_level : null, controls.logo_size);
    }
  } else {
    // Asset must be either absent or explicitly disabled — no layout reserve, no skeleton.
    if (!assetSlot || assetSlot.enabled === false) pass(`${label} · logo_enabled=false → asset disabled`);
    else fail(`${label} · logo_enabled=false leaked`, JSON.stringify(assetSlot));
  }
  assertEqual(`${label} · logo_position→config.logo_position`, config.logo_position, controls.logo_position);

  // Text slot chips, enabled flag, and size levels — per surface mapping
  const chipMap = {
    primary_start: controls.primary_start,
    primary_end: controls.primary_end,
    secondary_start: controls.secondary_start,
    secondary_end: controls.secondary_end,
  } as const;
  for (const logical of TEXT_SIZE_KEYS) {
    const slotId = surface.footer.slots[logical];
    if (!slotId) continue;
    const slot = footer?.slots?.[slotId];
    const chips = chipMap[logical];
    assertEqual(`${label} · ${logical} enabled matches chip presence`, slot?.enabled ?? false, chips.length > 0);
    if (chips.length > 0) {
      const content = slot?.content && 'chips' in slot.content ? slot.content : null;
      assertEqual(`${label} · ${logical} chips`, content?.chips ?? null, chips);
      assertEqual(`${label} · ${logical} text_sizes.font_size_level`, slot?.style?.font_size_level, controls.text_sizes[logical]);
      assertEqual(`${label} · ${logical} slot color follows scheme`, slot?.style?.color, scheme.text);
    }
  }

  // Signature: only present when a signature_path is set. Every preset ships with '' so no signature region should exist.
  const sig = config.regions.find((r) => r.id === surface.signature.regionId);
  if (controls.signature_path) {
    const sigSlot = sig?.slots?.[surface.signature.slotId];
    assertEqual(`${label} · signature_size level`, (sigSlot?.content && 'size_level' in sigSlot.content) ? sigSlot.content.size_level : null, controls.signature_size);
    assertEqual(`${label} · signature_path propagated`, (sigSlot?.content && 'path' in sigSlot.content) ? sigSlot.content.path : null, controls.signature_path);
  } else {
    if (!sig || !sig.enabled) pass(`${label} · signature region disabled when path empty`);
    else fail(`${label} · signature region present with empty path`);
  }
}

// ──────────────────────────────────────────────────────────
section('9. Mutation immunity — clone mutations do not affect source preset');
{
  const src = getFirstProductPreset();
  // JSON snapshot: catalog entries carry a build() function, which structuredClone rejects.
  const snapshot = JSON.parse(JSON.stringify(src));
  const session = createPresetSession(src);
  session.controls.primary_start.push({ field_id: 'artist' });
  session.controls.text_sizes.primary_start = 'large';
  session.template.canvas.margins.top = 99;
  if (deepEqual(src, snapshot)) pass('mutating a session does not affect the source preset');
  else fail('mutation leaked', 'source style preset was modified by mutating its clone');
}

// ──────────────────────────────────────────────────────────
section('10. Deep-freeze — direct mutation of the source preset is rejected');
{
  const src = getFirstProductPreset();
  let frozen = true;
  try {
    (src.mainControls as MainControlConfig).primary_start = [];
    frozen = false;
  } catch { /* expected in strict mode */ }
  // In non-strict contexts assignment silently fails; verify object state instead.
  if (frozen && src.mainControls.primary_start.length > 0) pass('mainControls is frozen (mutation rejected)');
  else fail('deep-freeze missing', 'style preset mainControls is writable at runtime');
}

// ──────────────────────────────────────────────────────────
section('11. Auto-Logo resolver — shared contract fixture');
// The identical JSON file is consumed by packages/kari-core/tests/unit/test_auto_logo.py,
// so any divergence between preview and PIL Process breaks CI on one side or the other.
type AutoLogoFixtureCase = { make: string | null; model?: string; on_dark?: boolean; expected: string | null; note?: string };
type AutoLogoFixture = { builtins: string[]; cases: AutoLogoFixtureCase[] };
const fixturePath = resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/auto_logo_cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as AutoLogoFixture;
for (const kase of fixture.cases) {
  const registry = fixture.builtins.map((stem) => ({ stem, variants: [] as string[] }));
  const resolved = resolveAutoLogoWithScheme(kase.make, registry, kase.on_dark ? 'light' : 'dark', '', kase.model ?? null);
  const r = { path: resolved.stem ? `builtin:${resolved.stem}` : null };
  const expectedPath = kase.expected === null ? null : `builtin:${kase.expected}`;
  const label = `make=${JSON.stringify(kase.make)} → ${kase.expected ?? 'null'}${kase.note ? ` (${kase.note})` : ''}`;
  assertEqual(label, r.path, expectedPath);
}
{
  // Explicit empty-registry check: even a known Make yields skeleton when the registry hasn't loaded yet.
  const r = resolveAutoLogo('FUJIFILM', []);
  assertEqual('empty registry → skeleton (no-registry)', r, { path: null, reason: 'no-registry' });
}
{
  // Unknown brand + partial registry: resolver must NOT fall back to fujifilm.
  const r = resolveAutoLogo('UNKNOWN BRAND XYZ', ['sony', 'fujifilm']);
  assertEqual('unknown brand → no-match (no fujifilm fallback)', r, { path: null, reason: 'no-match' });
}

// ──────────────────────────────────────────────────────────
section('12. logo_position controls asset placement for every position');
for (const pos of ['left', 'center', 'right'] as const) {
  const base = createPresetSession(WEB_STYLE_PRESETS[0]);
  base.controls.logo_position = pos;
  const cfg = resolveConfig(base.template, base.controls, base.slotOverrides, base.regionOverrides, base.rootOverrides, base.controlSurface);
  const asset = cfg.regions.find((r) => r.id === 'footer')?.slots?.asset;
  const expected = pos === 'left' ? 'start' : pos === 'right' ? 'end' : 'center';
  const actual = asset?.content && 'placement' in asset.content ? asset.content.placement : undefined;
  if (actual === expected) pass(`logo_position=${pos} → placement=${expected}`);
  else fail(`logo_position=${pos}`, `expected placement=${expected}, got ${String(actual)}`);
}

// ──────────────────────────────────────────────────────────
section('13. sizes propagate for every combination of text_sizes');
{
  const preset = WEB_STYLE_PRESETS[0];
  const combos: SizeLevel[] = ['small', 'medium', 'large'];
  for (const s of combos) {
    const session = createPresetSession(preset);
    session.controls.text_sizes = { primary_start: s, primary_end: s, secondary_start: s, secondary_end: s };
    const cfg = resolveConfig(session.template, session.controls, session.slotOverrides, session.regionOverrides, session.rootOverrides, session.controlSurface);
    const footer = cfg.regions.find((r) => r.id === 'footer');
    let ok = true;
    for (const logical of TEXT_SIZE_KEYS) {
      const slotId = session.controlSurface.footer.slots[logical];
      if (!slotId) continue;
      const slot = footer?.slots?.[slotId];
      if (!slot?.enabled) continue;
      if (slot.style?.font_size_level !== s) {
        ok = false;
        fail(`text_sizes=${s} → ${slotId}`, `got ${slot.style?.font_size_level}`);
      }
    }
    if (ok) pass(`text_sizes=${s} propagated`);
  }
}

// ──────────────────────────────────────────────────────────
section('14. Base template exports carry NO controlled slots');
{
  const cfg = resolveConfig(getProductPreset('default').template.config, getFirstProductPreset().mainControls);
  const footer = cfg.regions.find((r) => r.id === 'footer');
  const asset = footer?.slots?.asset;
  if (asset?.enabled) pass('resolveConfig hydrates asset slot from controls, no template chips');
  else fail('asset missing after resolve', JSON.stringify(footer?.slots));
}

// ──────────────────────────────────────────────────────────
section('15. logo_enabled — per-preset explicit values + toggle roundtrip');
// Product intent, encoded here so a preset drift breaks the test.
const EXPECTED_LOGO_ENABLED: Record<string, boolean> = {
  'default': true,
  'minimal': false,
  'soft-card': true,
};
for (const preset of WEB_STYLE_PRESETS) {
  const expected = EXPECTED_LOGO_ENABLED[preset.id];
  if (expected === undefined) {
    fail(`${preset.id} — no product intent recorded`, 'update EXPECTED_LOGO_ENABLED map');
    continue;
  }
  assertEqual(`${preset.id} · logo_enabled matches product intent`, preset.mainControls.logo_enabled, expected);
}

// minimal 预设 resolved 不能产生 asset element / 布局空间。
{
  const cfg = resolvedFromPreset('minimal').config;
  const layout = computeLayout(cfg as unknown as Parameters<typeof computeLayout>[0], 1200, 800);
  const logoEl = layout.elements.find((el) => el.type === 'logo');
  if (logoEl) fail('minimal · logo element emitted', 'should be absent when logo_enabled=false');
  else pass('minimal · resolved config emits no logo element');
  const asset = cfg.regions.find((r) => r.id === 'footer')?.slots?.asset;
  if (!asset || asset.enabled === false) pass('minimal · asset slot is disabled or absent');
  else fail('minimal · asset slot leaked', JSON.stringify(asset));
}

// Toggle: open logo on minimal → asset must appear; close on default → asset must disappear.
{
  const s = createPresetSession(getProductPreset('minimal'));
  s.controls.logo_enabled = true;
  s.controls.logo_path = '';
  const cfg = resolveConfig(s.template, s.controls, s.slotOverrides, s.regionOverrides, s.rootOverrides, s.controlSurface);
  const asset = cfg.regions.find((r) => r.id === 'footer')?.slots?.asset;
  if (asset?.enabled) pass('minimal · toggle logo_enabled=true → asset appears');
  else fail('minimal · toggle failed', JSON.stringify(asset));
}
{
  const s = createPresetSession(getProductPreset('default'));
  s.controls.logo_enabled = false;
  const cfg = resolveConfig(s.template, s.controls, s.slotOverrides, s.regionOverrides, s.rootOverrides, s.controlSurface);
  const asset = cfg.regions.find((r) => r.id === 'footer')?.slots?.asset;
  if (!asset || asset.enabled === false) pass('default · toggle logo_enabled=false → asset disabled');
  else fail('default · toggle failed', JSON.stringify(asset));
  const layout = computeLayout(cfg as unknown as Parameters<typeof computeLayout>[0], 1200, 800);
  const logoEl = layout.elements.find((el) => el.type === 'logo');
  if (!logoEl) pass('default · layout emits no logo element when logo_enabled=false');
  else fail('default · layout still emits logo element');
}

// ──────────────────────────────────────────────────────────
section('16. Style catalog — one identity space for every app');
{
  const ids = STYLE_PRESETS.map((p) => p.id);
  assertEqual('style ids are unique across apps', [...new Set(ids)].length, ids.length);
  assertEqual('every style belongs to exactly one app picker',
    [...WEB_STYLE_PRESETS, ...IMMICH_STYLE_PRESETS].map((p) => p.id).sort(), [...ids].sort());
  assertEqual('web picker order', WEB_STYLE_PRESETS.map((p) => p.id), ['default', 'minimal', 'soft-card']);
  assertEqual('immich-ki picker order', IMMICH_STYLE_PRESETS.map((p) => p.id), [
    'classic', 'minimal-line', 'dark', 'blur', 'plain',
    'museum-mat', 'double-reveal', 'black-core', 'float-mount', 'signed-proof',
    'masthead', 'plate', 'swiss-grid', 'colophon',
  ]);
  for (const preset of STYLE_PRESETS) {
    if (preset.name.trim() && preset.caption.trim() && preset.category) pass(`${preset.id} · has name, caption and category`);
    else fail(`${preset.id} · identity incomplete`, JSON.stringify({ name: preset.name, caption: preset.caption, category: preset.category }));
    if (getStylePreset(preset.id) === preset) pass(`${preset.id} · lookup by id`);
    else fail(`${preset.id} · lookup by id returned a different entry`);
    if (Object.isFrozen(preset)) pass(`${preset.id} · catalog entry is frozen`);
    else fail(`${preset.id} · catalog entry is writable`);
  }
  let unknownThrows = false;
  try { getStylePreset('no-such-style'); } catch { unknownThrows = true; }
  if (unknownThrows) pass('unknown style id throws');
  else fail('unknown style id returned a value');
}

// ──────────────────────────────────────────────────────────
section('17. build() — complete, fresh, deterministic config for every style');
for (const preset of STYLE_PRESETS) {
  const a = preset.build({ shortEdge: 4000 });
  const b = preset.build({ shortEdge: 4000 });
  assertEqual(`${preset.id} · schema_version`, a.schema_version, 3);
  if (deepEqual(a, b)) pass(`${preset.id} · deterministic`);
  else fail(`${preset.id} · two builds diverged`);
  if (a !== b && !Object.isFrozen(a) && !Object.isFrozen(a.canvas) && !Object.isFrozen(a.defaults)) pass(`${preset.id} · returns a fresh writable copy`);
  else fail(`${preset.id} · build() returned shared or frozen data`);
  a.canvas.background = '#123456';
  a.regions.forEach((region) => Object.values(region.slots ?? {}).forEach((slot) => {
    if (slot.content && 'chips' in slot.content) slot.content.chips.push({ field_id: 'artist' });
  }));
  if (deepEqual(preset.build({ shortEdge: 4000 }), b)) pass(`${preset.id} · mutating a build does not leak into the next`);
  else fail(`${preset.id} · build mutation leaked into the catalog`);
  const frames = b.regions.filter((r) => r.type !== 'free');
  if (frames.length <= 1) pass(`${preset.id} · at most one information frame`);
  else fail(`${preset.id} · ${frames.length} frames`);
  const layout = computeLayout(b as unknown as Parameters<typeof computeLayout>[0], 6000, 4000);
  if (layout.canvas.w >= 6000 && layout.canvas.h >= 4000) pass(`${preset.id} · lays out a 6000×4000 photo`);
  else fail(`${preset.id} · layout canvas smaller than the photo`, JSON.stringify(layout.canvas));
}

// web: build() is exactly what a fresh editor session resolves to.
for (const preset of WEB_STYLE_PRESETS) {
  assertEqual(`${preset.id} · build() equals the fresh session config`, preset.build(), resolvedFromPreset(preset.id).config);
}

// ──────────────────────────────────────────────────────────
section('18. immich-ki styles — product intent per style');
{
  const footer = (id: string) => getStylePreset(id).build().regions.find((r) => r.id === 'footer');
  assertEqual('classic · dual-track footer, 0.15 short edge', [footer('classic')?.layout?.mode, footer('classic')?.height], ['dual-track', 0.15]);
  assertEqual('classic · logo slot enabled', footer('classic')?.slots?.asset?.enabled, true);
  assertEqual('classic · 60px white space on three sides', getStylePreset('classic').build().canvas.margins, { top: 60, right: 60, bottom: 0, left: 60 });
  assertEqual('minimal-line · single-track footer, 0.10 short edge', [footer('minimal-line')?.layout?.mode, footer('minimal-line')?.height], ['single-track', 0.1]);
  assertEqual('minimal-line · no logo', footer('minimal-line')?.slots?.asset?.enabled, false);
  assertEqual('dark · dark background', getStylePreset('dark').build().canvas.background, '#141414');
  assertEqual('blur · blurred background with radius and shadow', getStylePreset('blur').build().canvas.effect, { background: 'blur', photo_radius: 0.015, shadow: true });
  assertEqual('blur · white space scales with the photo (6% of 4000)', getStylePreset('blur').build({ shortEdge: 4000 }).canvas.margins.top, 240);
  assertEqual('blur · white space never below 60px', getStylePreset('blur').build({ shortEdge: 500 }).canvas.margins.top, 60);
  assertEqual('blur · white space without a photo size', getStylePreset('blur').build().canvas.margins.top, 180);
  assertEqual('plain · no frame, 60px on all sides', [getStylePreset('plain').build().regions.length, getStylePreset('plain').build().canvas.margins], [0, { top: 60, right: 60, bottom: 60, left: 60 }]);
  for (const preset of IMMICH_STYLE_PRESETS.filter((p) => !p.knobs)) {
    const layout = computeLayout(preset.build({ shortEdge: 4000 }) as unknown as Parameters<typeof computeLayout>[0], 6000, 4000);
    const logo = layout.elements.find((el) => el.type === 'logo');
    const expectsLogo = preset.id === 'classic' || preset.id === 'dark' || preset.id === 'blur';
    if (Boolean(logo) === expectsLogo) pass(`${preset.id} · logo element ${expectsLogo ? 'present' : 'absent'}`);
    else fail(`${preset.id} · logo element ${logo ? 'present' : 'absent'}, expected ${expectsLogo ? 'present' : 'absent'}`);
  }
}

// ──────────────────────────────────────────────────────────
section('19. Engine-built styles — knobs, construction and catalog fixture');
{
  for (const preset of STYLE_PRESETS) {
    if (preset.kind !== 'framed' || !preset.knobs) continue;
    const knobs = preset.knobs;
    if (knobs.length > 0 && knobs.length <= MAX_KNOBS_PER_STYLE) pass(`${preset.id} · ${knobs.length} knobs (≤ ${MAX_KNOBS_PER_STYLE})`);
    else fail(`${preset.id} · knob count ${knobs.length}`);
    const built = preset.build();
    assertEqual(`${preset.id} · build declares its style id`, built.style_id, preset.id);
    assertEqual(`${preset.id} · ratio margins`, built.canvas.margin_unit, 'short_edge_ratio');
    if (preset.category !== 'gallery' || built.canvas.margins.bottom > built.canvas.margins.top) pass(`${preset.id} · margin weighting`);
    else fail(`${preset.id} · gallery bottom margin not weighted`);
    // Every knob round-trips: set(get()) is a no-op, and a changed value reads back.
    for (const knob of knobs) {
      const same = (knob.set as (c: typeof built, v: unknown) => typeof built)(built, knob.get(built));
      assertEqual(`${preset.id} · knob ${knob.id} set(get()) is stable`, same, built);
      let probe: unknown;
      if (knob.kind === 'range') probe = Math.round((knob.min + knob.max) / 2 * 1000) / 1000;
      else if (knob.kind === 'toggle') probe = !knob.get(built);
      else if (knob.kind === 'text') probe = 'Probe 01';
      else probe = knob.options.find((o) => o.value !== knob.get(built))?.value;
      const changed = (knob.set as (c: typeof built, v: unknown) => typeof built)(built, probe);
      assertEqual(`${preset.id} · knob ${knob.id} reads back`, (knob.get as (c: typeof built) => unknown)(changed), probe);
      assertEqual(`${preset.id} · knob ${knob.id} keeps the style`, changed.style_id, preset.id);
    }
  }
  const signed = getStylePreset('museum-mat').build();
  const withSig = { ...signed, regions: [{ id: 'signature', type: 'free' as const, enabled: true, anchor: 'bottom-right' as const, slots: {} }] };
  const knob = (getStylePreset('museum-mat') as { knobs: readonly { id: string; set: (c: typeof signed, v: unknown) => typeof signed }[] }).knobs.find((k) => k.id === 'width')!;
  assertEqual('knobs keep the signature region', knob.set(withSig, 0.2).regions.map((r) => r.id), ['signature']);

  const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/style_catalog.json'), 'utf8'));
  if (deepEqual(fixture, catalogFixture())) pass('style_catalog.json matches every build() (run npm run export:styles after style changes)');
  else fail('style_catalog.json is stale', 'run: npm run export:styles');
}

// ──────────────────────────────────────────────────────────
section('20. Date formats — shared fixture with kari-core test_field_formats.py');
{
  const cases = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/field_format_cases.json'), 'utf8')) as { raw: string; format: string; expected: string }[];
  for (const c of cases) assertEqual(`${c.format}(${JSON.stringify(c.raw)})`, formatDate(c.raw, c.format), c.expected);
}

console.log('');
if (failures > 0) {
  console.error(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log('All preset contract checks passed.');
