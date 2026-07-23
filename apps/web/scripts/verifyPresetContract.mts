/**
 * Preset contract verification — protects the "one preset = one deterministic
 * state snapshot" invariant end-to-end.
 *
 * Every meaningful preset scenario is exercised through the same
 * `createPresetSession` transition that V3HomePage calls at mount, reset, and
 * every preset picker click. If this test drifts from the production path, the
 * fault surface is the shared module — not a duplicated test fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeLayout } from '../src/v3_layout/layoutEngine';
import {
  defaultControlSurface,
  resolveConfig,
  colorSchemes,
  presetDefaultBaseV3,
  type MainControlConfig,
  type SizeLevel,
  type SlotOverrides,
} from '../src/v3Types';
import { productPresetsV3 } from '../src/v3PresetDefinitions';
import {
  createInitialPresetSession,
  createPresetSession,
  getFirstProductPreset,
  getProductPreset,
} from '../src/v3PresetSession';
import { resolveAutoLogo } from '../src/autoLogo';

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
  'text_sizes', 'logo_size', 'signature_size',
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
for (const preset of productPresetsV3) {
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
for (const preset of productPresetsV3) {
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
assertEqual('first preset is the initial product state', getFirstProductPreset(), productPresetsV3[0]);

// ──────────────────────────────────────────────────────────
section('4. Round-trip stability — repeated selection yields deep-equal config');
for (const preset of productPresetsV3) {
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
  const firstPreset = productPresetsV3[0];
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
  const s1 = createPresetSession(productPresetsV3[1]);
  const cfgFresh = resolveConfig(s1.template, s1.controls, s1.slotOverrides, s1.regionOverrides, s1.rootOverrides, s1.controlSurface);

  // Session 2: apply A, tweak overrides, then apply B via the same transition.
  let s2 = createPresetSession(productPresetsV3[0]);
  const dirtySlots: SlotOverrides = { 'footer:primary-start': { enabled: false } };
  s2 = { ...s2, slotOverrides: dirtySlots, regionOverrides: { footer: { padding: { top: 999 } } }, rootOverrides: { canvas: { border_radius: 42 } } };
  const cfgDirty = resolveConfig(s2.template, s2.controls, s2.slotOverrides, s2.regionOverrides, s2.rootOverrides, s2.controlSurface);
  if (!deepEqual(cfgDirty, cfgFresh)) pass('overrides on preset A change resolved config (sanity)');
  else fail('override sanity', 'overrides had no observable effect — fixture broken');

  s2 = createPresetSession(productPresetsV3[1]);
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
for (const preset of productPresetsV3) {
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
for (const preset of productPresetsV3) {
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
  const snapshot = structuredClone(src);
  const session = createPresetSession(src);
  session.controls.primary_start.push({ field_id: 'artist' });
  session.controls.text_sizes.primary_start = 'large';
  session.template.canvas.margins.top = 99;
  if (deepEqual(src, snapshot)) pass('mutating a session does not affect the source preset');
  else fail('mutation leaked', 'source ProductPreset was modified by mutating its clone');
}

// ──────────────────────────────────────────────────────────
section('10. Deep-freeze — direct mutation of the source preset is a hard error in dev');
{
  const src = getFirstProductPreset();
  let frozen = true;
  try {
    (src.mainControls as MainControlConfig).primary_start = [];
    frozen = false;
  } catch { /* expected in strict mode */ }
  // In non-strict contexts assignment silently fails; verify object state instead.
  if (frozen && src.mainControls.primary_start.length > 0) pass('mainControls is frozen (mutation rejected)');
  else fail('deep-freeze missing', 'ProductPreset.mainControls is writable at runtime');
}

// ──────────────────────────────────────────────────────────
section('11. Auto-Logo resolver — shared V3 contract fixture');
// The identical JSON file is consumed by packages/kari-core/tests/unit/test_v3_auto_logo.py,
// so any divergence between preview and PIL Process breaks CI on one side or the other.
type AutoLogoFixtureCase = { make: string | null; expected: string | null; note?: string };
type AutoLogoFixture = { builtins: string[]; cases: AutoLogoFixtureCase[] };
const fixturePath = resolve(process.cwd(), '../../packages/kari-core/tests/fixtures/v3_auto_logo_cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as AutoLogoFixture;
for (const kase of fixture.cases) {
  const r = resolveAutoLogo(kase.make, fixture.builtins);
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
  // Unknown brand + partial registry: V3 must NOT fall back to fujifilm.
  const r = resolveAutoLogo('UNKNOWN BRAND XYZ', ['sony', 'fujifilm']);
  assertEqual('unknown brand → no-match (no fujifilm fallback)', r, { path: null, reason: 'no-match' });
}

// ──────────────────────────────────────────────────────────
section('12. logo_position controls asset placement for every position');
for (const pos of ['left', 'center', 'right'] as const) {
  const base = createPresetSession(productPresetsV3[0]);
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
  const preset = productPresetsV3[0];
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
  const cfg = resolveConfig(presetDefaultBaseV3, getFirstProductPreset().mainControls);
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
for (const preset of productPresetsV3) {
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

console.log('');
if (failures > 0) {
  console.error(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log('All preset contract checks passed.');
