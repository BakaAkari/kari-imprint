"""V3 Layout Engine 单元测试。"""


from kari_core.shared.v3_layout.layout_engine import (
    CanvasConfig,
    FieldChip,
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


def _make_chip() -> FieldChip:
    return FieldChip(field_id="make")


class TestCanvasSize:
    """画布尺寸计算。"""

    def test_no_margins(self):
        config = WatermarkConfig(
            canvas=CanvasConfig(margins=MarginsConfig()),
        )
        result = compute_layout(config, 1920, 1080)
        assert result.canvas.w == 1920
        assert result.canvas.h == 1080
        assert result.image_rect == Rect(x=0, y=0, w=1920, h=1080)

    def test_with_margins(self):
        config = WatermarkConfig(
            canvas=CanvasConfig(margins=MarginsConfig(top=10, right=20, bottom=30, left=40)),
        )
        result = compute_layout(config, 1000, 800)
        assert result.canvas.w == 1000 + 40 + 20  # 1060
        assert result.canvas.h == 800 + 10 + 30   # 840
        assert result.image_rect == Rect(x=40, y=10, w=1000, h=800)


class TestFontSize:
    """字号解析策略。"""

    def test_absolute_font_size(self):
        style = StyleConfig(font_size=48)
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
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
        assert el.style.font_size == 48

    def test_short_edge_reference(self):
        """使用 short_edge 作为字号基准。"""
        style = StyleConfig(font_size_ratio=0.05, size_reference="short_edge")
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
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
        # 短边 = 1080, ratio = 0.05 → 54px
        assert el.style.font_size == 54

    def test_short_edge_same_for_both_orientations(self):
        """16:9 和 9:16 使用 short_edge 时字号相同。"""
        style = StyleConfig(font_size_ratio=0.05, size_reference="short_edge")
        config = WatermarkConfig(
            canvas=CanvasConfig(margins=MarginsConfig(bottom=100)),
            regions=[
                RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    slots={
                        "left-top": SlotConfig(
                            enabled=True,
                            content=TextContent(chips=[_make_chip()]),
                            style=style,
                        )
                    },
                )
            ],
        )

        r1 = compute_layout(config, 1920, 1080)   # 16:9
        r2 = compute_layout(config, 1080, 1920)   # 9:16

        assert r1.elements[0].style.font_size == r2.elements[0].style.font_size == 54

    def test_region_height_reference(self):
        """使用 region_height 作为字号基准（默认）。
        v2: font_size 使用完整的 footer region height，不再用 slot height。
        """
        style = StyleConfig(font_size_ratio=0.5)
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig(bottom=120)),
                regions=[
                    RegionConfig(
                        id="footer",
                        type="footer-bar",
                        enabled=True,
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
            "left-top": self._text_slot(),
            "left-bottom": self._text_slot(),
            "right-top": self._text_slot(),
            "right-bottom": self._text_slot(),
        }
        result = compute_layout(
            WatermarkConfig(
                regions=[RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    height=0.09,
                    slots=slots,
                )],
                footer_mode="dual-row",
            ),
            1000,
            600,
        )

        assert result.canvas.h == 654
        elements = {el.id: el for el in result.elements}
        assert elements["footer-left-top"].anchor == "top-left"
        assert elements["footer-left-bottom"].anchor == "bottom-left"
        assert elements["footer-right-top"].anchor == "top-right"
        assert elements["footer-right-bottom"].anchor == "bottom-right"
        assert elements["footer-left-top"].rect.x < 500
        assert elements["footer-right-top"].rect.x > 500
        assert elements["footer-left-top"].rect.y < elements["footer-left-bottom"].rect.y
        assert elements["footer-right-top"].rect.y < elements["footer-right-bottom"].rect.y

    def test_single_row_is_vertically_centered_left_and_right(self):
        result = compute_layout(
            WatermarkConfig(
                regions=[RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    height=0.09,
                    slots={
                        "left-top": self._text_slot(),
                        "right-top": self._text_slot(),
                    },
                )],
                footer_mode="single-row",
            ),
            1000,
            600,
        )

        elements = {el.id: el for el in result.elements}
        left = elements["footer-left-top"]
        right = elements["footer-right-top"]
        assert left.anchor == "middle-left"
        assert right.anchor == "middle-right"
        assert left.rect.y == right.rect.y
        assert left.rect.y == 627
        assert left.rect.x < 500 < right.rect.x

    def test_right_logo_only_reserves_right_side(self):
        result = compute_layout(
            WatermarkConfig(
                regions=[RegionConfig(
                    id="footer",
                    type="footer-bar",
                    enabled=True,
                    height=0.09,
                    slots={
                        "left-top": self._text_slot(),
                        "right-logo": SlotConfig(
                            enabled=True,
                            content=LogoContent(path="logo.png"),
                        ),
                    },
                )],
            ),
            1000,
            600,
        )

        elements = {el.id: el for el in result.elements}
        assert elements["footer-left-top"].rect.x < 30
        assert elements["footer-right-logo"].anchor == "middle-right"
        assert elements["footer-right-logo"].rect.x > 900


