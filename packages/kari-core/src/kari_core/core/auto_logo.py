"""Shared auto-Logo brand matcher.

Both the renderer (`processor/renderer.py::_resolve_auto_logo_path`) and the
legacy Jinja helper (`core/jinja2renders.py::resolve_auto_logo`) call the same
pure primitive here so that a rename or matcher tweak can never desynchronise the
two Python paths again. Front-end previews mirror the same behaviour through a
shared JSON contract fixture (`tests/fixtures/auto_logo_cases.json`).

Policy — implemented at the callsite:
  - `_resolve_auto_logo_path` uses ONLY the builtin logos directory (no `custom/`
    lookup) and never falls back to fujifilm. Unknown or missing Make → None,
    so the preview draws a neutral skeleton and the exported imprint is
    transparent in the same place.
"""
from __future__ import annotations

from collections.abc import Iterable


def _tokenize(source: str) -> set[str]:
    """Return the set of tokens (length > 2) from a free-form brand string.

    Matches the front-end `tokenize` in `apps/web/src/autoLogo.ts` byte-for-byte
    so the two implementations agree on every input.
    """
    return {
        token
        for token in source.lower().replace("-", " ").replace("_", " ").split()
        if len(token) > 2
    }


def _stem_matches_tokens(stem: str, make_tokens: set[str]) -> bool:
    stem_tokens = _tokenize(stem)
    return any(token in stem_tokens for token in make_tokens)


# Corporate EXIF ``Make`` strings that do not share a token with the logo
# stem. Keys are lower-cased, whitespace-collapsed makes; values are brand keys
# that are then token-matched against the builtin stems. Mirrored in
# ``apps/web/src/autoLogo.ts::BRAND_ALIASES``.
BRAND_ALIASES: dict[str, str] = {
    "phase one": "phaseone",
    "phase one a/s": "phaseone",
    "arashi vision": "insta360",
    "arashi vision inc.": "insta360",
    "om digital solutions": "olympus",
    "om digital solutions corporation": "olympus",
    "om system": "olympus",
    "leica camera ag": "leica",
    "leica camera": "leica",
    "nikon corporation": "nikon",
    "eastman kodak company": "kodak",
    "hasselblad": "hasselblad",
    "victor hasselblad ab": "hasselblad",
    "dji": "dji",
    "sz dji technology co., ltd.": "dji",
}
# Model prefixes that identify the logo better than the corporate make
# (PENTAX bodies are reported as "RICOH IMAGING COMPANY, LTD.").
MODEL_PREFIX_ALIASES: tuple[tuple[str, str], ...] = (
    ("pentax", "pentax"),
)


def brand_key(make: str | None, model: str | None = None) -> str:
    """Normalize EXIF make/model into the string used for stem matching."""
    normalized_model = " ".join((model or "").lower().split())
    for prefix, brand in MODEL_PREFIX_ALIASES:
        if normalized_model.startswith(prefix):
            return brand
    normalized_make = " ".join((make or "").lower().split())
    return BRAND_ALIASES.get(normalized_make, normalized_make)


def match_brand_stem(
    make: str | None,
    stems: Iterable[str],
    model: str | None = None,
    *,
    on_dark: bool = False,
) -> str | None:
    """Return the first stem whose tokens overlap the brand tokens of `make`.

    Make is first normalized through ``brand_key`` (alias table + model
    prefixes). Iteration order is case-insensitive-alphabetical so that changes
    in filesystem enumeration order don't produce different logos for the same
    Make. Returns None when `make` is empty, when no tokens are meaningful, or
    when nothing matches — callers layer their own fallback if their product
    policy requires one (V2 does; V3 does not).

    When several stems match (``olympus_blue_gold`` / ``olympus_white_gold``),
    a stem carrying the ``white`` token is preferred on dark backgrounds and
    avoided on light ones.
    """
    if not make and not model:
        return None
    key = brand_key(make, model)
    if not key:
        return None
    tokens = _tokenize(key)
    if not tokens:
        return None
    matches = [stem for stem in sorted(stems, key=str.lower) if _stem_matches_tokens(stem, tokens)]
    if not matches:
        return None
    white = [stem for stem in matches if "white" in _tokenize(stem)]
    other = [stem for stem in matches if stem not in white]
    preferred = (white or other) if on_dark else (other or white)
    return preferred[0]
