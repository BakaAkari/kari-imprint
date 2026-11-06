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

BoxRef = Literal["photo", "canvas", "margin-top", "margin-bottom", "margin-left", "margin-right"]
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


def resolve_box(box: str, photo: Rect, canvas: Size) -> Rect:
    from kari_core.shared.layout.layout_engine import Rect

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


def compose_layers(
    layers: list[dict[str, Any]] | None,
    photo: Rect,
    canvas: Size,
    short_edge: int,
    defaults: StyleConfig,
) -> ComposeResult:
    from kari_core.shared.layout.layout_engine import ComputedElement, Rect

    result = ComposeResult()
    for layer in layers or []:
        kind = layer.get("kind")
        layer_id = str(layer.get("id", ""))
        if kind == "fill":
            r = _grow(resolve_box(layer["box"], photo, canvas), _px(layer.get("outset"), short_edge))
            if r.w > 0 and r.h > 0:
                result.ops.append(DrawOp(layer_id, "rect", r, layer["color"], _opacity(layer.get("opacity")), layer.get("z") or "under"))
        elif kind == "keyline":
            inner = _grow(resolve_box(layer["box"], photo, canvas), _px(layer.get("offset"), short_edge))
            width = max(1, _px(layer.get("width"), short_edge))
            color = layer["color"]
            result.ops.extend(
                _ring(layer_id, inner, width, (color, color, color, color), _opacity(layer.get("opacity")), layer.get("z") or "under")
            )
        elif kind == "rule":
            b = resolve_box(layer["box"], photo, canvas)
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
            b = resolve_box(layer["box"], photo, canvas)
            anchor = layer.get("anchor") or "top-left"
            ax, ay = _anchor_point(b, anchor)
            w = max(1, _px(layer.get("w"), short_edge))
            h = max(1, _px(layer.get("h"), short_edge))
            x0 = ax + _px(layer.get("offset_x"), short_edge)
            y0 = ay + _px(layer.get("offset_y"), short_edge)
            x = x0 - w if "right" in anchor else x0 - w // 2 if "center" in anchor else x0
            y = y0 - h if "bottom" in anchor else y0 - h // 2 if "middle" in anchor else y0
            result.ops.append(
                DrawOp(layer_id, "rect", Rect(x, y, w, h), layer["color"], _opacity(layer.get("opacity")), layer.get("z") or "under")
            )
        elif kind == "text":
            content = _text_content(layer.get("content") or {})
            if not content.chips:
                continue
            b = resolve_box(layer["box"], photo, canvas)
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
