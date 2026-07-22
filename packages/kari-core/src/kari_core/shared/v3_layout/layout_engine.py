"""V3 Region-Based Layout Engine — 纯函数布局计算。

此模块不包含任何 PIL/Canvas 依赖，只负责：
  - 输入：WatermarkConfig + image_w/h
  - 输出：LayoutResult（每个水印元素在画布上的绝对位置和尺寸）

前后端共享同一套算法逻辑，通过单元测试保证一致性。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# ── 基础几何 ─────────────────────────────────

@dataclass(frozen=True, slots=True)
class Rect:
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0

    @property
    def right(self) -> int:
        return self.x + self.w

    @property
    def bottom(self) -> int:
        return self.y + self.h

    @property
    def center_x(self) -> int:
        return self.x + self.w // 2

    @property
    def center_y(self) -> int:
        return self.y + self.h // 2


@dataclass(frozen=True, slots=True)
class Point:
    x: int = 0
    y: int = 0


@dataclass(frozen=True, slots=True)
class Size:
    w: int = 0
    h: int = 0


# ── 配置类型 ─────────────────────────────────

@dataclass(slots=True)
class MarginsConfig:
    top: int = 0
    right: int = 0
    bottom: int = 0
    left: int = 0


@dataclass(slots=True)
class BorderConfig:
    enabled: bool = False
    width_level: str = "medium"  # 'small' | 'medium' | 'large'
    color: str = "#FFFFFF"


@dataclass(slots=True)
class CanvasConfig:
    margins: MarginsConfig = field(default_factory=MarginsConfig)
    background: str = "#FFFFFF"
    border_radius: int = 0
    border: BorderConfig | None = None


@dataclass(slots=True)
class FieldChip:
    field_id: str = "empty"
    custom_text: str = ""


@dataclass(slots=True)
class TextContent:
    chips: list[FieldChip] = field(default_factory=list)
    separator: str = " "


@dataclass(slots=True)
class LogoContent:
    path: str = ""           # 空表示 auto
    size_ratio: float | None = 0.6  # logo 高度占所在区域高度的比例
    size_level: str | None = None   # 'small' | 'medium' | 'large'
    orientation: str = "upright"
    placement: str = "center"
    track: str = "span"


@dataclass(slots=True)
class SignatureContent:
    path: str = ""
    invert_mono: bool = False
    size_ratio: float | None = 0.20
    size_level: str | None = None
    orientation: str = "upright"
    placement: str = "end"
    track: str = "span"


@dataclass(slots=True)
class StyleConfig:
    font_size: int | None = None
    font_size_ratio: float | None = None
    font_size_level: str | None = None
    size_reference: Literal["region_height", "short_edge", "long_edge"] = "region_height"
    color: str = "#222222"
    font_family: str = "NotoSansCJKsc-Bold.otf"
    bold: bool = True
    line_height: float = 1.2
    text_direction: Literal["horizontal", "rotate-cw", "rotate-ccw", "vertical-glyphs"] | None = None


@dataclass(slots=True)
class SlotConfig:
    enabled: bool = False
    content: TextContent | LogoContent | SignatureContent | None = None
    style: StyleConfig | None = None


@dataclass(slots=True)
class FlowLayoutConfig:
    mode: Literal["single-track", "dual-track"] = "dual-track"
    main_alignment: Literal["start", "center", "end", "space-between"] = "space-between"
    cross_alignment: Literal["start", "center", "end"] = "center"
    track_order: Literal["photo-outward", "outward-photo"] = "photo-outward"
    track_gap: dict[str, float | int | str] = field(default_factory=lambda: {"mode": "short_edge_ratio", "value": 0.012})
    item_gap: dict[str, float | int | str] = field(default_factory=lambda: {"mode": "short_edge_ratio", "value": 0.012})
    track_ratios: tuple[float, float] = (0.6, 0.4)


@dataclass(slots=True)
class RegionConfig:
    id: str = ""
    type: str = ""  # 'footer-bar' | 'side-bar' | 'side-edge' | 'free'
    enabled: bool = False
    # footer-bar 特有
    slots: dict[str, SlotConfig] = field(default_factory=dict)
    height: float | None = None  # 占图片短边的比例，由布局引擎解析为实际像素高度
    # side-edge 特有
    edge: Literal["left", "right"] | None = None
    width: dict[str, float | int | str] | None = None  # {"mode": "pixel"|"short_edge_ratio", "value": ...}
    alignment: Literal["start", "center", "end"] = "start"
    vertical_alignment: Literal["start", "center", "end"] = "center"
    padding: dict[str, int] | None = None
    layout: FlowLayoutConfig | None = None
    text_orientation: str = "auto"
    # free 特有
    anchor: str | None = None  # 九宫格锚点
    offset_x: float = 0.0
    offset_y: float = 0.0
    offset_unit: Literal["pixel", "short_edge_ratio"] = "short_edge_ratio"


@dataclass(slots=True)
class WatermarkConfig:
    canvas: CanvasConfig = field(default_factory=CanvasConfig)
    regions: list[RegionConfig] = field(default_factory=list)
    defaults: StyleConfig = field(default_factory=StyleConfig)
    custom_text: str = ""
    # Internal compatibility only. Public schema v3 no longer serializes it.
    footer_mode: Literal["dual-row", "single-row"] = "dual-row"


# ── 布局结果 ─────────────────────────────────

@dataclass(slots=True)
class ComputedElement:
    id: str
    type: Literal["text", "logo", "signature", "divider"]
    rect: Rect
    anchor: str  # 九宫格
    content: TextContent | LogoContent | SignatureContent
    style: StyleConfig


@dataclass(slots=True)
class LayoutResult:
    canvas: Size
    image_rect: Rect
    elements: list[ComputedElement] = field(default_factory=list)


# ── Layout Diagnostics ─────────────────────────────────

@dataclass(slots=True)
class DiagnosticItem:
    id: str
    type: str
    severity: Literal["error", "warning"]
    message: str
    element_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class LayoutResultWithDiagnostics:
    layout: LayoutResult
    diagnostics: list[DiagnosticItem] = field(default_factory=list)


# ── 布局引擎 ─────────────────────────────────

def compute_layout(config: WatermarkConfig, image_w: int, image_h: int) -> LayoutResult:
    """主入口：计算每个水印元素在画布上的绝对位置和尺寸。"""

    # ── Step 1: 画布尺寸 ─────────────────────────────
    margins = config.canvas.margins
    short_edge = min(image_w, image_h)
    long_edge = max(image_w, image_h)

    # footer-bar 的 height 为占短边比例，在此解析为实际像素底部边距
    has_footer = False
    for region in config.regions:
        if region.enabled and region.type == "footer-bar" and region.height is not None:
            margins.bottom = max(20, round(short_edge * region.height))
            has_footer = True

    # side-bar occupies real canvas space rather than overlaying the photo.
    for region in config.regions:
        if not region.enabled or region.type != "side-bar":
            continue
        side_width = _resolve_side_width(region, short_edge)
        if region.edge == "left":
            margins.left = max(margins.left, side_width)
        else:
            margins.right = max(margins.right, side_width)

    # 边框：在空白边设置 margins，底部有 footer-bar 时不额外加底边
    border = config.canvas.border
    if border is not None and border.enabled:
        bw = max(1, round(short_edge * _BORDER_WIDTH_RATIOS.get(border.width_level, 0.035)))
        if margins.top == 0:
            margins.top = bw
        if margins.left == 0:
            margins.left = bw
        if margins.right == 0:
            margins.right = bw
        if not has_footer and margins.bottom == 0:
            margins.bottom = bw

    canvas_w = image_w + margins.left + margins.right
    canvas_h = image_h + margins.top + margins.bottom

    image_rect = Rect(x=margins.left, y=margins.top, w=image_w, h=image_h)
    canvas = Size(w=canvas_w, h=canvas_h)

    elements: list[ComputedElement] = []
    for region in config.regions:
        if not region.enabled:
            continue

        if region.type == "footer-bar":
            elements.extend(_compute_footer_bar(
                region,
                image_rect,
                canvas,
                config.defaults,
                short_edge,
                long_edge,
                "single-row"
                if region.layout is not None and region.layout.mode == "single-track"
                else config.footer_mode,
            ))
        elif region.type == "side-edge":
            elements.extend(_compute_side_edge(region, image_rect, config.defaults, short_edge, long_edge))
        elif region.type == "side-bar":
            elements.extend(_compute_side_bar(region, image_rect, canvas, config.defaults, short_edge, long_edge))
        elif region.type == "free":
            elements.extend(_compute_free(region, image_rect, config.defaults, short_edge, long_edge))

    return LayoutResult(canvas=canvas, image_rect=image_rect, elements=elements)


def compute_layout_with_diagnostics(config: WatermarkConfig, image_w: int, image_h: int) -> LayoutResultWithDiagnostics:
    """带诊断的布局计算。"""
    layout = compute_layout(config, image_w, image_h)
    diagnostics = diagnose_layout(layout, config)
    return LayoutResultWithDiagnostics(layout=layout, diagnostics=diagnostics)


def diagnose_layout(layout: LayoutResult, _config: WatermarkConfig) -> list[DiagnosticItem]:
    """布局诊断：检测重叠、越界、空内容、缺资源。"""
    diagnostics: list[DiagnosticItem] = []
    canvas = layout.canvas
    elements = layout.elements

    # 1. 重叠
    for i in range(len(elements)):
        for j in range(i + 1, len(elements)):
            a = elements[i]
            b = elements[j]
            if _rects_overlap(a.rect, b.rect):
                diagnostics.append(DiagnosticItem(
                    id=f"overlap-{a.id}-{b.id}",
                    type="overlap",
                    severity="error",
                    message=f"{a.id} 与 {b.id} 重叠",
                    element_ids=[a.id, b.id],
                ))

    # 2. 越界
    for el in elements:
        if (
            el.rect.x < 0
            or el.rect.y < 0
            or el.rect.right > canvas.w
            or el.rect.bottom > canvas.h
        ):
            diagnostics.append(DiagnosticItem(
                id=f"oob-{el.id}",
                type="out-of-bounds",
                severity="error",
                message=f"{el.id} 越出画布",
                element_ids=[el.id],
            ))

    # 3. 空内容 / 缺资源
    for el in elements:
        if el.type == "text":
            if isinstance(el.content, TextContent):
                non_empty = any(c.field_id != "empty" for c in el.content.chips)
                if not non_empty:
                    diagnostics.append(DiagnosticItem(
                        id=f"empty-{el.id}",
                        type="empty-enabled-slot",
                        severity="warning",
                        message=f"{el.id} 已启用但没有字段",
                        element_ids=[el.id],
                    ))
        elif el.type == "signature" and isinstance(el.content, SignatureContent) and el.content.path == "":
            diagnostics.append(DiagnosticItem(
                id=f"missing-sig-{el.id}",
                type="missing-resource",
                severity="warning",
                message=f"{el.id} 未上传签名",
                element_ids=[el.id],
            ))

    present_region_ids = {el.id.split("-", 1)[0] for el in elements}
    for region in _config.regions:
        if region.enabled and region.id not in present_region_ids:
            diagnostics.append(DiagnosticItem(
                id=f"empty-region-{region.id}",
                type="empty-region",
                severity="warning",
                message=f"{region.id} 区域未生成任何元素",
                element_ids=[],
            ))

    # 4. 字号过大
    for el in elements:
        if el.type == "text" and el.style.font_size is not None and el.style.font_size > el.rect.h:
            diagnostics.append(DiagnosticItem(
                id=f"font-large-{el.id}",
                type="font-too-large",
                severity="warning",
                message=f"{el.id} 字号超过 slot 高度",
                element_ids=[el.id],
            ))

    return diagnostics


def _rects_overlap(a: Rect, b: Rect) -> bool:
    return not (
        a.right <= b.x
        or a.x >= b.right
        or a.bottom <= b.y
        or a.y >= b.bottom
    )


# ── 各区域类型计算 ─────────────────────────────────

_FLOW_SLOT_ORDER = ("primary-start", "primary-end", "secondary-start", "secondary-end", "asset")


def _normalize_flow_slots(slots: dict[str, SlotConfig]) -> dict[str, SlotConfig]:
    if any(slot_id in slots for slot_id in _FLOW_SLOT_ORDER):
        return slots
    legacy = {
        "left-top": "primary-start", "right-top": "primary-end",
        "left-bottom": "secondary-start", "right-bottom": "secondary-end",
        "left-logo": "asset", "center": "asset", "right-logo": "asset",
    }
    normalized: dict[str, SlotConfig] = {}
    for slot_id, slot in slots.items():
        target = legacy.get(slot_id, slot_id)
        if target != "asset" or target not in normalized or slot_id == "right-logo":
            normalized[target] = slot
    return normalized


def _flow_config(region: RegionConfig) -> FlowLayoutConfig:
    return region.layout or FlowLayoutConfig()


def _resolve_width(value: dict[str, float | int | str], short_edge: int) -> int:
    if value.get("mode") == "pixel":
        return round(float(value.get("value", 0)))
    return round(short_edge * float(value.get("value", 0)))


def _active_flow_slots(region: RegionConfig) -> dict[str, SlotConfig]:
    slots = _normalize_flow_slots(region.slots)
    if _flow_config(region).mode == "dual-track":
        return slots
    return {slot_id: slot for slot_id, slot in slots.items() if not slot_id.startswith("secondary-")}


def _compute_footer_bar(
    region: RegionConfig,
    image_rect: Rect,
    canvas: Size,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
    _footer_mode: Literal["dual-row", "single-row"],
) -> list[ComputedElement]:
    bounds = Rect(x=0, y=image_rect.bottom, w=canvas.w, h=canvas.h - image_rect.bottom)
    return _compute_flow_region(region, bounds, defaults, short_edge, long_edge, "horizontal")


def _resolve_side_width(region: RegionConfig, short_edge: int) -> int:
    if not region.width:
        return max(40, round(short_edge * 0.12))
    if region.width.get("mode") == "pixel":
        return max(1, round(float(region.width["value"])))
    return max(40, round(short_edge * float(region.width["value"])))


def _compute_side_bar(
    region: RegionConfig,
    image_rect: Rect,
    canvas: Size,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
) -> list[ComputedElement]:
    if region.edge == "left":
        bounds = Rect(x=0, y=0, w=image_rect.x, h=canvas.h)
    else:
        bounds = Rect(x=image_rect.right, y=0, w=canvas.w - image_rect.right, h=canvas.h)
    return _compute_flow_region(region, bounds, defaults, short_edge, long_edge, "vertical")


def _compute_flow_region(
    region: RegionConfig,
    bounds: Rect,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
    flow: Literal["horizontal", "vertical"],
) -> list[ComputedElement]:
    layout = _flow_config(region)
    slots = _active_flow_slots(region)
    base = bounds.h if flow == "horizontal" else bounds.w
    padding = region.padding or {}
    pad_top = int(padding.get("top", max(6, round(base * 0.14))))
    pad_right = int(padding.get("right", max(8, round(base * 0.14))))
    pad_bottom = int(padding.get("bottom", max(6, round(base * 0.14))))
    pad_left = int(padding.get("left", max(8, round(base * 0.14))))
    inner = Rect(
        x=bounds.x + pad_left, y=bounds.y + pad_top,
        w=max(1, bounds.w - pad_left - pad_right),
        h=max(1, bounds.h - pad_top - pad_bottom),
    )
    track_gap = max(0, _resolve_width(layout.track_gap, short_edge))
    item_gap = max(0, _resolve_width(layout.item_gap, short_edge))
    ratios = (1.0, 0.0) if layout.mode == "single-track" else layout.track_ratios
    cross_size = inner.h if flow == "horizontal" else inner.w
    primary_size = max(1, round((cross_size - (track_gap if layout.mode == "dual-track" else 0)) * ratios[0]))
    secondary_size = max(1, cross_size - primary_size - (track_gap if layout.mode == "dual-track" else 0))
    primary_first = layout.track_order == "photo-outward"
    if flow == "horizontal":
        first_y = inner.y
        second_y = inner.y + (primary_size if primary_first else secondary_size) + track_gap
        primary = Rect(inner.x, first_y if primary_first else second_y, inner.w, primary_size)
        secondary = Rect(inner.x, second_y if primary_first else first_y, inner.w, secondary_size)
    else:
        photo_is_left = region.edge != "left"
        primary_on_left = photo_is_left if layout.track_order == "photo-outward" else not photo_is_left
        first_x = inner.x
        second_x = inner.x + (primary_size if primary_on_left else secondary_size) + track_gap
        primary = Rect(first_x if primary_on_left else second_x, inner.y, primary_size, inner.h)
        secondary = Rect(second_x if primary_on_left else first_x, inner.y, secondary_size, inner.h)
    track_rects = {"primary": primary, "secondary": secondary}
    elements: list[ComputedElement] = []
    for track_name in ("primary", "secondary"):
        if track_name == "secondary" and layout.mode == "single-track":
            continue
        track = track_rects[track_name]
        for endpoint in ("start", "end"):
            slot_id = f"{track_name}-{endpoint}"
            slot = slots.get(slot_id)
            if slot is None or not slot.enabled or slot.content is None:
                continue
            style = _merge_style(defaults, slot.style)
            ref = bounds.h if flow == "horizontal" else bounds.w
            font_size = _resolve_font_size(style, ref, short_edge, long_edge)
            if flow == "horizontal":
                anchor = "middle-left" if endpoint == "start" else "middle-right"
                slot_bounds = Rect(
                    x=track.x if endpoint == "start" else track.x + track.w // 2 + item_gap,
                    y=track.y, w=max(1, track.w // 2 - item_gap), h=track.h,
                )
            else:
                anchor = "top-center" if endpoint == "start" else "bottom-center"
                slot_bounds = Rect(
                    x=track.x,
                    y=track.y if endpoint == "start" else track.y + track.h // 2 + item_gap,
                    w=track.w, h=max(1, track.h // 2 - item_gap),
                )
            pos = _apply_anchor(slot_bounds, anchor)
            if isinstance(slot.content, TextContent) and slot.content.chips:
                elements.append(ComputedElement(
                    id=f"{region.id}-{slot_id}", type="text",
                    rect=Rect(pos.x, pos.y, slot_bounds.w, slot_bounds.h),
                    anchor=anchor, content=slot.content, style=_with_font_size(style, font_size),
                ))
    asset = slots.get("asset")
    if asset is not None and asset.enabled and isinstance(asset.content, LogoContent):
        size_ref = bounds.h if flow == "horizontal" else bounds.w
        logo_h = _resolve_logo_size(asset.content, size_ref)
        pos = _apply_anchor(inner, "middle-center")
        elements.append(ComputedElement(
            id=f"{region.id}-asset", type="logo",
            rect=Rect(pos.x, pos.y, min(inner.w, logo_h * 3), logo_h),
            anchor="middle-center", content=asset.content, style=defaults,
        ))
    return elements


def _compute_side_edge(
    region: RegionConfig,
    image_rect: Rect,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
) -> list[ComputedElement]:
    """图片主体垂直边缘：单行文本垂直堆叠。"""

    region_w = _resolve_side_width(region, short_edge)

    if region.edge == "left":
        region_bounds = Rect(
            x=image_rect.x,
            y=image_rect.y,
            w=region_w,
            h=image_rect.h,
        )
    else:  # right
        region_bounds = Rect(
            x=image_rect.right - region_w,
            y=image_rect.y,
            w=region_w,
            h=image_rect.h,
        )

    padding = region.padding or {}
    pad_top = int(padding.get("top", 8))
    pad_right = int(padding.get("right", 8))
    pad_bottom = int(padding.get("bottom", 8))
    pad_left = int(padding.get("left", 8))
    elements: list[ComputedElement] = []
    cursor_y = region_bounds.y + pad_top

    if region.slots:
        for slot_id, slot in region.slots.items():
            if not slot.enabled or slot.content is None:
                continue

            style = _merge_style(defaults, slot.style)
            font_size = _resolve_font_size(style, region_bounds.h, short_edge, long_edge)

            if isinstance(slot.content, TextContent) and slot.content.chips:
                line_h = round(font_size * style.line_height)
                if region.vertical_alignment == "start":
                    start_y = cursor_y
                    cursor_y += line_h
                elif region.vertical_alignment == "end":
                    start_y = region_bounds.bottom - pad_bottom - line_h
                else:
                    start_y = region_bounds.y + (region_bounds.h - line_h) // 2

                if region.alignment == "start":
                    x = region_bounds.x + pad_left
                    anchor = "middle-left"
                elif region.alignment == "end":
                    x = region_bounds.right - pad_right
                    anchor = "middle-right"
                else:
                    x = region_bounds.center_x
                    anchor = "middle-center"

                elements.append(ComputedElement(
                    id=f"{region.id}-{slot_id}",
                    type="text",
                    rect=Rect(x=x, y=start_y, w=max(1, region_bounds.w - pad_left - pad_right), h=line_h),
                    anchor=anchor,
                    content=slot.content,
                    style=_with_font_size(style, font_size),
                ))

    return elements


def _compute_free(
    region: RegionConfig,
    image_rect: Rect,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
) -> list[ComputedElement]:
    """自由定位区域（签名等）。"""

    elements: list[ComputedElement] = []

    anchor = region.anchor or "middle-center"
    anchor_x = image_rect.x + image_rect.w * _anchor_col(anchor)
    anchor_y = image_rect.y + image_rect.h * _anchor_row(anchor)

    offset_unit = short_edge if region.offset_unit == "short_edge_ratio" else 1
    final_x = anchor_x + round(region.offset_x * offset_unit)
    final_y = anchor_y + round(region.offset_y * offset_unit)

    for slot_id, slot in region.slots.items():
        if not slot.enabled or slot.content is None:
            continue

        style = _merge_style(defaults, slot.style)

        if isinstance(slot.content, SignatureContent):
            if slot.content.size_level is not None:
                sig_ratio = _SIGNATURE_SIZE_LEVEL_RATIOS.get(slot.content.size_level, 0.20)
            elif slot.content.size_ratio is not None:
                sig_ratio = slot.content.size_ratio
            else:
                sig_ratio = 0.20
            sig_h = round(short_edge * sig_ratio)
            elements.append(ComputedElement(
                id=f"{region.id}-{slot_id}",
                type="signature",
                rect=Rect(x=final_x, y=final_y, w=sig_h, h=sig_h),
                anchor=anchor,
                content=slot.content,
                style=style,
            ))

    return elements


# ── 辅助函数 ─────────────────────────────────

_FONT_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.18,
    "medium": 0.23,
    "large": 0.25,
}
_LOGO_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.50,
    "medium": 0.60,
    "large": 0.72,
}
_SIGNATURE_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.15,
    "medium": 0.20,
    "large": 0.25,
}
_BORDER_WIDTH_RATIOS: dict[str, float] = {
    "small": 0.0075,
    "medium": 0.0165,
    "large": 0.022,
}


def _resolve_font_size(
    style: StyleConfig,
    full_region_height: int,
    short_edge: int,
    long_edge: int,
) -> int:
    """解析字号。

    font_size_level 映射到 token 比例（small=0.125, medium=0.16, large=0.20），
    按 size_reference 基准计算绝对字号。
    优先顺序：font_size > font_size_ratio > font_size_level。
    """
    if style.font_size is not None and style.font_size > 0:
        return style.font_size

    if style.font_size_ratio is not None:
        ratio = style.font_size_ratio
    elif style.font_size_level is not None:
        ratio = _FONT_SIZE_LEVEL_RATIOS.get(style.font_size_level, 0.23)
    else:
        ratio = 0.23

    if style.size_reference == "short_edge":
        ref = short_edge
    elif style.size_reference == "long_edge":
        ref = long_edge
    else:
        ref = full_region_height

    return max(8, round(ref * ratio))


def _resolve_logo_size(content: LogoContent, region_height: int) -> int:
    """Logo 高度 = 所在区域高度 * size_ratio，随底栏/水印条高度缩放。

    支持 size_level 映射（small=0.50, medium=0.60, large=0.72）。
    """
    if content.size_level is not None:
        ratio = _LOGO_SIZE_LEVEL_RATIOS.get(content.size_level, 0.60)
    elif content.size_ratio is not None:
        ratio = content.size_ratio
    else:
        ratio = 0.6
    return max(16, round(region_height * ratio))


def _merge_style(defaults: StyleConfig, override: StyleConfig | None) -> StyleConfig:
    """合并默认样式和覆盖样式。"""
    if override is None:
        return StyleConfig(
            font_size=defaults.font_size,
            font_size_ratio=defaults.font_size_ratio,
            font_size_level=defaults.font_size_level,
            size_reference=defaults.size_reference,
            color=defaults.color,
            font_family=defaults.font_family,
            bold=defaults.bold,
            line_height=defaults.line_height,
            text_direction=defaults.text_direction,
        )
    return StyleConfig(
        font_size=override.font_size if override.font_size is not None else defaults.font_size,
        font_size_ratio=override.font_size_ratio if override.font_size_ratio is not None else defaults.font_size_ratio,
        font_size_level=override.font_size_level if override.font_size_level is not None else defaults.font_size_level,
        size_reference=override.size_reference or defaults.size_reference,
        color=override.color or defaults.color,
        font_family=override.font_family or defaults.font_family,
        bold=override.bold,
        line_height=override.line_height or defaults.line_height,
        text_direction=override.text_direction or defaults.text_direction,
    )


def _with_font_size(style: StyleConfig, font_size: int) -> StyleConfig:
    """返回一个 font_size 已解析的 StyleConfig 副本。"""
    return StyleConfig(
        font_size=font_size,
        font_size_ratio=None,
        font_size_level=None,
        size_reference=style.size_reference,
        color=style.color,
        font_family=style.font_family,
        bold=style.bold,
        line_height=style.line_height,
        text_direction=style.text_direction,
    )


def _anchor_col(anchor: str) -> float:
    """九宫格锚点的列比例（0=左, 0.5=中, 1=右）。"""
    if "left" in anchor:
        return 0.0
    if "right" in anchor:
        return 1.0
    return 0.5


def _anchor_row(anchor: str) -> float:
    """九宫格锚点的行比例（0=上, 0.5=中, 1=下）。"""
    if "top" in anchor:
        return 0.0
    if "bottom" in anchor:
        return 1.0
    return 0.5


def _apply_anchor(bounds: Rect, anchor: str) -> Point:
    """根据 anchor 将 bounds 的参考点映射到绝对坐标。

    anchor 语义（CSS transform-origin 风格）：
      top-left:     (x, y)       是元素左上角
      top-center:   (x, y)       是元素上边中点
      middle-left:  (x, y)       是元素左边中点
      middle-center:(x, y)       是元素中心
      ...
    """
    ax = bounds.x
    if "center" in anchor or "right" in anchor:
        ax = bounds.center_x if "center" in anchor else bounds.right

    ay = bounds.y
    if "middle" in anchor or "bottom" in anchor:
        ay = bounds.center_y if "middle" in anchor else bounds.bottom

    return Point(x=ax, y=ay)


def _footer_slot_anchor(slot_id: str, footer_mode: Literal["dual-row", "single-row"]) -> str:
    """footer-bar 各文本槽位的锚点。"""
    if footer_mode == "single-row":
        if slot_id == "left-top":
            return "middle-left"
        if slot_id == "right-top":
            return "middle-right"
    mapping = {
        "left-logo": "middle-left",
        "left-top": "top-left",
        "left-bottom": "bottom-left",
        "center": "middle-center",
        "right-top": "top-right",
        "right-bottom": "bottom-right",
        "right-logo": "middle-right",
    }
    return mapping.get(slot_id, "middle-center")


def _footer_logo_anchor(slot_id: str) -> str:
    if slot_id == "left-logo":
        return "middle-left"
    if slot_id == "right-logo":
        return "middle-right"
    return "middle-center"


def _compute_footer_slots(
    region_bounds: Rect,
    slots: dict[str, SlotConfig],
    footer_mode: Literal["dual-row", "single-row"],
) -> dict[str, Rect]:
    """以底栏边界为基准计算四角文本和 Logo 的稳定槽位。"""
    results: dict[str, Rect] = {}

    pad_x = max(12, round(region_bounds.h * 0.28))
    pad_y = max(6, round(region_bounds.h * 0.14))
    center_gap = max(12, round(region_bounds.h * 0.22))
    logo_reserve = max(48, round(region_bounds.h * 2.05))
    left_logo_enabled = bool(
        slots.get("left-logo")
        and slots["left-logo"].enabled
        and slots["left-logo"].content is not None
    )
    right_logo_enabled = bool(
        slots.get("right-logo")
        and slots["right-logo"].enabled
        and slots["right-logo"].content is not None
    )

    inner_left = region_bounds.x + pad_x
    inner_right = region_bounds.right - pad_x
    text_left = inner_left + (logo_reserve if left_logo_enabled else 0)
    text_right = inner_right - (logo_reserve if right_logo_enabled else 0)
    middle = (text_left + text_right) // 2
    row_h = max(1, (region_bounds.h - pad_y * 2) // 2)
    left_w = max(0, middle - center_gap - text_left)
    right_x = middle + center_gap
    right_w = max(0, text_right - right_x)

    results["left-logo"] = Rect(inner_left, region_bounds.y + pad_y, logo_reserve, region_bounds.h - pad_y * 2)
    results["right-logo"] = Rect(inner_right - logo_reserve, region_bounds.y + pad_y, logo_reserve, region_bounds.h - pad_y * 2)
    results["center"] = Rect((inner_left + inner_right - logo_reserve) // 2, region_bounds.y + pad_y, logo_reserve, region_bounds.h - pad_y * 2)
    results["left-top"] = Rect(text_left, region_bounds.y + pad_y, left_w, row_h)
    results["left-bottom"] = Rect(text_left, region_bounds.bottom - pad_y - row_h, left_w, row_h)
    results["right-top"] = Rect(right_x, region_bounds.y + pad_y, right_w, row_h)
    results["right-bottom"] = Rect(right_x, region_bounds.bottom - pad_y - row_h, right_w, row_h)

    if footer_mode == "single-row":
        full_h = region_bounds.h - pad_y * 2
        results["left-top"] = Rect(text_left, region_bounds.y + pad_y, left_w, full_h)
        results["right-top"] = Rect(right_x, region_bounds.y + pad_y, right_w, full_h)

    return results
