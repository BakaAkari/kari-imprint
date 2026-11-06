"""Smoke-render every catalog style through the real PIL pipeline."""

import json
from pathlib import Path

import pytest
from PIL import Image

from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.processor.renderer import render_pil
from kari_core.shared.layout.layout_engine import compute_layout

CATALOG = json.loads((Path(__file__).parents[1] / "fixtures" / "style_catalog.json").read_text(encoding="utf-8"))
FIELDS = {"camera_model": "X-T5", "lens_model": "XF 23mm F1.4", "focal_length": "35mm", "aperture": "f/2.8",
          "shutter": "1/250s", "iso": "ISO 160", "datetime": "2026:11:07 16:40", "make": "FUJIFILM"}


@pytest.mark.parametrize("case", CATALOG, ids=[case["id"] for case in CATALOG])
def test_catalog_style_renders(case):
    w, h = case["image"]
    scale = 4  # render at a quarter size to keep the suite fast; ratios scale with the photo
    config = _dict_to_imprint_config(json.loads(json.dumps(case["config"])))
    layout = compute_layout(config, w // scale, h // scale)
    out = render_pil(layout, Image.new("RGB", (w // scale, h // scale), (120, 130, 140)), bg_color=config.canvas.background,
                     field_values=FIELDS, custom_text="Title", config=config)
    assert out.size == (layout.canvas.w, layout.canvas.h)
    # The photo pixels survive inside the window (unless the style lays film grain over them).
    grained = any(layer.get("kind") == "texture" and layer.get("z") == "over" for layer in case["config"].get("layers") or [])
    centre = (layout.image_rect.x + layout.image_rect.w // 2, layout.image_rect.y + layout.image_rect.h // 2)
    if not grained:
        assert out.getpixel(centre)[:3] == (120, 130, 140)


def test_gallery_mat_draws_the_bevel_core_against_the_photo():
    case = next(c for c in CATALOG if c["id"] == "museum-mat@3000x2000")
    config = _dict_to_imprint_config(json.loads(json.dumps(case["config"])))
    layout = compute_layout(config, 1500, 1000)
    out = render_pil(layout, Image.new("RGB", (1500, 1000), (40, 40, 40)), bg_color=config.canvas.background, config=config)
    ir = layout.image_rect
    above = out.getpixel((ir.x + ir.w // 2, ir.y - 1))[:3]
    below = out.getpixel((ir.x + ir.w // 2, ir.y + ir.h))[:3]
    # Lit top face is brighter than the shaded bottom face of the white core.
    assert sum(above) > sum(below) > 3 * 150
    assert out.getpixel((5, 5))[:3] == (0xF4, 0xF1, 0xEA)
