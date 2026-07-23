from typing import Literal

from PIL import Image

from kari_core.processor.v3_renderer import _render_text_element, render_pil
from kari_core.shared.v3_layout.layout_engine import (
    CanvasConfig,
    ComputedElement,
    FieldChip,
    FlowLayoutConfig,
    LogoContent,
    MarginsConfig,
    Rect,
    RegionConfig,
    SlotConfig,
    StyleConfig,
    TextContent,
    WatermarkConfig,
    compute_layout,
)


def _text_slot(direction: str = "horizontal") -> SlotConfig:
    return SlotConfig(
        enabled=True,
        content=TextContent(chips=[FieldChip(field_id="make")]),
        style=StyleConfig(font_size=20, text_direction=direction),
    )


def test_right_side_bar_expands_canvas_and_rotates_default_text():
    config = WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig()),
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge="right",
            width={"mode": "pixel", "value": 120},
            slots={"primary-start": _text_slot("rotate-cw")},
        )],
    )
    result = compute_layout(config, 800, 600)
    assert result.canvas.w == 920
    assert result.image_rect.x == 0
    assert result.elements[0].rect.x > 800
    assert result.elements[0].style.text_direction == "rotate-cw"


def test_left_side_bar_moves_image_and_rotates_counterclockwise():
    config = WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig()),
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge="left",
            width={"mode": "short_edge_ratio", "value": 0.1},
            slots={"primary-start": _text_slot("rotate-ccw")},
        )],
    )
    result = compute_layout(config, 800, 600)
    assert result.canvas.w == 860
    assert result.image_rect.x == 60
    assert result.elements[0].rect.x < 60
    assert result.elements[0].style.text_direction == "rotate-ccw"


def test_side_bar_keeps_explicit_horizontal_direction():
    config = WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig()),
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge="right",
            width={"mode": "pixel", "value": 100},
            slots={"primary-start": _text_slot("horizontal")},
        )],
    )
    result = compute_layout(config, 800, 600)
    assert result.elements[0].style.text_direction == "horizontal"


def test_region_orientation_resolves_by_edge_and_slot_override_wins():
    auto = WatermarkConfig(
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge="right",
            width={"mode": "pixel", "value": 100},
            text_orientation="rotate-with-edge",
            slots={"primary-start": _text_slot("horizontal")},
        )],
    )
    auto.regions[0].slots["primary-start"].style.text_direction = None
    result = compute_layout(auto, 800, 600)
    assert result.elements[0].style.text_direction == "rotate-cw"

    auto.regions[0].edge = "left"
    result = compute_layout(auto, 800, 600)
    assert result.elements[0].style.text_direction == "rotate-ccw"

    auto.regions[0].slots["primary-start"].style.text_direction = "vertical-glyphs"
    result = compute_layout(auto, 800, 600)
    assert result.elements[0].style.text_direction == "vertical-glyphs"


def test_rotated_text_is_fitted_and_clipped_to_side_slot():
    base = dict(
        id="text", type="text", rect=Rect(0, 0, 100, 40),
        anchor="middle-center",
        content=TextContent(chips=[FieldChip(field_id="make")]),
    )
    rotated = _render_text_element(
        ComputedElement(**base, style=StyleConfig(font_size=20, text_direction="rotate-cw")),
        {"make": "VERY LONG CAMERA MODEL NAME"}, "",
    )
    vertical = _render_text_element(
        ComputedElement(**base, style=StyleConfig(font_size=20, text_direction="vertical-glyphs")),
        {"make": "ABCD"}, "",
    )
    assert rotated.size == (100, 40)
    assert rotated.getbbox() is not None
    assert vertical.height > vertical.width


