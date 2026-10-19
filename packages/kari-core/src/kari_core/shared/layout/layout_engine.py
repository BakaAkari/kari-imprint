"""Region-Based Layout Engine — 纯函数布局计算。

此模块不包含任何 PIL/Canvas 依赖，只负责：
  - 输入：ImprintConfig + image_w/h
  - 输出：LayoutResult（每个元素在画布上的绝对位置和尺寸）

前后端共享同一套算法逻辑，通过单元测试保证一致性。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
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
class EffectConfig:
    """Optional canvas effect; the default value is a no-op (solid background)."""

    background: Literal["solid", "blur"] = "solid"
    photo_radius: float = 0.0  # ratio of the photo short edge, 0..0.08
    shadow: bool = False

    @property
    def is_noop(self) -> bool:
        return self.background == "solid" and self.photo_radius <= 0 and not self.shadow


@dataclass(slots=True)
class CanvasConfig:
    margins: MarginsConfig = field(default_factory=MarginsConfig)
    background: str = "#FFFFFF"
    border_radius: int = 0
    border: BorderConfig | None = None
    effect: EffectConfig | None = None


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
    path: str = ""  # 空表示 auto
    size_ratio: float | None = None  # 精确比例；为空时由 size_level 决定
    size_level: str | None = "medium"  # 'small' | 'medium' | 'large'
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
    track_gap: dict[str, float | int | str] = field(
        default_factory=lambda: {"mode": "short_edge_ratio", "value": 0.012}
    )
    item_gap: dict[str, float | int | str] = field(default_factory=lambda: {"mode": "short_edge_ratio", "value": 0.012})
    track_ratios: tuple[float, float] = (0.6, 0.4)


@dataclass(slots=True)
class RegionConfig:
    id: str = ""
    type: str = ""  # 'footer-bar' | 'side-bar' | 'free'
    enabled: bool = False
    # footer-bar 特有
    slots: dict[str, SlotConfig] = field(default_factory=dict)
    height: float | None = None  # 占图片短边的比例，由布局引擎解析为实际像素高度
    # side-bar 特有
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
class ImprintConfig:
    canvas: CanvasConfig = field(default_factory=CanvasConfig)
    regions: list[RegionConfig] = field(default_factory=list)
    defaults: StyleConfig = field(default_factory=StyleConfig)
    custom_text: str = ""


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


# ── 配色方案（背景亮度 → 墨色）─────────────────────

# The single "auto" text color: slots that keep it follow the background.
DEFAULT_TEXT_COLOR = "#222222"
# WCAG relative luminance below which light ink reads better than dark ink
# (≈ the equal-contrast point between #000 and #FFF).
DARK_BACKGROUND_LUMINANCE = 0.18
_INK_COLORS: dict[str, dict[str, str]] = {
    # 'dark' ink: light backgrounds
    "dark": {"primary": "#222222", "secondary": "#7A7A7A", "divider": "#222222"},
    # 'light' ink: dark backgrounds / blurred photo backgrounds
    "light": {"primary": "#F5F5F5", "secondary": "#A3A3A3", "divider": "#F5F5F5"},
}
DIVIDER_OPACITY = 0.25


def relative_luminance(color: str) -> float | None:
    """WCAG relative luminance of ``#RRGGBB``; ``None`` for unparsable input."""
    text = color.strip().lstrip("#")
    if len(text) not in (6, 8) or any(c not in "0123456789abcdefABCDEF" for c in text):
        return None

    def channel(value: int) -> float:
        c = value / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (int(text[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def is_dark_background(color: str) -> bool:
    luminance = relative_luminance(color)
    return luminance is not None and luminance < DARK_BACKGROUND_LUMINANCE


def resolve_ink_scheme(background: str, effect: EffectConfig | None = None) -> str:
    """'dark' ink for light backgrounds, 'light' ink for dark or blurred ones."""
    if effect is not None and effect.background == "blur":
        return "light"
    return "light" if is_dark_background(background) else "dark"


def divider_color(scheme: str) -> str:
    return _INK_COLORS.get(scheme, _INK_COLORS["dark"])["divider"]


def _resolve_text_color(color: str, track: str, scheme: str) -> str:
    """Only the default color adapts; an explicit user color is respected."""
    if (color or "").upper() != DEFAULT_TEXT_COLOR:
        return color
    return _INK_COLORS.get(scheme, _INK_COLORS["dark"])["secondary" if track == "secondary" else "primary"]


# ── 布局引擎 ─────────────────────────────────

_DEFAULT_ASSET_ASPECT_RATIO = 3.0
_ASSET_ASPECT_RATIO_MIN = 0.3
_ASSET_ASPECT_RATIO_MAX = 6.0


def _resolve_asset_aspect_ratio(asset_aspect_ratio: float | None) -> float:
    """Clamp caller-provided aspect ratio; fall back to the legacy 3.0 constant when unset."""
    if asset_aspect_ratio is None:
        return _DEFAULT_ASSET_ASPECT_RATIO
    if asset_aspect_ratio <= 0:
        return _DEFAULT_ASSET_ASPECT_RATIO
    return max(_ASSET_ASPECT_RATIO_MIN, min(_ASSET_ASPECT_RATIO_MAX, float(asset_aspect_ratio)))


def compute_layout(
    config: ImprintConfig,
    image_w: int,
    image_h: int,
    asset_aspect_ratio: float | None = None,
) -> LayoutResult:
    """主入口：计算每个边框元素在画布上的绝对位置和尺寸。

    ``asset_aspect_ratio`` 是即将渲染的 Logo 图片的宽/高比。传入后会替换
    logo 占位盒子在横向布局下 ``height × 3`` 的硬编码常量，让占位宽度按
    真实图片比例伸缩。取值被 clamp 到 ``[0.3, 6.0]``；``None`` 或非正数
    回退到旧常量 ``3.0`` 以保持向后兼容。
    """

    aspect = _resolve_asset_aspect_ratio(asset_aspect_ratio)

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

    scheme = resolve_ink_scheme(config.canvas.background, config.canvas.effect)
    elements: list[ComputedElement] = []
    for region in config.regions:
        if not region.enabled:
            continue

        if region.type == "footer-bar":
            elements.extend(
                _compute_footer_bar(
                    region,
                    image_rect,
                    canvas,
                    config.defaults,
                    short_edge,
                    long_edge,
                    aspect,
                    scheme,
                )
            )
        elif region.type == "side-bar":
            elements.extend(
                _compute_side_bar(
                    region,
                    image_rect,
                    canvas,
                    config.defaults,
                    short_edge,
                    long_edge,
                    aspect,
                    scheme,
                )
            )
        elif region.type == "free":
            elements.extend(_compute_free(region, image_rect, config.defaults, short_edge, long_edge))

    return LayoutResult(canvas=canvas, image_rect=image_rect, elements=elements)


def compute_layout_with_diagnostics(
    config: ImprintConfig,
    image_w: int,
    image_h: int,
    asset_aspect_ratio: float | None = None,
) -> LayoutResultWithDiagnostics:
    """带诊断的布局计算。"""
    layout = compute_layout(config, image_w, image_h, asset_aspect_ratio)
    diagnostics = diagnose_layout(layout, config)
    return LayoutResultWithDiagnostics(layout=layout, diagnostics=diagnostics)


def diagnose_layout(layout: LayoutResult, _config: ImprintConfig) -> list[DiagnosticItem]:
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
                diagnostics.append(
                    DiagnosticItem(
                        id=f"overlap-{a.id}-{b.id}",
                        type="overlap",
                        severity="error",
                        message=f"{a.id} 与 {b.id} 重叠",
                        element_ids=[a.id, b.id],
                    )
                )

    # 2. 越界
    for el in elements:
        if el.rect.x < 0 or el.rect.y < 0 or el.rect.right > canvas.w or el.rect.bottom > canvas.h:
            diagnostics.append(
                DiagnosticItem(
                    id=f"oob-{el.id}",
                    type="out-of-bounds",
                    severity="error",
                    message=f"{el.id} 越出画布",
                    element_ids=[el.id],
                )
            )

    # 3. 空内容 / 缺资源
    for el in elements:
        if el.type == "text":
            if isinstance(el.content, TextContent):
                non_empty = any(c.field_id != "empty" for c in el.content.chips)
                if not non_empty:
                    diagnostics.append(
                        DiagnosticItem(
                            id=f"empty-{el.id}",
                            type="empty-enabled-slot",
                            severity="warning",
                            message=f"{el.id} 已启用但没有字段",
                            element_ids=[el.id],
                        )
                    )
        elif el.type == "signature" and isinstance(el.content, SignatureContent) and el.content.path == "":
            diagnostics.append(
                DiagnosticItem(
                    id=f"missing-sig-{el.id}",
                    type="missing-resource",
                    severity="warning",
                    message=f"{el.id} 未上传签名",
                    element_ids=[el.id],
                )
            )

    present_region_ids = {el.id.split("-", 1)[0] for el in elements}
    for region in _config.regions:
        if region.enabled and region.id not in present_region_ids:
            diagnostics.append(
                DiagnosticItem(
                    id=f"empty-region-{region.id}",
                    type="empty-region",
                    severity="warning",
                    message=f"{region.id} 区域未生成任何元素",
                    element_ids=[],
                )
            )

    # 4. 字号过大
    for el in elements:
        if el.type == "text" and el.style.font_size is not None and el.style.font_size > el.rect.h:
            diagnostics.append(
                DiagnosticItem(
                    id=f"font-large-{el.id}",
                    type="font-too-large",
                    severity="warning",
                    message=f"{el.id} 字号超过 slot 高度",
                    element_ids=[el.id],
                )
            )

    return diagnostics


def _rects_overlap(a: Rect, b: Rect) -> bool:
    return not (a.right <= b.x or a.x >= b.right or a.bottom <= b.y or a.y >= b.bottom)


# ── 各区域类型计算 ─────────────────────────────────

_FLOW_SLOT_ORDER = ("primary-start", "primary-end", "secondary-start", "secondary-end", "asset")


def _flow_config(region: RegionConfig) -> FlowLayoutConfig:
    return region.layout or FlowLayoutConfig()


def _resolve_width(value: dict[str, float | int | str], short_edge: int) -> int:
    if value.get("mode") == "pixel":
        return round(float(value.get("value", 0)))
    return round(short_edge * float(value.get("value", 0)))


def _active_flow_slots(region: RegionConfig) -> dict[str, SlotConfig]:
    slots = region.slots
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
    asset_aspect_ratio: float,
    scheme: str = "dark",
) -> list[ComputedElement]:
    bounds = Rect(x=0, y=image_rect.bottom, w=canvas.w, h=canvas.h - image_rect.bottom)
    return _compute_flow_region(
        region, bounds, defaults, short_edge, long_edge, "horizontal", asset_aspect_ratio, scheme,
    )


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
    asset_aspect_ratio: float,
    scheme: str = "dark",
) -> list[ComputedElement]:
    if region.edge == "left":
        bounds = Rect(x=0, y=0, w=image_rect.x, h=canvas.h)
    else:
        bounds = Rect(x=image_rect.right, y=0, w=canvas.w - image_rect.right, h=canvas.h)
    return _compute_flow_region(
        region, bounds, defaults, short_edge, long_edge, "vertical", asset_aspect_ratio, scheme,
    )


def _side_endpoint(region: RegionConfig, endpoint: str) -> str:
    """Map footer endpoints after rotating around the adjacent bottom corner."""
    if region.type != "side-bar":
        return endpoint
    if region.edge == "left":
        return "end" if endpoint == "start" else "start"
    return endpoint


def _side_placement(_region: RegionConfig, placement: str) -> str:
    """Logo positions are physical top/center/bottom controls in side mode."""
    if placement in {"start", "center"}:
        return placement
    return "end"


def _resolve_text_direction(region: RegionConfig, style: StyleConfig) -> str:
    if style.text_direction:
        return style.text_direction
    policy = region.text_orientation or "auto"
    if policy in {"auto", "rotate-with-edge"}:
        if region.type == "side-bar":
            return "rotate-ccw" if region.edge == "left" else "rotate-cw"
        return "horizontal"
    return policy


def _resolve_asset_orientation(region: RegionConfig, orientation: str) -> str:
    if orientation != "follow-flow":
        return orientation
    if region.type == "side-bar":
        return "rotate-ccw" if region.edge == "left" else "rotate-cw"
    return "upright"


def _text_slot_active(slot: SlotConfig | None) -> bool:
    """A text slot that can produce visible text (enabled, has a non-empty chip)."""
    if slot is None or not slot.enabled or not isinstance(slot.content, TextContent):
        return False
    return any(chip.field_id != "empty" for chip in slot.content.chips)


def _compute_flow_region(
    region: RegionConfig,
    bounds: Rect,
    defaults: StyleConfig,
    short_edge: int,
    long_edge: int,
    flow: Literal["horizontal", "vertical"],
    asset_aspect_ratio: float,
    scheme: str = "dark",
) -> list[ComputedElement]:
    if bounds.w <= 0 or bounds.h <= 0:
        # e.g. a footer-bar without height and without bottom margin.
        return []
    layout = _flow_config(region)
    slots = _active_flow_slots(region)
    base = bounds.h if flow == "horizontal" else bounds.w
    padding = region.padding or {}
    pad_top = int(padding.get("top", max(6, round(base * 0.14))))
    pad_right = int(padding.get("right", max(8, round(base * 0.14))))
    pad_bottom = int(padding.get("bottom", max(6, round(base * 0.14))))
    pad_left = int(padding.get("left", max(8, round(base * 0.14))))
    inner = Rect(
        x=bounds.x + pad_left,
        y=bounds.y + pad_top,
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
        # Rotated-footer semantics: 'photo-outward' puts the primary (former
        # upper) track on the outer edge away from the photo; 'outward-photo'
        # flips it so the primary track sits adjacent to the photo.
        primary_on_outer = layout.track_order == "photo-outward"
        outer_is_left = region.edge == "left"
        primary_on_left = outer_is_left if primary_on_outer else not outer_is_left
        first_x = inner.x
        second_x = inner.x + (primary_size if primary_on_left else secondary_size) + track_gap
        primary = Rect(first_x if primary_on_left else second_x, inner.y, primary_size, inner.h)
        secondary = Rect(second_x if primary_on_left else first_x, inner.y, secondary_size, inner.h)
    track_rects = {"primary": primary, "secondary": secondary}
    elements: list[ComputedElement] = []
    has_text = any(
        _text_slot_active(slots.get(f"{track}-{endpoint}"))
        for track in ("primary", "secondary")
        for endpoint in ("start", "end")
        if not (track == "secondary" and layout.mode == "single-track")
    )

    # 为 Logo/asset 预留空间，避免文字与 logo 重叠
    logo_start_reserve = 0
    logo_center_reserve = 0
    logo_end_reserve = 0
    asset = slots.get("asset")
    # Logo 空间预留由上层（API process / Canvas）在 compute_layout 之前解析
    # auto-logo 后决定：匹配到 → 预留；未匹配 → slot disabled → 不预留、无分隔线。
    has_logo = asset is not None and asset.enabled and isinstance(asset.content, LogoContent)
    logo_h = 0
    logo_box_h = 0
    logo_dim = 0
    physical_placement = "center"
    divider_w = max(1, round(short_edge * 0.001))
    if has_logo:
        assert isinstance(asset.content, LogoContent)
        size_ref = bounds.h if flow == "horizontal" else bounds.w
        # The logo never exceeds the padded content box (cross axis).
        logo_box_h = min(_resolve_logo_size(asset.content, size_ref), cross_size)
        logo_h = _optical_logo_height(logo_box_h, asset_aspect_ratio) if flow == "horizontal" else logo_box_h
        logo_dim = (
            min(inner.w, round(logo_h * asset_aspect_ratio))
            if flow == "horizontal"
            else min(inner.h, round(logo_h / asset_aspect_ratio))
        )
        physical_placement = (
            _side_placement(region, asset.content.placement) if flow == "vertical" else asset.content.placement
        )
        if physical_placement == "end":
            # outer gap · logo · gap · divider · gap · text — the divider sits
            # exactly item_gap away from both the logo and the text.
            logo_end_reserve = logo_dim + divider_w + item_gap * 3
        elif physical_placement == "start":
            logo_start_reserve = logo_dim + divider_w + item_gap * 3
        else:
            logo_center_reserve = logo_dim + item_gap * 2
    has_divider = has_logo and has_text and physical_placement in ("start", "end")

    for track_name in ("primary", "secondary"):
        if track_name == "secondary" and layout.mode == "single-track":
            continue
        track = track_rects[track_name]
        main_origin = track.x if flow == "horizontal" else track.y
        main_size = track.w if flow == "horizontal" else track.h
        other_track = "secondary" if track_name == "primary" else "primary"
        other_track_has_text = layout.mode == "dual-track" and any(
            _text_slot_active(slots.get(f"{other_track}-{endpoint}")) for endpoint in ("start", "end")
        )
        # Lines may only use their own track when the other track has text;
        # otherwise the padded content box is the limit.
        thickness = (track.h if flow == "horizontal" else track.w) if other_track_has_text else cross_size
        paired = {
            endpoint: _text_slot_active(slots.get(f"{track_name}-{endpoint}"))
            for endpoint in ("start", "end")
        }
        for endpoint in ("start", "end"):
            slot_id = f"{track_name}-{endpoint}"
            slot = slots.get(slot_id)
            if slot is None or not slot.enabled or slot.content is None:
                continue
            style = _merge_style(defaults, slot.style)
            style.text_direction = _resolve_text_direction(region, style)
            style.color = _resolve_text_color(style.color, track_name, scheme)
            ref = bounds.h if flow == "horizontal" else bounds.w
            # Clamp to the track thickness so dual-track lines never overlap,
            # even on tiny images where the 8px minimum exceeds the track.
            font_size = min(_resolve_font_size(style, ref, short_edge, long_edge), max(1, thickness))
            physical_endpoint = endpoint if flow == "horizontal" else _side_endpoint(region, endpoint)
            other = "end" if endpoint == "start" else "start"
            if logo_center_reserve > 0:
                half = (main_size - logo_center_reserve) // 2 - item_gap
                if physical_endpoint == "start":
                    seg_start, seg_len = main_origin, max(1, half)
                else:
                    seg_start = main_origin + (main_size + logo_center_reserve) // 2 + item_gap
                    seg_len = max(1, half)
            elif paired[other]:
                if physical_endpoint == "start":
                    seg_start = main_origin + logo_start_reserve
                    seg_len = max(1, main_size // 2 - item_gap - logo_start_reserve)
                else:
                    seg_start = main_origin + main_size // 2 + item_gap
                    seg_len = max(1, main_size // 2 - item_gap - logo_end_reserve)
            else:
                # The paired endpoint is empty: this slot owns the whole track
                # (minus logo/divider reserves) instead of half of it.
                seg_start = main_origin + logo_start_reserve
                seg_len = max(1, main_size - logo_start_reserve - logo_end_reserve)
            if flow == "horizontal":
                anchor = "middle-left" if endpoint == "start" else "middle-right"
                slot_bounds = Rect(seg_start, track.y, seg_len, track.h)
            else:
                anchor = "top-center" if physical_endpoint == "start" else "bottom-center"
                slot_bounds = Rect(track.x, seg_start, track.w, seg_len)
            pos = _apply_anchor(slot_bounds, anchor)
            if isinstance(slot.content, TextContent) and slot.content.chips:
                elements.append(
                    ComputedElement(
                        id=f"{region.id}-{slot_id}",
                        type="text",
                        rect=Rect(pos.x, pos.y, slot_bounds.w, slot_bounds.h),
                        anchor=anchor,
                        content=slot.content,
                        style=_with_font_size(style, font_size),
                    )
                )
    if has_divider:
        empty = TextContent(chips=[], separator="")
        divider_style = _with_color(defaults, divider_color(scheme))
        divider_len = min(cross_size, max(1, round(logo_box_h * 1.1)))
        if flow == "horizontal":
            div_y = inner.y + (inner.h - divider_len) // 2
            if physical_placement == "start":
                div_x = inner.x + item_gap + logo_dim + item_gap
            else:
                div_x = inner.x + inner.w - item_gap - logo_dim - item_gap - divider_w
            divider_rect = Rect(div_x, div_y, divider_w, divider_len)
        else:
            div_x = inner.x + (inner.w - divider_len) // 2
            if physical_placement == "start":
                div_y = inner.y + item_gap + logo_dim + item_gap
            else:
                div_y = inner.y + inner.h - item_gap - logo_dim - item_gap - divider_w
            divider_rect = Rect(div_x, div_y, divider_len, divider_w)
        elements.append(
            ComputedElement(
                id=f"{region.id}-divider",
                type="divider",
                rect=divider_rect,
                anchor="middle-center",
                content=empty,
                style=divider_style,
            )
        )
    if has_logo:
        assert asset is not None and isinstance(asset.content, LogoContent)
        anchor = (
            (
                "middle-left"
                if asset.content.placement == "start"
                else "middle-right"
                if asset.content.placement == "end"
                else "middle-center"
            )
            if flow == "horizontal"
            else (
                "top-center"
                if physical_placement == "start"
                else "bottom-center"
                if physical_placement == "end"
                else "middle-center"
            )
        )
        if flow == "horizontal":
            asset_bounds = (
                Rect(inner.x + item_gap, inner.y, max(1, inner.w - item_gap), inner.h)
                if physical_placement == "start"
                else Rect(inner.x, inner.y, max(1, inner.w - item_gap), inner.h)
                if physical_placement == "end"
                else inner
            )
        else:
            asset_bounds = (
                Rect(inner.x, inner.y + item_gap, inner.w, max(1, inner.h - item_gap))
                if physical_placement == "start"
                else Rect(inner.x, inner.y, inner.w, max(1, inner.h - item_gap))
                if physical_placement == "end"
                else inner
            )
        pos = _apply_anchor(asset_bounds, anchor)
        content = replace(
            asset.content,
            orientation=_resolve_asset_orientation(region, asset.content.orientation),
        )
        if flow == "horizontal":
            asset_w = min(inner.w, round(logo_h * asset_aspect_ratio))
            asset_h = logo_h
        else:
            asset_w = min(inner.w, logo_h)
            asset_h = min(inner.h, round(logo_h / asset_aspect_ratio))
        elements.append(
            ComputedElement(
                id=f"{region.id}-asset",
                type="logo",
                rect=Rect(pos.x, pos.y, asset_w, asset_h),
                anchor=anchor,
                content=content,
                style=defaults,
            )
        )
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
            elements.append(
                ComputedElement(
                    id=f"{region.id}-{slot_id}",
                    type="signature",
                    rect=Rect(x=final_x, y=final_y, w=sig_h, h=sig_h),
                    anchor=anchor,
                    content=slot.content,
                    style=style,
                )
            )

    return elements


# ── 辅助函数 ─────────────────────────────────

_FONT_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.18,
    "medium": 0.23,
    "large": 0.25,
}
# Logo height as a ratio of the bar height. Research (Leica/Xiaomi frames,
# semi-utils): the logo matches the two-line text block, ≈ 40–45% of the bar.
_LOGO_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.36,
    "medium": 0.44,
    "large": 0.54,
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
    """Logo 高度 = 所在区域高度 * size_ratio，随底栏/边框条高度缩放。

    支持 size_level 映射（small=0.36, medium=0.44, large=0.54）。
    """
    if content.size_level is not None:
        ratio = _LOGO_SIZE_LEVEL_RATIOS.get(content.size_level, 0.44)
    elif content.size_ratio is not None:
        ratio = content.size_ratio
    else:
        ratio = 0.44
    return max(16, round(region_height * ratio))


_WIDE_LOGO_ASPECT = 2.5


def _optical_logo_height(box_height: int, aspect: float) -> int:
    """Shrink very wide wordmarks so their visual weight matches compact marks."""
    if aspect <= _WIDE_LOGO_ASPECT:
        return box_height
    return max(1, round(box_height * math.sqrt(_WIDE_LOGO_ASPECT / aspect)))


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


def _with_color(style: StyleConfig, color: str) -> StyleConfig:
    return replace(style, color=color)


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
