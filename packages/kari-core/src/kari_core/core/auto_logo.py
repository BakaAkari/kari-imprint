"""Shared auto-Logo brand matcher.

Both the V3 renderer (`processor/v3_renderer.py::_resolve_auto_logo_path`) and the
legacy V2 Jinja helper (`core/jinja2renders.py::resolve_auto_logo`) call the same
pure primitive here so that a rename or matcher tweak can never desynchronise the
two Python paths again. Front-end previews mirror the same behaviour through a
shared JSON contract fixture (`tests/fixtures/v3_auto_logo_cases.json`).

V3 policy — implemented at the callsite:
  - `_resolve_auto_logo_path` uses ONLY the builtin logos directory (no `custom/`
    lookup) and never falls back to fujifilm. Unknown or missing Make → None,
    so the preview draws a neutral skeleton and the exported watermark is
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


def match_brand_stem(make: str | None, stems: Iterable[str]) -> str | None:
    """Return the first stem whose tokens overlap `make`'s tokens.

    Iteration order is case-insensitive-alphabetical so that changes in
    filesystem enumeration order don't produce different logos for the same
    Make. Returns None when `make` is empty, when no tokens are meaningful, or
    when nothing matches — callers layer their own fallback if their product
    policy requires one (V2 does; V3 does not).
    """
    if not make:
        return None
    tokens = _tokenize(make)
    if not tokens:
        return None
    ordered = sorted(stems, key=str.lower)
    for stem in ordered:
        if _stem_matches_tokens(stem, tokens):
            return stem
    return None
