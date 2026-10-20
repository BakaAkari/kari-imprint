/**
 * Auto-Logo resolver — deterministic mirror of the Python policy in
 * `packages/kari-core/src/kari_core/processor/renderer.py::_resolve_auto_logo_path`.
 *
 * Policy:
 *   - builtin registry only (mirrors the `/api/logos` list on the front end
 *     and `LOGOS_DIR/*.png,*.jpg,*.jpeg,*.webp` on the back end)
 *   - whole-token, case-insensitive match against builtin stems
 *   - NO fujifilm fallback — unknown/missing Make returns null so the preview
 *     draws a neutral skeleton and PIL Process produces a transparent slot,
 *     matching what the user will actually get.
 *
 * The shared JSON contract lives at
 * `packages/kari-core/tests/fixtures/auto_logo_cases.json`; the Python
 * unit test `test_auto_logo.py` and this file's contract test both iterate
 * that same fixture so a drift on either side breaks CI.
 */

function tokenize(source: string): Set<string> {
  return new Set(
    source
      .toLowerCase()
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function stemMatchesTokens(stem: string, tokens: Set<string>): boolean {
  const stemTokens = tokenize(stem);
  for (const token of tokens) {
    if (stemTokens.has(token)) return true;
  }
  return false;
}

/**
 * Corporate EXIF `Make` strings that share no token with the logo stem.
 * Mirror of `BRAND_ALIASES` in `packages/kari-core/src/kari_core/core/auto_logo.py`.
 */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  'phase one': 'phaseone',
  'phase one a/s': 'phaseone',
  'arashi vision': 'insta360',
  'arashi vision inc.': 'insta360',
  'om digital solutions': 'olympus',
  'om digital solutions corporation': 'olympus',
  'om system': 'olympus',
  'leica camera ag': 'leica',
  'leica camera': 'leica',
  'nikon corporation': 'nikon',
  'eastman kodak company': 'kodak',
  hasselblad: 'hasselblad',
  'victor hasselblad ab': 'hasselblad',
  dji: 'dji',
  'sz dji technology co., ltd.': 'dji',
};

/** Model prefixes that identify the logo better than the corporate make. */
export const MODEL_PREFIX_ALIASES: ReadonlyArray<readonly [string, string]> = [['pentax', 'pentax']];

function normalizeSpaces(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Normalize EXIF make/model into the string used for stem matching. */
export function brandKey(make: string | null | undefined, model?: string | null): string {
  const normalizedModel = normalizeSpaces(model);
  for (const [prefix, brand] of MODEL_PREFIX_ALIASES) {
    if (normalizedModel.startsWith(prefix)) return brand;
  }
  const normalizedMake = normalizeSpaces(make);
  return BRAND_ALIASES[normalizedMake] ?? normalizedMake;
}

export type AutoLogoReason = 'no-registry' | 'no-make' | 'matched' | 'no-match';

export interface AutoLogoResolution {
  path: string | null;
  reason: AutoLogoReason;
}

export interface LogoRegistryEntry {
  stem: string;
  variants: string[];
}

/**
 * Resolve auto-Logo for the given EXIF Make, scheme, and optional variant.
 *
 * scheme == 'dark' → image has white background → use bright logo (no _dark suffix)
 * scheme == 'light' → image has dark background → use _dark variant
 */
export function resolveAutoLogoWithScheme(
  make: string | undefined | null,
  registry: readonly LogoRegistryEntry[],
  scheme: string,
  variant: string = '',
  model?: string | null,
): { stem: string | null; variant: string; dark: boolean; reason: AutoLogoReason } {
  if (!registry || registry.length === 0) {
    return { stem: null, variant: '', dark: false, reason: 'no-registry' };
  }
  const key = brandKey(make, model);
  if (!key) {
    return { stem: null, variant: '', dark: false, reason: 'no-make' };
  }
  const tokens = tokenize(key);
  if (tokens.size === 0) {
    return { stem: null, variant: '', dark: false, reason: 'no-make' };
  }
  const dark = scheme === 'light';
  const ordered = [...registry]
    .filter((entry) => !entry.stem.endsWith('_dark'))
    .sort((a, b) => a.stem.toLowerCase().localeCompare(b.stem.toLowerCase()));
  const matches = ordered.filter((entry) => stemMatchesTokens(entry.stem, tokens));
  if (matches.length === 0) return { stem: null, variant: '', dark: false, reason: 'no-match' };
  // olympus_blue_gold / olympus_white_gold: prefer the white mark on dark backgrounds.
  const white = matches.filter((entry) => tokenize(entry.stem).has('white'));
  const other = matches.filter((entry) => !white.includes(entry));
  const entry = (dark ? (white.length ? white : other) : (other.length ? other : white))[0];
  const effectiveVariant = variant || '';
  const hasVariant = entry.variants.includes(effectiveVariant) || effectiveVariant === '';
  return {
    stem: entry.stem,
    variant: hasVariant ? effectiveVariant : '',
    dark,
    reason: 'matched',
  };
}

/**
 * Legacy resolver — returns ``builtin:<stem>`` for backward compat.
 * New code should use ``resolveAutoLogoWithScheme``.
 */
export function resolveAutoLogo(
  make: string | undefined | null,
  builtins: readonly string[],
): AutoLogoResolution {
  const registry: LogoRegistryEntry[] = builtins.map((stem) => ({ stem, variants: [] }));
  const result = resolveAutoLogoWithScheme(make, registry, 'dark');
  if (result.stem) {
    return { path: `builtin:${result.stem}`, reason: result.reason };
  }
  return { path: null, reason: result.reason };
}