def test_rotated_text_keeps_top_and_bottom_endpoint_alignment():
    def element(anchor: Literal["top-center", "bottom-center"]) -> ComputedElement:
        return ComputedElement(
            id="text", type="text", rect=Rect(0, 0, 100, 80), anchor=anchor,
            content=TextContent(chips=[FieldChip(field_id="make")]),
            style=StyleConfig(font_size=16, text_direction="rotate-cw"),
        )

    top = _render_text_element(element("top-center"), {"make": "ABCD"}, "")
    bottom = _render_text_element(element("bottom-center"), {"make": "ABCD"}, "")
    top_box = top.getbbox()
    bottom_box = bottom.getbbox()
    assert top_box is not None and top_box[1] <= 1
    assert bottom_box is not None and bottom.height - bottom_box[3] <= 1


def _dual_side_config(
    edge: Literal["left", "right"],
    logo_placement: Literal["start", "center", "end"] = "end",
) -> WatermarkConfig:
    return WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig()),
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge=edge,
            width={"mode": "pixel", "value": 120},
            layout=FlowLayoutConfig(mode="dual-track"),
            slots={
                "primary-start": _text_slot(),
                "primary-end": _text_slot(),
                "secondary-start": _text_slot(),
                "secondary-end": _text_slot(),
                "asset": SlotConfig(
                    enabled=True,
                    content=LogoContent(path="logo.png", placement=logo_placement),
                ),
            },
        )],
    )


def test_side_bar_rotates_footer_quadrants_around_bottom_corner():
    right = {el.id: el for el in compute_layout(_dual_side_config("right"), 800, 600).elements}
    assert right["side-primary-start"].anchor == "top-center"
    assert right["side-secondary-start"].anchor == "top-center"
    assert right["side-primary-end"].anchor == "bottom-center"
    assert right["side-secondary-end"].anchor == "bottom-center"
    # Primary (former upper row) is outer; secondary is adjacent to the photo.
    assert right["side-primary-start"].rect.x > right["side-secondary-start"].rect.x

    left = {el.id: el for el in compute_layout(_dual_side_config("left"), 800, 600).elements}
    assert left["side-primary-end"].anchor == "top-center"
    assert left["side-secondary-end"].anchor == "top-center"
    assert left["side-primary-start"].anchor == "bottom-center"
    assert left["side-secondary-start"].anchor == "bottom-center"
    assert left["side-primary-start"].rect.x < left["side-secondary-start"].rect.x


def test_side_logo_positions_are_physical_and_push_text_away():
    top = {el.id: el for el in compute_layout(_dual_side_config("left", "start"), 800, 600).elements}
    center = {el.id: el for el in compute_layout(_dual_side_config("left", "center"), 800, 600).elements}
    bottom = {el.id: el for el in compute_layout(_dual_side_config("left", "end"), 800, 600).elements}

    assert top["side-asset"].anchor == "top-center"
    assert center["side-asset"].anchor == "middle-center"
    assert bottom["side-asset"].anchor == "bottom-center"
    # Left-side top content comes from footer end slots; it is shortened by a top Logo.
    assert top["side-primary-end"].rect.h < bottom["side-primary-end"].rect.h
    # Center Logo opens a gap and shortens both halves.
    assert center["side-primary-end"].rect.h < bottom["side-primary-end"].rect.h
    assert center["side-primary-start"].rect.h < top["side-primary-start"].rect.h


def test_side_bar_is_rendered_outside_photo_area():
    config = WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig(), background="#FFFFFF"),
        regions=[RegionConfig(
            id="side", type="side-bar", enabled=True, edge="right",
            width={"mode": "pixel", "value": 100},
            slots={"primary-start": _text_slot("vertical-glyphs")},
        )],
    )
    layout = compute_layout(config, 200, 120)
    result = render_pil(
        layout, Image.new("RGB", (200, 120), "#808080"),
        field_values={"make": "ABCD"}, config=config,
    )
    assert result.size == (300, 120)
    assert result.getpixel((10, 10))[:3] == (128, 128, 128)
    assert result.getpixel((250, 10))[:3] == (255, 255, 255)