class TestSideEdge:
    """side-edge 区域。"""

    def test_side_edge_width_pixel(self):
        """side-edge 使用固定像素宽度。"""
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig()),
                regions=[
                    RegionConfig(
                        id="side-left",
                        type="side-edge",
                        enabled=True,
                        edge="left",
                        width={"mode": "pixel", "value": 150},
                        slots={
                            "line1": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # side-edge 元素在区域内，有 8px 水平 padding
        assert el.rect.x == 8  # 左侧 padding
        assert el.rect.w == 150 - 16  # 区域宽 150px，减去左右 padding
        assert el.rect.h > 0

    def test_side_edge_width_ratio(self):
        """side-edge 使用短边比例宽度。"""
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig()),
                regions=[
                    RegionConfig(
                        id="side-left",
                        type="side-edge",
                        enabled=True,
                        edge="left",
                        width={"mode": "short_edge_ratio", "value": 0.12},
                        slots={
                            "line1": SlotConfig(
                                enabled=True,
                                content=TextContent(chips=[_make_chip()]),
                            )
                        },
                    )
                ],
            ),
            1920, 1080,
        )
        el = result.elements[0]
        # 短边 = 1080, ratio = 0.12 → round(130) 区域宽度，减去 16px padding
        assert el.rect.w == 130 - 16

    def test_side_edge_same_width_both_orientations(self):
        """16:9 和 9:16 使用 short_edge_ratio 时区域宽度相同。"""
        config = WatermarkConfig(
            canvas=CanvasConfig(margins=MarginsConfig()),
            regions=[
                RegionConfig(
                    id="side-left",
                    type="side-edge",
                    enabled=True,
                    edge="left",
                    width={"mode": "short_edge_ratio", "value": 0.12},
                    slots={
                        "line1": SlotConfig(enabled=True, content=TextContent(chips=[_make_chip()]))
                    },
                )
            ],
        )
        r1 = compute_layout(config, 1920, 1080)
        r2 = compute_layout(config, 1080, 1920)
        assert r1.elements[0].rect.w == r2.elements[0].rect.w == 114


class TestFreePosition:
    """自由定位区域。"""

    def test_free_anchor_bottom_right(self):
        """签名在右下角偏移。"""
        result = compute_layout(
            WatermarkConfig(
                canvas=CanvasConfig(margins=MarginsConfig()),
                regions=[
                    RegionConfig(
                        id="sig",
                        type="free",
                        enabled=True,
                        anchor="bottom-right",
                        offset_x=-0.05,
                        offset_y=-0.05,
                        offset_unit="short_edge_ratio",
                    )
                ],
            ),
            1920, 1080,
        )
        # 锚点 = (1920, 1080)，偏移 = -1080*0.05 = -54
        # 最终位置 = (1866, 1026)
        assert result.elements == []  # free 区域没有 slots 时不生成元素


class TestEmptyConfig:
    """空配置边界情况。"""

    def test_no_regions(self):
        result = compute_layout(WatermarkConfig(), 100, 100)
        assert result.canvas.w == 100
        assert result.canvas.h == 100
        assert len(result.elements) == 0

    def test_disabled_region(self):
        result = compute_layout(
            WatermarkConfig(
                regions=[
                    RegionConfig(id="footer", type="footer-bar", enabled=False)
                ]
            ),
            100, 100,
        )
        assert len(result.elements) == 0
