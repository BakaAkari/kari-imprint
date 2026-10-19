"""Layout Engine 单元测试。"""

from kari_core.shared.layout.layout_engine import (
    CanvasConfig,
    FieldChip,
    FlowLayoutConfig,
    ImprintConfig,
    LogoContent,
    MarginsConfig,
    Rect,
    RegionConfig,
    SlotConfig,
    StyleConfig,
    TextContent,
    compute_layout,
)


def _make_chip() -> FieldChip:
    return FieldChip(field_id="make")


class TestCanvasSize:
    """画布尺寸计算。"""

    def test_no_margins(self):
        config = ImprintConfig(
            canvas=CanvasConfig(margins=MarginsConfig()),
        )
        result = compute_layout(config, 1920, 1080)
        assert result.canvas.w == 1920
        assert result.canvas.h == 1080
        assert result.image_rect == Rect(x=0, y=0, w=1920, h=1080)

    def test_with_margins(self):
        config = ImprintConfig(
            canvas=CanvasConfig(margins=MarginsConfig(top=10, right=20, bottom=30, left=40)),
        )
        result = compute_layout(config, 1000, 800)
        assert result.canvas.w == 1000 + 40 + 20  # 1060
        assert result.canvas.h == 800 + 10 + 30  # 840
        assert result.image_rect == Rect(x=40, y=10, w=1000, h=800)


class TestFontSize:
    """字号解析策略。"""

    def test_absolute_font_size(self):
        style = StyleConfig(font_size=48)
        result = compute_layout(
            ImprintConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        slots={
                            "primary-start": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920,
            1080,
        )
        el = result.elements[0]
        assert el.style.font_size == 48

    def test_short_edge_reference(self):
        """使用 short_edge 作为字号基准。"""
        style = StyleConfig(font_size_ratio=0.05, size_reference="short_edge")
        result = compute_layout(
            ImprintConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        slots={
                            "primary-start": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920,
            1080,
        )
        el = result.elements[0]
        # 短边 = 1080, ratio = 0.05 → 54px
        assert el.style.font_size == 54

    def test_short_edge_same_for_both_orientations(self):
        """16:9 和 9:16 使用 short_edge 时字号相同。"""
        style = StyleConfig(font_size_ratio=0.05, size_reference="short_edge")
        config = ImprintConfig(
            canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
            regions=[
                RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    slots={
                        "primary-start": SlotConfig(
                            enabled=True,
                            content=TextContent(chips=[_make_chip()]),
                            style=style,
                        )
                    },
                )
            ],
        )

        r1 = compute_layout(config, 1920, 1080)  # 16:9
        r2 = compute_layout(config, 1080, 1920)  # 9:16

        assert r1.elements[0].style.font_size == r2.elements[0].style.font_size == 54

    def test_region_height_reference(self):
        """使用 region_height 作为字号基准（默认）。
        v2: font_size 使用完整的 footer region height，不再用 slot height。
        """
        style = StyleConfig(font_size_ratio=0.5)
        result = compute_layout(
            ImprintConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=120)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        slots={
                            "primary-start": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                                style=style,
                            )
                        },
                    )
                ],
            ),
            1920,
            1080,
        )
        el = result.elements[0]
        # v2: full footer region height = 120px (bottom margin), ratio = 0.5 → 60px
        assert el.style.font_size == 60


