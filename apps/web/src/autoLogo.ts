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
): { stem: string | null; variant: string; dark: boolean; reason: AutoLogoReason } {
  if (!registry || registry.length === 0) {
    return { stem: null, variant: '', dark: false, reason: 'no-registry' };
  }
  const trimmed = (make ?? '').trim();
  if (!trimmed) {
    return { stem: null, variant: '', dark: false, reason: 'no-make' };
  }
  const tokens = tokenize(trimmed);
  if (tokens.size === 0) {
    return { stem: null, variant: '', dark: false, reason: 'no-make' };
  }
  const ordered = [...registry].sort((a, b) => a.stem.toLowerCase().localeCompare(b.stem.toLowerCase()));
  for (const entry of ordered) {
    if (stemMatchesTokens(entry.stem, tokens)) {
      const dark = scheme === 'light';
      const effectiveVariant = variant || '';
      const hasVariant = entry.variants.includes(effectiveVariant) || effectiveVariant === '';
      return {
        stem: entry.stem,
        variant: hasVariant ? effectiveVariant : '',
        dark,
        reason: 'matched',
      };
    }
  }
  return { stem: null, variant: '', dark: false, reason: 'no-match' };
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
