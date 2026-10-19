"""Regression tests for the Imprint v2 rendering fixes (text fit, logo, scheme, effect)."""

from __future__ import annotations

from copy import deepcopy

import pytest
from PIL import Image

from kari_core.processor import renderer
from kari_core.processor.effects import compose_background, photo_radius_px
from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.processor.renderer import render_pil, resolve_logo_slots
from kari_core.shared.layout.layout_engine import (
    ComputedElement,
    EffectConfig,
    FieldChip,
    Rect,
    StyleConfig,
    TextContent,
    compute_layout,
    is_dark_background,
    resolve_ink_scheme,
)
from kari_core.shared.layout.text_fit import ELLIPSIS, fit_layout_texts, fit_single

STYLE = {
    "font_size": None, "font_size_level": "medium", "font_size_ratio": None,
    "size_reference": "region_height", "color": "#222222",
    "font_family": "NotoSansCJKsc-Bold.otf", "bold": True, "line_height": 1.2, "text_direction": None,
}


def classic(edge: str | None = None, *, background: str = "#FFFFFF", effect: dict | None = None) -> dict:
    region: dict = {
        "id": "footer", "type": "footer-bar", "enabled": True, "height": 0.15,
        "layout": {"mode": "dual-track", "track_ratios": [0.6, 0.4],
                   "track_gap": {"mode": "short_edge_ratio", "value": 0.012},
                   "item_gap": {"mode": "short_edge_ratio", "value": 0.012}},
        "slots": {
            "primary-start": {"enabled": True, "style": dict(STYLE),
                              "content": {"chips": [{"field_id": "camera_model"}, {"field_id": "lens_model"}], "separator": " "}},
            "secondary-start": {"enabled": True, "style": {**STYLE, "font_family": "NotoSansCJKsc-Regular.otf", "bold": False},
                                "content": {"chips": [{"field_id": "focal_length"}, {"field_id": "aperture"}], "separator": " "}},
            "asset": {"enabled": True, "style": None,
                      "content": {"path": "", "size_level": "medium", "orientation": "upright", "placement": "end", "track": "span"}},
        },
    }
    if edge:
        region.update(type="side-bar", edge=edge, width={"mode": "short_edge_ratio", "value": 0.15})
        region.pop("height")
    canvas: dict = {"margins": {"top": 40, "right": 40, "bottom": 0 if not edge else 40, "left": 40}, "background": background}
    if edge == "left":
        canvas["margins"]["left"] = 0
    elif edge == "right":
        canvas["margins"]["right"] = 0
    if effect is not None:
        canvas["effect"] = effect
    return {"schema_version": 3, "canvas": canvas, "regions": [region], "defaults": dict(STYLE), "custom_text": ""}


def measure_chars(_el, text: str, size: int) -> float:
    return len(text) * size * 0.6


# ── text fit ───────────────────────────────────────────────────────────


def test_fit_single_shrinks_then_truncates_with_ellipsis():
    measure = lambda text, size: len(text) * size * 0.6  # noqa: E731
    assert fit_single("ABCD", 10, 100, measure).font_size == 10
    shrunk = fit_single("A" * 20, 100, 1100, measure)
    assert shrunk.text == "A" * 20 and 80 <= shrunk.font_size < 100
    truncated = fit_single("A" * 40, 100, 1100, measure)
    assert truncated.font_size == 80
    assert truncated.text.endswith(ELLIPSIS)
    assert measure(truncated.text, truncated.font_size) <= 1100


def test_secondary_never_exceeds_primary_scale():
    style = StyleConfig(font_size=100)
    primary = ComputedElement("f-primary-start", "text", Rect(0, 0, 1000, 120), "middle-left",
                              TextContent(chips=[FieldChip("make")]), style)
    secondary = ComputedElement("f-secondary-start", "text", Rect(0, 130, 1000, 80), "middle-left",
                                TextContent(chips=[FieldChip("iso")]), style)
    fitted = fit_layout_texts([primary, secondary], {primary.id: "X" * 40, secondary.id: "ISO 100"}, measure_chars)
    assert fitted[primary.id].font_size == 80
    assert fitted[secondary.id].font_size <= fitted[primary.id].font_size


# ── layout ─────────────────────────────────────────────────────────────


def _layout(config: dict, w: int, h: int, field_values: dict, aspect_override: float | None = None):
    cfg = _dict_to_imprint_config(deepcopy(config))
    aspect = resolve_logo_slots(cfg, field_values)
    return compute_layout(cfg, w, h, aspect_override if aspect_override is not None else aspect), cfg


