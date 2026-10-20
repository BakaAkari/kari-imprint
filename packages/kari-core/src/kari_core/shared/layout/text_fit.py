"""Text fitting for Flow Layout text slots — pure, renderer-agnostic.

Mirrors ``apps/web/src/layout/textFit.ts`` line by line. The layout engine
owns slot geometry but not font metrics, so both renderers (PIL export and the
Canvas preview) call this module with their own ``measure`` callback after
``compute_layout``. Golden fixtures (``text_fit_cases.json``) run both
implementations with the same deterministic fake measurer.

Policy:
  1. Text that fits keeps its size.
  2. Otherwise shrink, but never below ``MIN_FIT_SCALE`` (80%) of the size.
  3. Still too long at 80% → truncate and append ``...``.
  4. Paired start/end slots on one track share the track: a short (or empty)
     partner donates its unused length, unless a centered logo separates them.
  5. Hierarchy: secondary-track text is never scaled less than primary-track
     text in the same region, so the primary line is never visually smaller.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from kari_core.shared.layout.layout_engine import ComputedElement, TextContent

MIN_FIT_SCALE = 0.8
# Three ASCII periods: the CJK font renders U+2026 as vertically centered dots.
ELLIPSIS = "..."
_SLOT_ID_RE = re.compile(r"^(?P<region>.+)-(?P<track>primary|secondary)-(?P<endpoint>start|end)$")

# measure(element, text, font_size) -> advance width in canvas pixels
Measure = Callable[[ComputedElement, str, int], float]


@dataclass(frozen=True, slots=True)
class FittedText:
    font_size: int
    text: str


def _interval(el: ComputedElement) -> tuple[float, float, float]:
    """Return (lo, hi, length) of the element's slot along its main axis."""
    anchor = el.anchor
    rect = el.rect
    if "right" in anchor:
        return rect.x - rect.w, rect.x, rect.w
    if "left" in anchor:
        return rect.x, rect.x + rect.w, rect.w
    if "top" in anchor:
        return rect.y, rect.y + rect.h, rect.h
    if "bottom" in anchor:
        return rect.y - rect.h, rect.y, rect.h
    return rect.x - rect.w / 2, rect.x + rect.w / 2, rect.w


def _track_of(el: ComputedElement) -> tuple[str, str]:
    match = _SLOT_ID_RE.match(el.id)
    return (match["region"], match["track"]) if match else (el.id, "primary")


def fit_single(text: str, font_size: int, max_length: float, measure: Callable[[str, int], float]) -> FittedText:
    """Shrink to ≥80%, then truncate with an ellipsis, so ``text`` fits ``max_length``."""
    if not text or font_size <= 0:
        return FittedText(font_size, text)
    if max_length <= 0:
        return FittedText(font_size, "")
    natural = measure(text, font_size)
    if natural <= max_length:
        return FittedText(font_size, text)
    min_size = max(1, math.floor(font_size * MIN_FIT_SCALE))
    target = math.floor(font_size * max_length / natural)
    if target >= min_size:
        size = target
        while size > min_size and measure(text, size) > max_length:
            size -= 1
        if measure(text, size) <= max_length:
            return FittedText(size, text)
    size = min_size
    if measure(text, size) <= max_length:
        return FittedText(size, text)
    chars = list(text)
    lo, hi, best = 0, len(chars) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        candidate = "".join(chars[:mid]).rstrip() + ELLIPSIS
        if measure(candidate, size) <= max_length:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    if best < 0:
        return FittedText(size, "")
    return FittedText(size, "".join(chars[:best]).rstrip() + ELLIPSIS)


def fit_layout_texts(
    elements: Sequence[ComputedElement],
    texts: dict[str, str],
    measure: Measure,
) -> dict[str, FittedText]:
    """Fit every horizontal / rotated text element; returns id → FittedText.

    ``texts`` maps element id → resolved display text. Elements whose direction
    is ``vertical-glyphs`` are returned unchanged.
    """
    result: dict[str, FittedText] = {}
    text_elements = [
        el for el in elements
        if el.type == "text" and isinstance(el.content, TextContent) and texts.get(el.id)
    ]
    centered_logo_regions = {
        el.id[: -len("-asset")]
        for el in elements
        if el.type == "logo" and el.id.endswith("-asset") and el.anchor == "middle-center"
    }

    # 1. Available length per element (track sharing between paired slots).
    available: dict[str, float] = {}
    groups: dict[tuple[str, str], dict[str, ComputedElement]] = {}
    for el in text_elements:
        match = _SLOT_ID_RE.match(el.id)
        if match is None:
            available[el.id] = _interval(el)[2]
            continue
        groups.setdefault((match["region"], match["track"]), {})[match["endpoint"]] = el
    for (region_id, _track), pair in groups.items():
        start = pair.get("start")
        end = pair.get("end")
        if start is None or end is None or region_id in centered_logo_regions:
            for el in (start, end):
                if el is not None:
                    available[el.id] = _interval(el)[2]
            continue
        first, second = (start, end) if _interval(start)[0] <= _interval(end)[0] else (end, start)
        a_lo, a_hi, a_len = _interval(first)
        b_lo, b_hi, b_len = _interval(second)
        gap = max(0.0, b_lo - a_hi)
        total = b_hi - a_lo
        need_a = measure(first, texts[first.id], first.style.font_size or 16)
        need_b = measure(second, texts[second.id], second.style.font_size or 16)
        len_a, len_b = a_len, b_len
        if need_a > a_len and need_b <= b_len:
            len_a = max(a_len, total - gap - need_b)
        elif need_b > b_len and need_a <= a_len:
            len_b = max(b_len, total - gap - need_a)
        available[first.id] = len_a
        available[second.id] = len_b

    # 2. Fit primaries first, then cap secondaries by the primary scale.
    primary_scale: dict[str, float] = {}
    ordered = sorted(text_elements, key=lambda el: 0 if _track_of(el)[1] == "primary" else 1)
    for el in ordered:
        text = texts[el.id]
        size = el.style.font_size or 16
        direction = el.style.text_direction or "horizontal"
        if direction == "vertical-glyphs":
            result[el.id] = FittedText(size, text)
            continue
        region_id, track = _track_of(el)
        base_size = size
        if track == "secondary" and region_id in primary_scale:
            base_size = max(1, min(size, math.floor(size * primary_scale[region_id] + 1e-9)))
        fitted = fit_single(text, base_size, available.get(el.id, 0), lambda t, s, _el=el: measure(_el, t, s))
        result[el.id] = fitted
        if track == "primary":
            scale = fitted.font_size / size if size else 1.0
            primary_scale[region_id] = min(primary_scale.get(region_id, 1.0), scale)
    return result
