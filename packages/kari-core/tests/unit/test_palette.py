"""Photo palette extraction and colour references."""

import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from kari_core.shared.layout.compose import resolve_color
from kari_core.shared.palette import PALETTE_FIELDS, extract_palette, palette_fields, palette_fields_for_path

CASES = json.loads((Path(__file__).parents[1] / "fixtures" / "color_ref_cases.json").read_text(encoding="utf-8"))


def _photo(w=1200, h=800):
    img = Image.new("RGB", (w, h), (30, 60, 120))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, h // 2, w, h], fill=(200, 150, 60))
    draw.rectangle([0, 0, w // 6, h // 6], fill=(240, 240, 240))
    return img


def test_palette_is_six_hex_colours_most_populous_first():
    colours = extract_palette(_photo())
    assert len(colours) == 6 and all(c.startswith("#") and len(c) == 7 for c in colours)
    assert {colours[0], colours[1]} == {"#1E3C78", "#C8963C"}


def test_palette_is_deterministic_and_size_independent():
    assert extract_palette(_photo()) == extract_palette(_photo())
    assert extract_palette(_photo(3000, 2000))[:2] == extract_palette(_photo(600, 400))[:2]


def test_palette_fields_and_unreadable_files(tmp_path):
    assert list(palette_fields(_photo())) == list(PALETTE_FIELDS)
    broken = tmp_path / "broken.jpg"
    broken.write_bytes(b"not an image")
    assert palette_fields_for_path(broken) == {}


@pytest.mark.parametrize("case", CASES, ids=[c["color"] for c in CASES])
def test_colour_references(case):
    assert resolve_color(case["color"], case["fields"]) == case["expected"]