def test_unrecognized_brand_disables_logo_and_divider():
    layout, cfg = _layout(classic(), 6000, 4000, {"make": "samsung", "camera_model": "SM-S9280"})
    assert not cfg.regions[0].slots["asset"].enabled
    assert {el.type for el in layout.elements} == {"text"}
    start = next(el for el in layout.elements if el.id == "footer-primary-start")
    # The start slot owns the whole track instead of half of it.
    assert start.rect.w > 0.9 * 6000


def test_no_exif_make_disables_logo():
    layout, _cfg = _layout(classic(), 1200, 800, {})
    assert not any(el.type in {"logo", "divider"} for el in layout.elements)


def test_divider_gap_is_symmetric_and_logo_stays_inside_padding():
    layout, _cfg = _layout(classic(), 6000, 4000, {"make": "Canon"})
    by_id = {el.id: el for el in layout.elements}
    text = by_id["footer-primary-start"]
    divider = by_id["footer-divider"]
    logo = by_id["footer-asset"]
    text_right = text.rect.x + text.rect.w
    logo_left = logo.rect.x - logo.rect.w  # anchor middle-right
    gap_text = divider.rect.x - text_right
    gap_logo = logo_left - (divider.rect.x + divider.rect.w)
    assert gap_text == gap_logo > 0
    bar_top = layout.image_rect.bottom
    bar_h = layout.canvas.h - bar_top
    logo_top = logo.rect.y - logo.rect.h // 2
    assert logo_top >= bar_top + round(bar_h * 0.14) - 1
    assert logo.rect.h <= round(bar_h * 0.45)


def test_tiny_image_dual_track_lines_do_not_overlap():
    layout, _cfg = _layout(classic(), 120, 80, {"camera_model": "X", "focal_length": "35mm"})
    primary = next(el for el in layout.elements if el.id == "footer-primary-start")
    secondary = next(el for el in layout.elements if el.id == "footer-secondary-start")
    assert primary.style.font_size <= primary.rect.h
    assert secondary.style.font_size <= secondary.rect.h
    assert primary.rect.y + primary.style.font_size / 2 <= secondary.rect.y - secondary.style.font_size / 2 + 1


@pytest.mark.parametrize(("background", "dark"), [("#FFFFFF", False), ("#2B2B2B", True), ("#141414", True),
                                                   ("#808080", False), ("#1A1A1A", True), ("#F2E8D5", False)])
def test_background_luminance_scheme(background, dark):
    assert is_dark_background(background) is dark
    assert resolve_ink_scheme(background) == ("light" if dark else "dark")


def test_dark_background_switches_default_ink_only():
    config = classic(background="#2B2B2B")
    config["regions"][0]["slots"]["secondary-start"]["style"]["color"] = "#FF0000"
    layout, _cfg = _layout(config, 3000, 2000, {"make": "Canon", "camera_model": "EOS R5"})
    by_id = {el.id: el for el in layout.elements}
    assert by_id["footer-primary-start"].style.color == "#F5F5F5"
    assert by_id["footer-secondary-start"].style.color == "#FF0000"
    assert by_id["footer-divider"].style.color == "#F5F5F5"
    assert resolve_ink_scheme("#FFFFFF", EffectConfig(background="blur")) == "light"


# ── renderer ───────────────────────────────────────────────────────────


def _render(config: dict, image: Image.Image, field_values: dict) -> Image.Image:
    cfg = _dict_to_imprint_config(deepcopy(config))
    aspect = resolve_logo_slots(cfg, field_values)
    layout = compute_layout(cfg, image.width, image.height, aspect)
    return render_pil(layout, image, bg_color=cfg.canvas.background, field_values=field_values, config=cfg)


def test_long_horizontal_text_never_crosses_divider_or_canvas():
    fields = {"make": "Apple", "camera_model": "iPhone 15 Pro Max",
              "lens_model": "iPhone 15 Pro Max back triple camera 6.765mm f/1.78", "focal_length": "24mm", "aperture": "f/1.8"}
    config = classic()
    cfg = _dict_to_imprint_config(deepcopy(config))
    aspect = resolve_logo_slots(cfg, fields)
    layout = compute_layout(cfg, 3024, 4032, aspect)
    out = render_pil(layout, Image.new("RGB", (3024, 4032), (90, 140, 200)), field_values=fields, config=cfg)
    divider = next(el for el in layout.elements if el.type == "divider")
    bar = out.crop((0, layout.image_rect.bottom, divider.rect.x, out.height)).convert("L")
    # Ink exists left of the divider, but the column right before it stays clean.
    assert bar.getextrema()[0] < 128
    gap = out.crop((divider.rect.x - 8, layout.image_rect.bottom, divider.rect.x, out.height)).convert("L")
    assert gap.getextrema()[0] > 240


