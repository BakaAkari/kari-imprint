"""Tests for processor.renderer — backend PIL renderer."""

from __future__ import annotations

import pytest
from PIL import Image

from kari_core.processor import renderer
from kari_core.processor.renderer import (
    _anchor_to_paste_offset,
    _build_text,
    _parse_color,
    _resolve_auto_logo_path,
    _resolve_field_value,
    render_pil,
)
from kari_core.shared.layout.layout_engine import (
    BorderConfig,
    CanvasConfig,
    FieldChip,
    ImprintConfig,
    LogoContent,
    MarginsConfig,
    SignatureContent,
    SlotConfig,
    StyleConfig,
    TextContent,
    compute_layout,
)


class TestHelpers:
    """单元测试：独立辅助函数。"""

    def test_missing_requested_font_preserves_cjk_and_size(self):
        font = renderer._load_font("missing-watermark-font.otf", 96)
        assert font.size == 96
        assert font.getbbox("水印")[2] > 100

    def test_unreadable_fonts_fail_instead_of_publishing_tiny_text(self, monkeypatch):
        def unreadable(*args, **kwargs):
            raise OSError("cannot open resource")

        monkeypatch.setattr(renderer.ImageFont, "truetype", unreadable)
        with pytest.raises(OSError, match="watermark_font_unavailable"):
            renderer._load_font("NotoSansCJKsc-Bold.otf", 96)

    def test_parse_color_hex6(self):
        assert _parse_color("#FF5733") == (255, 87, 51, 255)

    def test_parse_color_hex8(self):
        assert _parse_color("#FF5733CC") == (255, 87, 51, 204)

    def test_parse_color_no_hash(self):
        assert _parse_color("FFFFFF") == (255, 255, 255, 255)

    def test_resolve_field_value(self):
        assert _resolve_field_value("make", {"make": "Sony"}, "") == "Sony"
        assert _resolve_field_value("empty", {"make": "Sony"}, "") == ""
        assert _resolve_field_value("custom_text", {}, "AKARI") == "AKARI"
        assert _resolve_field_value("custom_text", {}, "") == ""
        assert _resolve_field_value("missing", {}, "") == ""

    def test_build_text(self):
        content = TextContent(
            chips=[
                FieldChip(field_id="make"),
                FieldChip(field_id="camera_model"),
            ],
            separator=" ",
        )
        assert _build_text(content, {"make": "Sony", "camera_model": "A7M4"}, "") == "Sony A7M4"

    def test_builtin_logo_resolution_supports_non_png_and_missing_assets(self, tmp_path, monkeypatch):
        logos_dir = tmp_path / "logos"
        logos_dir.mkdir()
        Image.new("RGB", (32, 16), (255, 0, 0)).save(logos_dir / "DJI.jpg")
        monkeypatch.setattr(renderer, "LOGOS_DIR", logos_dir)

        resolved = _resolve_auto_logo_path(LogoContent(path="builtin:DJI"), {})
        assert resolved is not None
        assert resolved.endswith("DJI.jpg")

        monkeypatch.setattr(renderer, "LOGOS_DIR", tmp_path / "missing")
        assert _resolve_auto_logo_path(LogoContent(path="builtin:DJI"), {}) is None
        assert _resolve_auto_logo_path(LogoContent(path=""), {"make": "DJI"}) is None

    def test_build_text_with_empty_chip(self):
        content = TextContent(
            chips=[
                FieldChip(field_id="make"),
                FieldChip(field_id="empty"),
                FieldChip(field_id="camera_model"),
            ],
            separator=" / ",
        )
        assert _build_text(content, {"make": "Sony", "camera_model": "A7M4"}, "") == "Sony / A7M4"

    def test_anchor_to_paste_offset_top_left(self):
        assert _anchor_to_paste_offset("top-left", 100, 50) == (0, 0)

    def test_anchor_to_paste_offset_middle_center(self):
        dx, dy = _anchor_to_paste_offset("middle-center", 100, 50)
        assert dx == -50
        assert dy == -25

    def test_anchor_to_paste_offset_bottom_right(self):
        assert _anchor_to_paste_offset("bottom-right", 100, 50) == (-100, -50)