class TestFooterBarLayout:
    """底栏高度和四角/左右布局契约。"""

    @staticmethod
    def _text_slot() -> SlotConfig:
        return SlotConfig(
            enabled=True,
            content=TextContent(chips=[_make_chip()]),
            style=StyleConfig(font_size=12),
        )

    def test_fixed_footer_height_and_dual_row_corners(self):
        slots = {
            "primary-start": self._text_slot(),
            "secondary-start": self._text_slot(),
            "primary-end": self._text_slot(),
            "secondary-end": self._text_slot(),
        }
        result = compute_layout(
            ImprintConfig(
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        height=0.09,
                        slots=slots,
                    )
                ],
            ),
            1000,
            600,
        )

        assert result.canvas.h == 654
        elements = {el.id: el for el in result.elements}
        assert elements["footer-primary-start"].anchor == "middle-left"
        assert elements["footer-secondary-start"].anchor == "middle-left"
        assert elements["footer-primary-end"].anchor == "middle-right"
        assert elements["footer-secondary-end"].anchor == "middle-right"
        assert elements["footer-primary-start"].rect.x < 500
        assert elements["footer-primary-end"].rect.x > 500
        assert elements["footer-primary-start"].rect.y < elements["footer-secondary-start"].rect.y
        assert elements["footer-primary-end"].rect.y < elements["footer-secondary-end"].rect.y

    def test_single_row_is_vertically_centered_left_and_right(self):
        result = compute_layout(
            ImprintConfig(
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        height=0.09,
                        layout=FlowLayoutConfig(mode="single-track"),
                        slots={
                            "primary-start": self._text_slot(),
                            "primary-end": self._text_slot(),
                        },
                    )
                ],
            ),
            1000,
            600,
        )

        elements = {el.id: el for el in result.elements}
        left = elements["footer-primary-start"]
        right = elements["footer-primary-end"]
        assert left.anchor == "middle-left"
        assert right.anchor == "middle-right"
        assert left.rect.y == right.rect.y
        assert left.rect.y == 627
        assert left.rect.x < 500 < right.rect.x

    def test_right_logo_only_reserves_right_side(self):
        result = compute_layout(
            ImprintConfig(
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        height=0.09,
                        slots={
                            "primary-start": self._text_slot(),
                            "asset": SlotConfig(
                                enabled=True,
                                content=LogoContent(path="logo.png"),
                            ),
                        },
                    )
                ],
            ),
            1000,
            600,
        )

        elements = {el.id: el for el in result.elements}
        assert elements["footer-primary-start"].rect.x < 30
        assert elements["footer-asset"].anchor == "middle-center"
        assert elements["footer-asset"].rect.x > 400

    def test_asset_aspect_ratio_scales_logo_box_width(self):
        """Real-image aspect ratio replaces the hard-coded 3× width box."""

        def _run(aspect: float | None) -> Rect:
            layout = compute_layout(
                ImprintConfig(
                    regions=[
                        RegionConfig(
                            id="footer",
                            type="footer-bar",
                            enabled=True,
                            height=0.09,
                            slots={
                                "primary-start": self._text_slot(),
                                "asset": SlotConfig(
                                    enabled=True,
                                    content=LogoContent(path="logo.png", placement="end"),
                                ),
                            },
                        )
                    ],
                ),
                1000,
                600,
                aspect,
            )
            return {el.id: el for el in layout.elements}["footer-asset"].rect

        fallback = _run(None)
        square = _run(1.0)
        wide = _run(5.0)

        # Square logos should occupy far less horizontal space than the legacy 3× box.
        assert square.w < fallback.w
        # Wide wordmark logos should stretch wider than the legacy 3× box (bounded by inner width).
        assert wide.w > fallback.w
        # Compact marks keep the full logo box height; wide wordmarks are
        # optically reduced (height ∝ sqrt(2.5 / aspect)) so they do not dominate.
        assert square.h >= fallback.h >= wide.h
        assert square.h == round(54 * 0.44)

    def test_asset_aspect_ratio_none_matches_default(self):
        def _run(aspect: float | None) -> Rect:
            layout = compute_layout(
                ImprintConfig(
                    regions=[
                        RegionConfig(
                            id="footer",
                            type="footer-bar",
                            enabled=True,
                            height=0.09,
                            slots={
                                "primary-start": self._text_slot(),
                                "asset": SlotConfig(
                                    enabled=True,
                                    content=LogoContent(path="logo.png", placement="start"),
                                ),
                            },
                        )
                    ],
                ),
                1000,
                600,
                aspect,
            )
            return {el.id: el for el in layout.elements}["footer-asset"].rect

        # None must be equivalent to the legacy 3.0 constant.
        assert _run(None) == _run(3.0)

    def test_asset_aspect_ratio_clamped(self):
        def _run(aspect: float | None) -> Rect:
            layout = compute_layout(
                ImprintConfig(
                    regions=[
                        RegionConfig(
                            id="footer",
                            type="footer-bar",
                            enabled=True,
                            height=0.09,
                            slots={
                                "asset": SlotConfig(
                                    enabled=True,
                                    content=LogoContent(path="logo.png", placement="end"),
                                ),
                            },
                        )
                    ],
                ),
                1000,
                600,
                aspect,
            )
            return {el.id: el for el in layout.elements}["footer-asset"].rect

        # Values outside [0.3, 6.0] should be clamped, not blindly multiplied.
        insane = _run(100.0)
        capped = _run(6.0)
        assert insane.w == capped.w

        tiny = _run(0.01)
        floor = _run(0.3)
        assert tiny.w == floor.w

    def test_side_asset_aspect_ratio_scales_logo_box_height(self):
        """side-bar (vertical flow): width is constrained by the bar width;
        real-image aspect ratio should drive the box height, not width."""

        def _run(aspect: float | None) -> Rect:
            layout = compute_layout(
                ImprintConfig(
                    regions=[
                        RegionConfig(
                            id="side",
                            type="side-bar",
                            enabled=True,
                            edge="right",
                            width={"mode": "pixel", "value": 140},
                            slots={
                                "primary-start": self._text_slot(),
                                "asset": SlotConfig(
                                    enabled=True,
                                    content=LogoContent(path="logo.png", placement="end"),
                                ),
                            },
                        )
                    ],
                ),
                800,
                600,
                aspect,
            )
            return {el.id: el for el in layout.elements}["side-asset"].rect

        fallback = _run(None)
        square = _run(1.0)
        wide = _run(5.0)

        # Cross-axis width comes from the side-bar inner width and does not
        # depend on aspect ratio.
        assert square.w == fallback.w == wide.w
        # Height (flow-axis) = round(logo_size / aspect), so larger aspect
        # (wider wordmark) yields a shorter box.
        assert wide.h < fallback.h < square.h

    def test_auto_logo_with_empty_path_reserves_end_space(self):
        """layout engine 本身不区分自动/手动 path；预留由上层解析后决定。"""
        result = compute_layout(
            ImprintConfig(
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
                        height=0.09,
                        slots={
                            "primary-end": self._text_slot(),
                            "asset": SlotConfig(
                                enabled=True,
                                content=LogoContent(path="", placement="end"),
                            ),
                        },
                    )
                ],
            ),
            1000,
            600,
        )

        elements = {el.id: el for el in result.elements}
        _text = elements["footer-primary-end"]
        logo = elements["footer-asset"]
        assert logo.anchor == "middle-right"
        # layout engine 层面不区分 path 是否有值；上层会先解析 auto-logo 再传进来
        assert logo.rect.w > 0