def test_divider_is_blended_and_exact_width():
    fields = {"make": "Canon", "camera_model": "EOS R5", "focal_length": "35mm"}
    cfg = _dict_to_imprint_config(deepcopy(classic()))
    layout = compute_layout(cfg, 6000, 4000, resolve_logo_slots(cfg, fields))
    out = render_pil(layout, Image.new("RGB", (6000, 4000), "white"), field_values=fields, config=cfg)
    divider = next(el for el in layout.elements if el.type == "divider")
    cy = divider.rect.y + divider.rect.h // 2
    inside = out.getpixel((divider.rect.x, cy))
    assert 190 <= inside[0] <= 205  # #222222 at 25% over white ≈ 200, not opaque 34
    assert out.getpixel((divider.rect.x + divider.rect.w, cy))[:3] == (255, 255, 255)


def test_small_builtin_logo_is_upscaled_to_slot(tmp_path, monkeypatch):
    logos = tmp_path / "logos"
    logos.mkdir()
    mark = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
    mark.paste((200, 0, 0, 255), (10, 10, 40, 40))
    mark.save(logos / "tiny.png")
    monkeypatch.setattr(renderer, "LOGOS_DIR", logos)
    el = ComputedElement("f-asset", "logo", Rect(0, 0, 200, 120), "middle-left",
                         renderer.LogoContent(path="builtin:tiny"), StyleConfig())
    rendered = renderer._render_logo_element(el, {})
    assert rendered is not None and rendered.size == (120, 120)
    assert renderer.logo_visible_aspect_ratio(str(logos / "tiny.png")) == pytest.approx(1.0)


def test_dark_background_inverts_mono_logo_and_mattes_white_box(tmp_path, monkeypatch):
    logos = tmp_path / "logos"
    logos.mkdir()
    boxed = Image.new("RGB", (60, 30), "white")
    boxed.paste((0, 0, 0), (10, 10, 50, 20))
    boxed.save(logos / "boxed.png")
    monkeypatch.setattr(renderer, "LOGOS_DIR", logos)
    el = ComputedElement("f-asset", "logo", Rect(0, 0, 80, 20), "middle-left",
                         renderer.LogoContent(path="builtin:boxed"), StyleConfig())
    rendered = renderer._render_logo_element(el, {}, scheme="light")
    assert rendered is not None
    r, g, b, a = rendered.getpixel((rendered.width // 2, rendered.height // 2))
    assert a > 200 and min(r, g, b) > 200  # black ink became white
    assert renderer._render_logo_element(el, {}, scheme="dark").getpixel((1, 1))[:3] == (0, 0, 0)


def test_noop_effect_renders_byte_identical():
    fields = {"make": "Canon", "camera_model": "EOS R5"}
    image = Image.new("RGB", (600, 400), (90, 140, 200))
    plain = _render(classic(), image, fields)
    noop = _render(classic(effect={"background": "solid", "photo_radius": 0, "shadow": False}), image, fields)
    assert plain.tobytes() == noop.tobytes()


def test_blur_effect_with_radius_and_shadow():
    fields = {"make": "Canon", "camera_model": "EOS R5"}
    image = Image.new("RGB", (600, 400), (220, 30, 30))
    image.paste((30, 60, 220), (300, 0, 600, 400))
    config = classic(effect={"background": "blur", "photo_radius": 0.05, "shadow": True})
    out = _render(config, image, fields).convert("RGB")
    corner = out.getpixel((40, 40))  # photo's rounded top-left corner shows background
    assert corner != (220, 30, 30)
    background = out.getpixel((5, 5))
    assert background != (255, 255, 255) and max(background) < 200  # blurred + darkened photo
    assert out.getpixel((300 + 40, 200 + 40)) == (30, 60, 220)
    cfg = _dict_to_imprint_config(deepcopy(config))
    assert photo_radius_px(cfg.canvas.effect, Rect(0, 0, 600, 400)) == 20


def test_effect_background_never_blurs_at_full_resolution(monkeypatch):
    from PIL import ImageFilter

    seen: list[tuple[int, int]] = []
    original = Image.Image.filter

    def spy(self, flt):
        if isinstance(flt, ImageFilter.GaussianBlur):
            seen.append(self.size)
        return original(self, flt)

    monkeypatch.setattr(Image.Image, "filter", spy)
    photo = Image.new("RGB", (4000, 3000), (10, 20, 30))
    canvas = compose_background((4200, 3600), photo, Rect(100, 100, 4000, 3000), (255, 255, 255, 255),
                                EffectConfig(background="blur", photo_radius=0.02, shadow=True))
    assert canvas.size == (4200, 3600)
    assert seen and all(max(size) <= 1200 for size in seen)