class TestRenderPil:
    """集成测试：render_pil 主入口。"""

    def test_free_signature_with_fractional_ratio_offsets(self, tmp_path):
        from kari_core.processor.kari_imprint import _dict_to_imprint_config

        signature = tmp_path / "signature.png"
        Image.new("RGBA", (240, 80), (0, 0, 0, 255)).save(signature)
        config = _dict_to_imprint_config({
            "schema_version": 3,
            "regions": [{
                "id": "signature", "type": "free", "enabled": True,
                "anchor": "bottom-right", "offset_x": -0.02, "offset_y": -0.02,
                "offset_unit": "short_edge_ratio",
                "slots": {"sig1": {"enabled": True, "content": {
                    "path": str(signature), "invert_mono": False, "size_level": "small",
                }}},
            }],
        })
        layout = compute_layout(config, 961, 962)
        result = render_pil(layout, Image.new("RGB", (961, 962), "white"))
        assert result.size == (961, 962)
        assert result.convert("RGB").getextrema() == ((0, 255), (0, 255), (0, 255))

    def _make_test_image(self, w: int = 800, h: int = 600) -> Image.Image:
        return Image.new("RGB", (w, h), (128, 128, 128))

    def _make_minimal_config(self) -> ImprintConfig:
        return ImprintConfig(
            canvas=CanvasConfig(
                margins=MarginsConfig(top=0, right=0, bottom=0, left=0),
                background="#FFFFFF",
            ),
            regions=[],
            defaults=StyleConfig(
                font_size=20,
                font_size_ratio=None,
                size_reference="region_height",
                color="#222222",
                font_family="NotoSansCJKsc-Bold.otf",
                bold=True,
                line_height=1.2,
            ),
        )

    def test_render_pil_no_regions(self):
        """无边框区域时，输出应与原图一致（画布尺寸相同）。"""
        img = self._make_test_image(400, 300)
        config = self._make_minimal_config()
        layout = compute_layout(config, 400, 300)

        result = render_pil(layout, img)

        assert result.size == (400, 300)
        assert result.mode == "RGBA"


    def test_render_pil_with_decorative_border(self):
        """render_pil draws configured border margins before pasting the image."""
        img = self._make_test_image(40, 30)
        config = self._make_minimal_config()
        config.canvas.margins = MarginsConfig(top=4, right=5, bottom=6, left=7)
        config.canvas.border = BorderConfig(enabled=True, width_level="small", color="#112233")
        layout = compute_layout(config, 40, 30)

        result = render_pil(layout, img, bg_color=config.canvas.background, config=config)

        assert result.size == (52, 40)
        assert result.getpixel((1, 1)) == (17, 34, 51, 255)
        assert result.getpixel((7, 4)) == (128, 128, 128, 255)

    def test_render_pil_with_footer_bar(self):
        """底部栏包含文本时，画布应扩展，文本应被渲染。"""
        img = self._make_test_image(800, 600)
        config = self._make_minimal_config()
        config.canvas.margins = MarginsConfig(top=0, right=0, bottom=80, left=0)
        config.regions = [
            {
                "id": "footer",
                "type": "footer-bar",
                "enabled": True,
                "slots": {
                    "primary-start": SlotConfig(
                        enabled=True,
                        content=TextContent(
                            chips=[FieldChip(field_id="make")],
                            separator=" ",
                        ),
                        style=StyleConfig(
                            font_size=24,
                            font_size_ratio=None,
                            size_reference="region_height",
                            color="#222222",
                            font_family="NotoSansCJKsc-Bold.otf",
                            bold=True,
                            line_height=1.2,
                        ),
                    ),
                },
            }
        ]
        # compute_layout 接受 RegionConfig 对象，不是 dict；需要正确构造
        from kari_core.shared.layout.layout_engine import RegionConfig

        config.regions = [
            RegionConfig(
                id="footer",
                type="footer-bar",
                enabled=True,
                slots={
                    "primary-start": SlotConfig(
                        enabled=True,
                        content=TextContent(
                            chips=[FieldChip(field_id="make")],
                            separator=" ",
                        ),
                        style=StyleConfig(
                            font_size=24,
                            font_size_ratio=None,
                            size_reference="region_height",
                            color="#222222",
                            font_family="NotoSansCJKsc-Bold.otf",
                            bold=True,
                            line_height=1.2,
                        ),
                    ),
                },
            )
        ]

        layout = compute_layout(config, 800, 600)
        field_values = {"make": "Sony"}

        result = render_pil(layout, img, field_values=field_values)

        # 画布高度 = 原图高 + bottom margin
        assert result.size == (800, 680)
        assert result.mode == "RGBA"

    def test_render_pil_field_values_passed_correctly(self):
        """验证 field_values 能正确传递到文本渲染。"""
        img = self._make_test_image(400, 300)
        config = self._make_minimal_config()
        from kari_core.shared.layout.layout_engine import RegionConfig

        config.canvas.margins = MarginsConfig(top=0, right=0, bottom=60, left=0)
        config.regions = [
            RegionConfig(
                id="footer",
                type="footer-bar",
                enabled=True,
                slots={
                    "primary-start": SlotConfig(
                        enabled=True,
                        content=TextContent(
                            chips=[FieldChip(field_id="focal_length")],
                            separator=" ",
                        ),
                        style=StyleConfig(
                            font_size=18,
                            font_size_ratio=None,
                            size_reference="region_height",
                            color="#333333",
                            font_family="NotoSansCJKsc-Bold.otf",
                            bold=True,
                            line_height=1.2,
                        ),
                    ),
                },
            )
        ]

        layout = compute_layout(config, 400, 300)
        result = render_pil(layout, img, field_values={"focal_length": "35mm"})

        assert result.size == (400, 360)

    def test_render_pil_custom_text(self):
        """验证 custom_text 能被正确解析。"""
        img = self._make_test_image(400, 300)
        config = self._make_minimal_config()
        from kari_core.shared.layout.layout_engine import RegionConfig

        config.canvas.margins = MarginsConfig(top=0, right=0, bottom=60, left=0)
        config.regions = [
            RegionConfig(
                id="footer",
                type="footer-bar",
                enabled=True,
                slots={
                    "primary-start": SlotConfig(
                        enabled=True,
                        content=TextContent(
                            chips=[FieldChip(field_id="custom_text")],
                            separator=" ",
                        ),
                        style=StyleConfig(
                            font_size=20,
                            font_size_ratio=None,
                            size_reference="region_height",
                            color="#222222",
                            font_family="NotoSansCJKsc-Bold.otf",
                            bold=True,
                            line_height=1.2,
                        ),
                    ),
                },
            )
        ]

        layout = compute_layout(config, 400, 300)
        result = render_pil(layout, img, custom_text="AKARI PHOTO")

        assert result.size == (400, 360)

    def test_render_pil_signature(self):
        """签名元素应被渲染（无实际签名文件时返回 None，不抛错）。"""
        img = self._make_test_image(400, 300)
        config = self._make_minimal_config()
        from kari_core.shared.layout.layout_engine import RegionConfig

        config.regions = [
            RegionConfig(
                id="sig",
                type="free",
                enabled=True,
                anchor="bottom-right",
                offset_x=-0.05,
                offset_y=-0.05,
                offset_unit="short_edge_ratio",
                slots={
                    "sig1": SlotConfig(
                        enabled=True,
                        content=SignatureContent(
                            path="nonexistent.png",
                            invert_mono=False,
                            size_ratio=0.15,
                        ),
                        style=None,
                    ),
                },
            )
        ]

        layout = compute_layout(config, 400, 300)
        result = render_pil(layout, img)

        assert result.size == (400, 300)


