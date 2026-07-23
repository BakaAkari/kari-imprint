/**
 * V3 auto-Logo resolver — deterministic mirror of the Python V3 policy in
 * `packages/kari-core/src/kari_core/processor/v3_renderer.py::_resolve_auto_logo_path`.
 *
 * V3 policy:
 *   - builtin registry only (mirrors the `/api/logos` list on the front end
 *     and `LOGOS_DIR/*.png,*.jpg,*.jpeg,*.webp` on the back end)
 *   - whole-token, case-insensitive match against builtin stems
 *   - NO fujifilm fallback — unknown/missing Make returns null so the preview
 *     draws a neutral skeleton and PIL Process produces a transparent slot,
 *     matching what the user will actually get.
 *
 * The shared JSON contract lives at
 * `packages/kari-core/tests/fixtures/v3_auto_logo_cases.json`; the Python
 * unit test `test_v3_auto_logo.py` and this file's contract test both iterate
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
  /** `builtin:<stem>` reference for a matched brand, else null (skeleton). */
  path: string | null;
  reason: AutoLogoReason;
}

/**
 * Resolve the preview-side auto-Logo path for the given EXIF Make and the set
 * of `/api/logos` builtin names.
 *
 * Return values are deliberately narrow — a null path is the correct product
 * outcome for anything the backend would also fail to resolve, so preview and
 * Process never diverge in what the user sees. The `reason` field is for
 * developer tooling / tests, not user-facing copy.
 */
export function resolveAutoLogo(
  make: string | undefined | null,
  builtins: readonly string[],
): AutoLogoResolution {
  if (!builtins || builtins.length === 0) {
    return { path: null, reason: 'no-registry' };
  }
  const trimmed = (make ?? '').trim();
  if (!trimmed) {
    return { path: null, reason: 'no-make' };
  }
  const tokens = tokenize(trimmed);
  if (tokens.size === 0) {
    return { path: null, reason: 'no-make' };
  }
  // Case-insensitive alphabetical order matches Python's sorted(..., key=str.lower).
  const ordered = [...builtins].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const stem of ordered) {
    if (stemMatchesTokens(stem, tokens)) {
      return { path: `builtin:${stem}`, reason: 'matched' };
    }
  }
  return { path: null, reason: 'no-match' };
}
