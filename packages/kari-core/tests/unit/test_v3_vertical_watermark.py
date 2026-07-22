from PIL import Image

from kari_core.processor.v3_renderer import _render_text_element, render_pil
from kari_core.shared.v3_layout.layout_engine import (
    CanvasConfig,
    ComputedElement,
    FieldChip,
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


def test_rotated_and_vertical_text_render_dimensions():
    base = dict(
        id="text", type="text", rect=Rect(0, 0, 100, 40),
        anchor="middle-center",
        content=TextContent(chips=[FieldChip(field_id="make")]),
    )
    horizontal = _render_text_element(
        ComputedElement(**base, style=StyleConfig(font_size=20, text_direction="horizontal")),
        {"make": "ABCD"}, "",
    )
    rotated = _render_text_element(
        ComputedElement(**base, style=StyleConfig(font_size=20, text_direction="rotate-cw")),
        {"make": "ABCD"}, "",
    )
    vertical = _render_text_element(
        ComputedElement(**base, style=StyleConfig(font_size=20, text_direction="vertical-glyphs")),
        {"make": "ABCD"}, "",
    )
    assert rotated.size == (horizontal.height, horizontal.width)
    assert vertical.height > vertical.width


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