class TestEffectiveFontFamily:
    """Output measures and draws with the same weight the browser preview uses."""

    def test_bold_flag_selects_noto_weight(self):
        regular = StyleConfig(font_family="NotoSansCJKsc-Bold.otf", bold=False)
        bold = StyleConfig(font_family="NotoSansCJKsc-Regular.otf", bold=True)
        assert renderer.effective_font_family(regular) == "NotoSansCJKsc-Regular.otf"
        assert renderer.effective_font_family(bold) == "NotoSansCJKsc-Bold.otf"

    def test_other_fonts_are_untouched(self):
        assert renderer.effective_font_family(StyleConfig(font_family="Custom.ttf", bold=True)) == "Custom.ttf"

    def test_measurement_follows_bold_flag(self):
        cache = renderer._FontCache()
        text = "ILCE-7RM5 FE 24-70mm F2.8 GM II"

        class El:
            def __init__(self, bold):
                self.style = StyleConfig(font_family="NotoSansCJKsc-Bold.otf", bold=bold)

        assert cache.measure(El(False), text, 40) < cache.measure(El(True), text, 40)


class TestBuildTextDedup:
    """Make + model on one line never repeats the vendor; empty fields add no separator."""

    @staticmethod
    def _content(*ids):
        return TextContent(chips=[FieldChip(field_id=i) for i in ids], separator=" ")

    def test_make_dropped_when_model_starts_with_it(self):
        values = {"make": "Canon", "camera_model": "Canon EOS R5"}
        assert _build_text(self._content("make", "camera_model"), values, "") == "Canon EOS R5"

    def test_make_kept_when_model_does_not_repeat_it(self):
        values = {"make": "Apple", "camera_model": "iPhone 15 Pro Max"}
        assert _build_text(self._content("make", "camera_model"), values, "") == "Apple iPhone 15 Pro Max"

    def test_make_kept_without_model_chip(self):
        values = {"make": "Canon", "camera_model": "Canon EOS R5"}
        assert _build_text(self._content("make", "lens_model"), values, "") == "Canon"

    def test_empty_values_add_no_separator(self):
        values = {"focal_length": "35mm", "aperture": "", "iso": "ISO 100"}
        assert _build_text(self._content("focal_length", "aperture", "iso"), values, "") == "35mm ISO 100"
