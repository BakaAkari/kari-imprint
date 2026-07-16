"""Tests for V3 layout engine v2: font_size_level, full region height, logo contain."""

from __future__ import annotations

from kari_core.shared.v3_layout.layout_engine import (
    CanvasConfig,
    FieldChip,
    LogoContent,
    MarginsConfig,
    RegionConfig,
    SignatureContent,
    SlotConfig,
    StyleConfig,
    TextContent,
    WatermarkConfig,
    compute_layout,
)


def _make_chip() -> FieldChip:
    return FieldChip(field_id="make")


class TestFontSizeLevel:
    """font_size_level resolves to correct token ratios."""

    def test_level_small(self):
        """small = 0.125 of full region height."""
        style = StyleConfig(font_size_level="small")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.1,
                        slots={
                            "left-top": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # full region height = 1080 * 0.1 = 108 (min 20) = 108px
        # small ratio = 0.125 → 108 * 0.125 = 13.5 → max(8, 14) = 14
        assert el.style.font_size == 14

    def test_level_medium(self):
        """medium = 0.16 of full region height."""
        style = StyleConfig(font_size_level="medium")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.1,
                        slots={
                            "left-top": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # 108 * 0.16 = 17.28 → max(8, 17) = 17
        assert el.style.font_size == 17

    def test_level_large(self):
        """large = 0.20 of full region height."""
        style = StyleConfig(font_size_level="large")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.1,
                        slots={
                            "left-top": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # 108 * 0.20 = 21.6 → max(8, 22) = 22
        assert el.style.font_size == 22


class TestFooterRegionHeight:
    """_resolve_font_size uses full footer region height, not slot height."""

    def test_uses_full_region_height(self):
        """Verify font_size is computed from region_bounds.h, not slot_bounds.h."""
        style = StyleConfig(font_size_ratio=0.5)
        # Tall footer → large region height
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.2,  # 20% of short edge → ~216px region height
                        slots={
                            "left-top": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # region_bounds.h = 1080 * 0.2 = 216, ratio 0.5 → 108
        assert el.style.font_size == 108


class TestLogoSizing:
    """Logo uses contain (max width = slot width, height target)."""

    def test_logo_width_clamped_to_slot(self):
        """Logo width capped to slot available width."""
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.09,
                        slots={
                            "right-logo": SlotConfig(
                                enabled=True,
                                content=LogoContent(path="logo.png", size_ratio=0.6),
                            ),
                        },
                    )
                ],
            ),
            1000, 600,
        )
        logo_els = [e for e in result.elements if e.type == "logo"]
        assert len(logo_els) == 1
        el = logo_els[0]
        # logo_h = max(16, round(region_bounds.h * 0.6))
        # region_bounds.h = 600 * 0.09 = 54, min 20 → 54, so 54 * 0.6 = 32.4 → 32
        # logo_w = min(slot_bounds.w, round(32 * 3 = 96))
        assert el.rect.h == 32
        assert el.rect.w <= el.rect.h * 3  # max 3:1 aspect
        assert el.rect.w > 0

    def test_logo_size_level_small(self):
        """size_level='small' → ratio 0.50."""
        content = LogoContent(path="logo.png", size_level="small")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.09,
                        slots={
                            "right-logo": SlotConfig(
                                enabled=True,
                                content=content,
                            ),
                        },
                    )
                ],
            ),
            1000, 600,
        )
        el = result.elements[0]
        # region_bounds.h = 54, ratio 0.50 = 27
        assert el.rect.h == 27

    def test_logo_size_level_large(self):
        """size_level='large' → ratio 0.72."""
        content = LogoContent(path="logo.png", size_level="large")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer", type="footer-bar", enabled=True,
                        height=0.09,
                        slots={
                            "right-logo": SlotConfig(
                                enabled=True,
                                content=content,
                            ),
                        },
                    )
                ],
            ),
            1000, 600,
        )
        el = result.elements[0]
        # region_bounds.h = 54, ratio 0.72 = 38.88 → 39
        assert el.rect.h == 39


class TestSignatureSizeLevel:
    """Signature size_level resolution."""

    def test_signature_size_level_small(self):
        """size_level='small' → ratio 0.15."""
        result = compute_layout(
            WatermarkConfig(
                regions=[
                    RegionConfig(
                        id="sig", type="free", enabled=True,
                        anchor="bottom-right",
                        offset_x=-0.05, offset_y=-0.05,
                        slots={
                            "sig1": SlotConfig(
                                enabled=True,
                                content=SignatureContent(path="sig.png", size_level="small"),
                            ),
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # short_edge = 1080, ratio 0.15 = 162
        assert el.rect.h == 162
        assert el.rect.w == 162  # square

    def test_signature_size_level_large(self):
        """size_level='large' → ratio 0.25."""
        result = compute_layout(
            WatermarkConfig(
                regions=[
                    RegionConfig(
                        id="sig", type="free", enabled=True,
                        anchor="bottom-right",
                        offset_x=-0.05, offset_y=-0.05,
                        slots={
                            "sig1": SlotConfig(
                                enabled=True,
                                content=SignatureContent(path="sig.png", size_level="large"),
                            ),
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # short_edge = 1080, ratio 0.25 = 270
        assert el.rect.h == 270
