"""Tests for v3_watermark dict conversion carries new fields and v3_renderer contain."""

from __future__ import annotations

from PIL import Image

from kari_core.processor.v3_renderer import _render_logo_element
from kari_core.shared.v3_layout.layout_engine import (
    ComputedElement,
    LogoContent,
    Rect,
    SignatureContent,
    StyleConfig,
)


class TestDictConversionCarriesNewFields:
    """v3_watermark._dict_to_watermark_config passes through new fields."""

    def test_font_size_level_carried(self):
        from kari_core.processor.v3_watermark import _dict_to_watermark_config

        config = _dict_to_watermark_config({
            "defaults": {"font_size_level": "medium"},
            "regions": [
                {
                    "id": "footer",
                    "type": "footer-bar",
                    "enabled": True,
                    "slots": {
                        "left-top": {
                            "enabled": True,
                            "content": {
                                "chips": [{"field_id": "make"}],
                                "separator": " ",
                            },
                            "style": {"font_size_level": "small"},
                        },
                    },
                }
            ],
        })
        assert config.defaults.font_size_level == "medium"
        slot = config.regions[0].slots["left-top"]
        assert slot.style is not None
        assert slot.style.font_size_level == "small"

    def test_logo_size_level_carried(self):
        from kari_core.processor.v3_watermark import _dict_to_watermark_config

        config = _dict_to_watermark_config({
            "regions": [
                {
                    "id": "footer",
                    "type": "footer-bar",
                    "enabled": True,
                    "slots": {
                        "right-logo": {
                            "enabled": True,
                            "content": {
                                "path": "logo.png",
                                "color": "#D8D8D6",
                                "size_level": "large",
                            },
                        },
                    },
                }
            ],
        })
        slot = config.regions[0].slots["right-logo"]
        assert slot.content is not None
        assert isinstance(slot.content, LogoContent)
        assert slot.content.size_level == "large"
        assert slot.content.size_ratio is None

    def test_signature_size_level_carried(self):
        from kari_core.processor.v3_watermark import _dict_to_watermark_config

        config = _dict_to_watermark_config({
            "regions": [
                {
                    "id": "sig",
                    "type": "free",
                    "enabled": True,
                    "anchor": "bottom-right",
                    "offset_x": -0.05,
                    "offset_y": -0.05,
                    "slots": {
                        "sig1": {
                            "enabled": True,
                            "content": {
                                "path": "sig.png",
                                "invert_mono": False,
                                "size_level": "small",
                            },
                        },
                    },
                }
            ],
        })
        slot = config.regions[0].slots["sig1"]
        assert slot.content is not None
        assert isinstance(slot.content, SignatureContent)
        assert slot.content.size_level == "small"
        assert slot.content.size_ratio is None


class TestRendererLogoContain:
    """v3_renderer logo contain mode (no stretch)."""

    def test_logo_smaller_than_rect_not_upscaled(self):
        """If logo is smaller than target rect, don't upscale."""
        logo_img = Image.new("RGBA", (50, 50), (255, 0, 0, 255))
        # We'll test the render function via a mock approach
        # Save and reload to test
        import tempfile
        from pathlib import Path


        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            logo_img.save(f.name)
            el = ComputedElement(
                id="test-logo",
                type="logo",
                rect=Rect(x=0, y=0, w=200, h=100),
                anchor="middle-left",
                content=LogoContent(path=f.name),
                style=StyleConfig(),
            )
            result = _render_logo_element(el, {})
            assert result is not None
            # Should not upscale — logo stays at 50x50 since it fits within 200x100
            assert result.size == (50, 50)
            Path(f.name).unlink()

    def test_logo_larger_than_rect_scaled_down_contain(self):
        """If logo is larger, scale down preserving aspect ratio (contain)."""
        import tempfile
        from pathlib import Path


        logo_img = Image.new("RGBA", (300, 200), (255, 0, 0, 255))
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            logo_img.save(f.name)
            el = ComputedElement(
                id="test-logo",
                type="logo",
                rect=Rect(x=0, y=0, w=100, h=50),
                anchor="middle-left",
                content=LogoContent(path=f.name),
                style=StyleConfig(),
            )
            result = _render_logo_element(el, {})
            assert result is not None
            # 300x200 to fit in 100x50: scale = min(100/300, 50/200) = min(0.333, 0.25) = 0.25
            # new_w = 300 * 0.25 = 75, new_h = 200 * 0.25 = 50
            assert result.size == (75, 50)
            Path(f.name).unlink()

    def test_logo_wide_vs_tall_contain(self):
        """Very wide logo is constrained by width."""
        import tempfile
        from pathlib import Path

        logo_img = Image.new("RGBA", (600, 50), (255, 0, 0, 255))
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            logo_img.save(f.name)
            el = ComputedElement(
                id="test-logo",
                type="logo",
                rect=Rect(x=0, y=0, w=100, h=100),
                anchor="middle-left",
                content=LogoContent(path=f.name),
                style=StyleConfig(),
            )
            result = _render_logo_element(el, {})
            assert result is not None
            # 600x50 to fit in 100x100: scale = min(100/600, 100/50) = min(0.167, 2.0) = 0.167
            # new_w = 600 * 0.167 = 100, new_h = 50 * 0.167 = 8
            assert result.size == (100, 8)
            Path(f.name).unlink()

    def test_logo_no_path_returns_placeholder(self):
        """Empty logo path produces a transparent placeholder."""
        el = ComputedElement(
            id="test-logo",
            type="logo",
            rect=Rect(x=0, y=0, w=100, h=50),
            anchor="middle-left",
            content=LogoContent(path=""),
            style=StyleConfig(),
        )
        result = _render_logo_element(el, {})
        assert result is not None
        assert result.size == (100, 50)