class TestSideBarTrackOrder:
    def test_track_order_flips_primary_column(self):
        def _run(track_order):
            return compute_layout(
                ImprintConfig(
                    regions=[
                        RegionConfig(
                            id="side",
                            type="side-bar",
                            enabled=True,
                            edge="right",
                            width={"mode": "pixel", "value": 140},
                            layout=FlowLayoutConfig(track_order=track_order),
                            slots={
                                "primary-start": SlotConfig(
                                    enabled=True,
                                    content=TextContent(chips=[_make_chip()]),
                                    style=StyleConfig(font_size=12),
                                ),
                                "secondary-start": SlotConfig(
                                    enabled=True,
                                    content=TextContent(chips=[_make_chip()]),
                                    style=StyleConfig(font_size=12),
                                ),
                            },
                        )
                    ]
                ),
                800,
                600,
            )

        outward = {el.id: el for el in _run("photo-outward").elements}
        inward = {el.id: el for el in _run("outward-photo").elements}
        # photo-outward: primary column is the outer (far right) one.
        assert outward["side-primary-start"].rect.x > outward["side-secondary-start"].rect.x
        # outward-photo: primary column is adjacent to the photo (inner/left).
        assert inward["side-primary-start"].rect.x < inward["side-secondary-start"].rect.x


class TestLogoSymmetricSafeArea:
    """分隔线到图形、图形到外侧内容边界的空白必须相等（几何断言）。"""

    @staticmethod
    def _footer(placement, item_gap):
        return ImprintConfig(
            canvas=CanvasConfig(margins=MarginsConfig()),
            regions=[
                RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    height=0.1,
                    padding={"top": 0, "right": 0, "bottom": 0, "left": 0},
                    layout=FlowLayoutConfig(item_gap={"mode": "pixel", "value": item_gap}),
                    slots={
                        "primary-start": SlotConfig(
                            enabled=True, content=TextContent(chips=[_make_chip()]), style=StyleConfig(font_size=12)
                        ),
                        "asset": SlotConfig(enabled=True, content=LogoContent(path="logo.png", placement=placement)),
                    },
                )
            ],
        )

    @staticmethod
    def _side(edge, placement, item_gap):
        return ImprintConfig(
            canvas=CanvasConfig(margins=MarginsConfig()),
            regions=[
                RegionConfig(
                    id="side",
                    type="side-bar",
                    enabled=True,
                    edge=edge,
                    width={"mode": "pixel", "value": 140},
                    padding={"top": 0, "right": 0, "bottom": 0, "left": 0},
                    layout=FlowLayoutConfig(item_gap={"mode": "pixel", "value": item_gap}),
                    slots={
                        "primary-start": SlotConfig(
                            enabled=True, content=TextContent(chips=[_make_chip()]), style=StyleConfig(font_size=12)
                        ),
                        "asset": SlotConfig(enabled=True, content=LogoContent(path="logo.png", placement=placement)),
                    },
                )
            ],
        )

    def test_horizontal_end_logo_gap_is_symmetric(self):
        result = compute_layout(self._footer("end", 10), 1000, 600)
        elements = {el.id: el for el in result.elements}
        logo, divider = elements["footer-asset"], elements["footer-divider"]
        # anchor 'middle-right' → rect.x is the logo's right edge; padding 0 and
        # no canvas margins → inner right edge == canvas width.
        assert logo.rect.x == result.canvas.w - 10
        assert (logo.rect.x - logo.rect.w) - (divider.rect.x + divider.rect.w) == 10

    def test_vertical_end_logo_gap_is_symmetric(self):
        result = compute_layout(self._side("right", "end", 10), 800, 600)
        elements = {el.id: el for el in result.elements}
        logo, divider = elements["side-asset"], elements["side-divider"]
        # anchor 'bottom-center' → rect.y is the logo's bottom edge.
        assert logo.rect.y == result.canvas.h - 10
        assert (logo.rect.y - logo.rect.h) - (divider.rect.y + divider.rect.h) == 10

    def test_vertical_start_logo_gap_is_symmetric(self):
        result = compute_layout(self._side("left", "start", 10), 800, 600)
        elements = {el.id: el for el in result.elements}
        logo, divider = elements["side-asset"], elements["side-divider"]
        # anchor 'top-center' → rect.y is the logo's top edge.
        assert logo.rect.y == 10
        assert divider.rect.y - (logo.rect.y + logo.rect.h) == 10
