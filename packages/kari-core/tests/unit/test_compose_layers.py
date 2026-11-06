"""Construction layers: geometry lowering and PIL painting of draw ops."""

import json
from pathlib import Path

from PIL import Image

from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.processor.renderer import render_pil
from kari_core.shared.layout.compose import BEVEL_LIGHT_PERCENT, BEVEL_SHADE_PERCENT, shift_color
from kari_core.shared.layout.layout_engine import compute_layout

CASES = {c["id"]: c for c in json.loads((Path(__file__).parents[1] / "fixtures" / "compose_cases.json").read_text(encoding="utf-8"))}


def _layout(case_id: str):
    case = CASES[case_id]
    config = _dict_to_imprint_config(case["config"])
    return config, compute_layout(config, *case["image"])


def test_ratio_margins_scale_with_the_short_edge():
    _, layout = _layout("double-mat-bevel-drop")
    # 0.12 / 0.155 of a 2000 px short edge; the weighted bottom is the "drop".
    assert (layout.image_rect.x, layout.image_rect.y) == (240, 240)
    assert layout.canvas.h - layout.image_rect.y - layout.image_rect.h == 310


def test_mat_reveal_and_bevel_core_wrap_the_photo():
    _, layout = _layout("double-mat-bevel-drop")
    ops = {op.id: op for op in layout.ops}
    photo = layout.image_rect
    core_top = ops["mat-core-top"]
    assert core_top.rect.y + core_top.rect.h == photo.y
    assert core_top.color == shift_color("#FBFAF6", BEVEL_LIGHT_PERCENT)
    assert ops["mat-core-bottom"].color == shift_color("#FBFAF6", -BEVEL_SHADE_PERCENT)
    reveal_top = ops["mat-reveal-top"]
    assert reveal_top.rect.y + reveal_top.rect.h == core_top.rect.y
    assert all(op.z == "under" for op in layout.ops)


def test_shift_color_is_integer_and_clamped():
    assert shift_color("#000000", 100) == "#FFFFFF"
    assert shift_color("#FFFFFF", -100) == "#000000"
    assert shift_color("#808080", 0) == "#808080"
    assert shift_color("not-a-colour", 20) == "not-a-colour"


def test_text_layer_becomes_a_text_element():
    _, layout = _layout("double-mat-bevel-drop")
    caption = next(el for el in layout.elements if el.id == "caption")
    assert caption.type == "text"
    assert caption.style.font_size == 32
    assert caption.style.color == "#55504A"


def test_render_paints_ops_under_and_over_the_photo():
    config, layout = _layout("footer-with-rule-and-overlay")
    photo = Image.new("RGB", (1200, 800), (200, 200, 200))
    out = render_pil(layout, photo, bg_color=config.canvas.background, field_values={"camera_model": "X"}, config=config)
    ops = {op.id: op for op in layout.ops}
    # Opaque "under" rule in the footer margin.
    hair = ops["hair"].rect
    assert out.getpixel((hair.x + 5, hair.y))[:3] == (0x22, 0x22, 0x22)
    # Translucent "over" veil darkens the photo: 200 * (1 - 0.35) ≈ 130.
    veil = ops["veil"].rect
    r, g, b, _ = out.getpixel((veil.x + veil.w // 2, veil.y + veil.h // 2))
    assert 125 <= r <= 135 and r == g == b
    # Outside the veil the photo is untouched.
    assert out.getpixel((layout.image_rect.x + 2, layout.image_rect.y + 2))[:3] == (200, 200, 200)


def test_configs_without_layers_have_no_ops():
    config = _dict_to_imprint_config({"canvas": {"margins": {"top": 10, "right": 10, "bottom": 10, "left": 10}}, "regions": []})
    assert compute_layout(config, 400, 300).ops == []
