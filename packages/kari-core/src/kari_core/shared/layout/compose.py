"""Layer composition — mirror of ``apps/web/src/layout/compose.ts``.

``config.layers`` describe construction around and on the photo (mats,
keylines, rules, fills, text). Layout lowers every geometric layer to
axis-aligned integer ``rect`` draw ops, so the PIL renderer and the Canvas
preview paint identical pixels for them. Text layers become ordinary text
elements and reuse the shared fitting and drawing path.

Every length is a ratio of the photo's short edge, rounded once with Python's
``round`` (half-to-even, ``pyRound`` in TS). Fixtures:
``packages/kari-core/tests/fixtures/compose_cases.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, fields, replace
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from kari_core.shared.layout.layout_engine import ComputedElement, Rect, Size, StyleConfig

# The letterbox bars exist only after a ``letterbox`` layer (otherwise they are empty).
BoxRef = Literal[
    "photo", "canvas", "margin-top", "margin-bottom", "margin-left", "margin-right", "letterbox-top", "letterbox-bottom",
]
LayerZ = Literal["under", "over"]

# Bevel lighting: the top/left faces catch light, the bottom/right faces fall into shade.
BEVEL_LIGHT_PERCENT = 35
BEVEL_SHADE_PERCENT = 18


@dataclass(slots=True)
class DrawOp:
    id: str
    op: Literal["rect"]
    rect: Rect
    color: str
    opacity: float
    z: LayerZ
    radius: int = 0  # corner radius in px (rect panels)
    blur: int = 0  # backdrop blur sigma in px (glass panels)


@dataclass(slots=True)
class ComposeResult:
    ops: list[DrawOp] = field(default_factory=list)
    elements: list[ComputedElement] = field(default_factory=list)


def _px(ratio: float | None, short_edge: int) -> int:
    return round((ratio or 0) * short_edge)


def _grow(r: Rect, by: int) -> Rect:
    from kari_core.shared.layout.layout_engine import Rect

    return Rect(x=r.x - by, y=r.y - by, w=r.w + 2 * by, h=r.h + 2 * by)


def shift_color(color: str, percent: int) -> str:
    """Integer per-channel mix toward white (percent > 0) or black (percent < 0)."""
    text = color.strip().lstrip("#")
    if not re.match(r"^[0-9a-fA-F]{6}", text):
        return color
    channels = [int(text[i:i + 2], 16) for i in (0, 2, 4)]
    target = 255 if percent >= 0 else 0
    p = abs(percent)
    mixed = [(c * (100 - p) + target * p) // 100 for c in channels]
    return "#" + "".join(f"{value:02X}" for value in mixed)


def resolve_box(box: str, photo: Rect, canvas: Size, dynamic: dict[str, Rect] | None = None) -> Rect:
    from kari_core.shared.layout.layout_engine import Rect

    if dynamic and box in dynamic:
        found = dynamic[box]
        return Rect(found.x, found.y, found.w, found.h)
    if box == "letterbox-top":
        return Rect(photo.x, photo.y, photo.w, 0)
    if box == "letterbox-bottom":
        return Rect(photo.x, photo.y + photo.h, photo.w, 0)
    if box == "canvas":
        return Rect(0, 0, canvas.w, canvas.h)
    if box == "margin-top":
        return Rect(0, 0, canvas.w, photo.y)
    if box == "margin-bottom":
        return Rect(0, photo.y + photo.h, canvas.w, canvas.h - photo.y - photo.h)
    if box == "margin-left":
        return Rect(0, photo.y, photo.x, photo.h)
    if box == "margin-right":
        return Rect(photo.x + photo.w, photo.y, canvas.w - photo.x - photo.w, photo.h)
    return Rect(photo.x, photo.y, photo.w, photo.h)


def _ring(
    op_id: str,
    inner: Rect,
    width: int,
    colors: tuple[str, str, str, str],
    opacity: float,
    z: LayerZ,
) -> list[DrawOp]:
    from kari_core.shared.layout.layout_engine import Rect

    if width <= 0 or inner.w <= 0 or inner.h <= 0:
        return []
    outer = _grow(inner, width)
    top, left, bottom, right = colors
    return [
        DrawOp(f"{op_id}-top", "rect", Rect(outer.x, outer.y, outer.w, width), top, opacity, z),
        DrawOp(f"{op_id}-left", "rect", Rect(outer.x, inner.y, width, inner.h), left, opacity, z),
        DrawOp(f"{op_id}-bottom", "rect", Rect(outer.x, inner.y + inner.h, outer.w, width), bottom, opacity, z),
        DrawOp(f"{op_id}-right", "rect", Rect(inner.x + inner.w, inner.y, width, inner.h), right, opacity, z),
    ]


def _opacity(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return 1.0
    return min(1.0, max(0.0, float(value)))


def _anchor_point(bounds: Rect, anchor: str) -> tuple[int, int]:
    x = bounds.x
    if "center" in anchor:
        x = bounds.x + bounds.w // 2
    elif "right" in anchor:
        x = bounds.x + bounds.w
    y = bounds.y
    if "middle" in anchor:
        y = bounds.y + bounds.h // 2
    elif "bottom" in anchor:
        y = bounds.y + bounds.h
    return x, y


def _text_content(raw: dict[str, Any]):
    from kari_core.shared.layout.layout_engine import FieldChip, TextContent

    return TextContent(
        chips=[
            FieldChip(field_id=chip.get("field_id", "empty"), custom_text=chip.get("custom_text", ""), format=chip.get("format") or "")
            for chip in raw.get("chips") or []
        ],
        separator=raw.get("separator", " "),
    )


def _style_from(defaults: StyleConfig, patch: dict[str, Any] | None, font_size: int) -> StyleConfig:
    known = {f.name for f in fields(defaults)}
    resolved = {"font_size", "font_size_level", "font_size_ratio"}
    overrides = {
        key: value
        for key, value in (patch or {}).items()
        if key in known and key not in resolved and value is not None
    }
    return replace(defaults, **overrides, font_size=font_size, font_size_level=None, font_size_ratio=None)


# ── Seven-segment digits ──────────────────────────────────────────────
#
# Segments: a top, b upper-right, c lower-right, d bottom, e lower-left,
# f upper-left, g middle. Integer geometry shared by both renderers.

_SEGMENT_DIGITS = {
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd", "-": "g",
}
SEGMENT_GLOW_OPACITY = 0.22


def _segment_advance(ch: str, h: int) -> int:
    if ch in _SEGMENT_DIGITS:
        return round(h * 0.55)
    if ch in {"'", ".", ":"}:
        return round(h * 0.22)
    return round(h * 0.38)


def segment_rects(text: str, x: int, y: int, h: int, anchor: str) -> list[Rect]:
    """Rects for ``text`` with its anchor point at (x, y) and digit height ``h``; mirror of compose.ts."""
    from kari_core.shared.layout.layout_engine import Rect

    t = max(1, round(h * 0.12))
    gap = max(1, round(h * 0.16))
    chars = list(text)
    total = sum(_segment_advance(ch, h) for ch in chars) + gap * max(0, len(chars) - 1)
    cx = x - total if "right" in anchor else x - total // 2 if "center" in anchor else x
    top = y - h if "bottom" in anchor else y - h // 2 if "middle" in anchor else y
    mid = top + (h - t) // 2
    bot = top + h - t
    rects: list[Rect] = []
    for ch in chars:
        w = _segment_advance(ch, h)
        segments = _SEGMENT_DIGITS.get(ch)
        if segments:
            span = w - 2 * t
            upper = mid - top - t
            lower = bot - mid - t
            shapes = {
                "a": Rect(cx + t, top, span, t),
                "g": Rect(cx + t, mid, span, t),
                "d": Rect(cx + t, bot, span, t),
                "f": Rect(cx, top + t, t, upper),
                "b": Rect(cx + w - t, top + t, t, upper),
                "e": Rect(cx, mid + t, t, lower),
                "c": Rect(cx + w - t, mid + t, t, lower),
            }
            rects.extend(shapes[seg] for seg in segments)
        elif ch == "'":
            rects.append(Rect(cx + (w - t) // 2, top, t, round(h * 0.3)))
        elif ch == ".":
            rects.append(Rect(cx + (w - t) // 2, bot, t, t))
        elif ch == ":":
            rects.append(Rect(cx + (w - t) // 2, top + round(h * 0.25), t, t))
            rects.append(Rect(cx + (w - t) // 2, top + round(h * 0.7), t, t))
        cx += w + gap
    return rects


def segment_ops(op_id: str, text: str, rect: Rect, anchor: str, color: str, glow: bool) -> list[DrawOp]:
    """Draw ops for a resolved date stamp: a soft glow ring under each segment, then the segment."""
    rects = segment_rects(text, rect.x, rect.y, rect.h, anchor)
    spread = max(1, round(rect.h * 0.07))
    ops: list[DrawOp] = []
    if glow:
        ops.extend(DrawOp(f"{op_id}-glow-{i}", "rect", _grow(r, spread), color, SEGMENT_GLOW_OPACITY, "over") for i, r in enumerate(rects))
    ops.extend(DrawOp(f"{op_id}-{i}", "rect", r, color, 1.0, "over") for i, r in enumerate(rects))
    return ops


def compose_layers(
    layers: list[dict[str, Any]] | None,
    photo: Rect,
    canvas: Size,
    short_edge: int,
    defaults: StyleConfig,
    asset_aspect: float = 3.0,
) -> ComposeResult:
    from kari_core.shared.layout.layout_engine import ComputedElement, LogoContent, Rect

    result = ComposeResult()
    dynamic: dict[str, Rect] = {}

    def box(ref: str) -> Rect:
        return resolve_box(ref, photo, canvas, dynamic)

    for layer in layers or []:
        kind = layer.get("kind")
        layer_id = str(layer.get("id", ""))
        if kind == "fill":
            r = _grow(box(layer["box"]), _px(layer.get("outset"), short_edge))
            if r.w > 0 and r.h > 0:
                result.ops.append(DrawOp(layer_id, "rect", r, layer["color"], _opacity(layer.get("opacity")), layer.get("z") or "under"))
        elif kind == "keyline":
            inner = _grow(box(layer["box"]), _px(layer.get("offset"), short_edge))
            width = max(1, _px(layer.get("width"), short_edge))
            color = layer["color"]
            result.ops.extend(
                _ring(layer_id, inner, width, (color, color, color, color), _opacity(layer.get("opacity")), layer.get("z") or "under")
            )
        elif kind == "rule":
            b = box(layer["box"])
            offset = _px(layer.get("offset"), short_edge)
            width = max(1, _px(layer.get("width"), short_edge))
            inset = _px(layer.get("inset"), short_edge)
            edge = layer.get("edge")
            if edge == "top":
                r = Rect(b.x + inset, b.y - offset - width, b.w - 2 * inset, width)
            elif edge == "bottom":
                r = Rect(b.x + inset, b.y + b.h + offset, b.w - 2 * inset, width)
            elif edge == "left":
                r = Rect(b.x - offset - width, b.y + inset, width, b.h - 2 * inset)
            else:
                r = Rect(b.x + b.w + offset, b.y + inset, width, b.h - 2 * inset)
            if r.w > 0 and r.h > 0:
                result.ops.append(DrawOp(layer_id, "rect", r, layer["color"], _opacity(layer.get("opacity")), layer.get("z") or "under"))
        elif kind == "mat":
            core = layer.get("core")
            core_w = max(1, _px(core.get("width"), short_edge)) if core else 0
            reveal = layer.get("reveal")
            if reveal:
                reveal_w = max(1, _px(reveal.get("width"), short_edge))
                c = reveal["color"]
                result.ops.extend(_ring(f"{layer_id}-reveal", _grow(photo, core_w), reveal_w, (c, c, c, c), 1.0, "under"))
            if core:
                bevel = core.get("bevel") is True
                lit = shift_color(core["color"], BEVEL_LIGHT_PERCENT) if bevel else core["color"]
                shade = shift_color(core["color"], -BEVEL_SHADE_PERCENT) if bevel else core["color"]
                result.ops.extend(_ring(f"{layer_id}-core", photo, core_w, (lit, lit, shade, shade), 1.0, "under"))
        elif kind == "rect":
            b = box(layer["box"])
            anchor = layer.get("anchor") or "top-left"
            ax, ay = _anchor_point(b, anchor)
            w = max(1, b.w if layer.get("w") is None else _px(layer.get("w"), short_edge))
            h = max(1, b.h if layer.get("h") is None else _px(layer.get("h"), short_edge))
            x0 = ax + _px(layer.get("offset_x"), short_edge)
            y0 = ay + _px(layer.get("offset_y"), short_edge)
            x = x0 - w if "right" in anchor else x0 - w // 2 if "center" in anchor else x0
            y = y0 - h if "bottom" in anchor else y0 - h // 2 if "middle" in anchor else y0
            radius = _px(layer.get("radius"), short_edge)
            blur = _px(layer.get("blur"), short_edge)
            result.ops.append(
                DrawOp(
                    layer_id, "rect", Rect(x, y, w, h), layer["color"], _opacity(layer.get("opacity")), layer.get("z") or "under",
                    radius=min(radius, min(w, h) // 2) if radius > 0 else 0,
                    blur=blur if blur > 0 else 0,
                )
            )
        elif kind == "letterbox":
            aspect = layer.get("aspect") or 0
            if aspect <= 0:
                continue
            visible = round(photo.w / aspect)
            if visible >= photo.h:
                continue
            top = (photo.h - visible) // 2
            bottom = photo.h - visible - top
            opacity = _opacity(layer.get("opacity"))
            dynamic["letterbox-top"] = Rect(photo.x, photo.y, photo.w, top)
            dynamic["letterbox-bottom"] = Rect(photo.x, photo.y + photo.h - bottom, photo.w, bottom)
            result.ops.append(DrawOp(f"{layer_id}-top", "rect", dynamic["letterbox-top"], layer["color"], opacity, "over"))
            result.ops.append(DrawOp(f"{layer_id}-bottom", "rect", dynamic["letterbox-bottom"], layer["color"], opacity, "over"))
        elif kind == "logo":
            b = box(layer["box"])
            anchor = layer.get("anchor") or "top-left"
            x, y = _anchor_point(b, anchor)
            h = max(1, _px(layer.get("height"), short_edge))
            w = max(1, round(h * asset_aspect))
            placement = "end" if "right" in anchor else "center" if "center" in anchor else "start"
            result.elements.append(
                ComputedElement(
                    id=layer_id, type="logo", anchor=anchor,
                    rect=Rect(x + _px(layer.get("offset_x"), short_edge), y + _px(layer.get("offset_y"), short_edge), w, h),
                    content=LogoContent(path=layer.get("path") or "", placement=placement),
                    style=replace(defaults),
                )
            )
        elif kind == "segments":
            content = _text_content(layer.get("content") or {})
            if not content.chips:
                continue
            b = box(layer["box"])
            anchor = layer.get("anchor") or "bottom-right"
            x, y = _anchor_point(b, anchor)
            result.elements.append(
                ComputedElement(
                    id=layer_id, type="segments", anchor=anchor,
                    rect=Rect(x + _px(layer.get("offset_x"), short_edge), y + _px(layer.get("offset_y"), short_edge), 0,
                              max(4, _px(layer.get("height"), short_edge))),
                    content=content,
                    # For segments, style.opacity carries the glow switch (0 = no glow).
                    style=replace(defaults, color=layer["color"], opacity=0.0 if layer.get("glow") is False else 1.0),
                )
            )
        elif kind == "text":
            content = _text_content(layer.get("content") or {})
            if not content.chips:
                continue
            b = box(layer["box"])
            anchor = layer.get("anchor") or "middle-center"
            x, y = _anchor_point(b, anchor)
            font_size = max(8, _px(layer.get("size"), short_edge))
            max_width = layer.get("max_width")
            width = max(1, round(b.w * max_width)) if max_width is not None else b.w
            result.elements.append(
                ComputedElement(
                    id=layer_id,
                    type="text",
                    rect=Rect(
                        x + _px(layer.get("offset_x"), short_edge),
                        y + _px(layer.get("offset_y"), short_edge),
                        # Text layers are horizontal; text_fit reads a top/bottom-anchored slot's
                        # length from ``h`` (side-bar convention), so both extents carry the width.
                        width,
                        width,
                    ),
                    anchor=anchor,
                    content=content,
                    style=_style_from(defaults, layer.get("style"), font_size),
                )
            )
    return result
