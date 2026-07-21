"""V3 Region-Based Watermark Filter.

此处理器是 V3 架构的后端渲染层：
  - 输入：v3_config (dict) + 原图 PIL Image + EXIF
  - 行为：调用 shared.v3_layout.layout_engine.compute_layout() 获取 LayoutResult
  - 输出：按 LayoutResult 在画布上粘贴/合成所有水印元素

与 V2 WatermarkFilter 的核心区别：
  - 不内联计算坐标，全部委托给纯函数布局引擎
  - 按 LayoutResult 的顺序绘制元素，不做任何位置计算
"""

from __future__ import annotations

from kari_core.processor.core import PipelineContext, register
from kari_core.processor.filters import FilterProcessor
from kari_core.processor.v3_renderer import render_pil
from kari_core.shared.render_values import resolve_field_values
from kari_core.shared.v3_layout.layout_engine import TextContent, compute_layout

# ── 注册处理器 ──────────────────────────────────────────────────────────

@register("v3_watermark")
class WatermarkV3Filter(FilterProcessor):
    """V3 水印滤镜 — 基于 LayoutResult 的声明式渲染。"""

    def process(self, ctx: PipelineContext):
        config_dict = ctx.get("v3_config")
        if not config_dict:
            ctx.success()
            return

        config = _dict_to_watermark_config(config_dict)
        img = ctx.get_buffer()[0]

        # 1. 计算布局
        layout = compute_layout(config, img.width, img.height)

        # 2. 获取 EXIF / file_path 用于文本值解析
        exif = ctx.get_exif() or {}
        file_path = ctx.get("input_path", "")
        field_values = resolve_field_values(exif, file_path)

        # 3. 唯一后端 renderer：按 LayoutResult 绘制，不在 processor 内重复坐标/绘制逻辑
        canvas = render_pil(
            layout,
            img,
            bg_color=config.canvas.background,
            field_values=field_values,
            custom_text=config.custom_text,
            config=config,
        )

        ctx.update_buffer([canvas]).save_buffer(self.name()).success()

# ── 辅助函数 ────────────────────────────────────────────────────────────



def _build_text(content: TextContent, custom_text: str, exif: dict, file_path: str) -> str:
    """将 TextContent 中的 chips 解析为实际文本字符串。"""
    field_values = resolve_field_values(exif, file_path)
    texts: list[str] = []

    for chip in content.chips:
        if chip.field_id == "empty":
            continue
        if chip.field_id == "custom_text":
            texts.append(chip.custom_text or custom_text or "")
            continue
        value = field_values.get(chip.field_id, "")
        if value:
            texts.append(value)

    return content.separator.join(texts)




def _dict_to_watermark_config(data: dict):
    """将前端/API 传来的 plain dict 重建为 layout_engine 的 dataclass。"""
    from kari_core.shared.v3_layout.layout_engine import (
        BorderConfig,
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
    )

    def _style(d: dict | None) -> StyleConfig | None:
        if d is None:
            return None
        return StyleConfig(
            font_size=d.get("font_size"),
            font_size_ratio=d.get("font_size_ratio"),
            font_size_level=d.get("font_size_level"),
            size_reference=d.get("size_reference", "region_height"),
            color=d.get("color", "#222222"),
            font_family=d.get("font_family", "NotoSansCJKsc-Bold.otf"),
            bold=d.get("bold", True),
            line_height=d.get("line_height", 1.2),
        )

    def _content(d: dict | None):
        if d is None:
            return None
        if "chips" in d and "separator" in d:
            return TextContent(
                chips=[
                    FieldChip(
                        field_id=c.get("field_id", "empty"),
                        custom_text=c.get("custom_text", ""),
                    )
                    for c in d["chips"]
                ],
                separator=d.get("separator", " "),
            )
        if "path" in d and "invert_mono" in d:
            return SignatureContent(
                path=d.get("path", ""),
                invert_mono=d.get("invert_mono", False),
                size_ratio=d.get("size_ratio"),
                size_level=d.get("size_level"),
            )
        if "path" in d and "color" in d:
            return LogoContent(
                path=d.get("path", ""),
                color=d.get("color", "#D8D8D6"),
                treatment=d.get("treatment", "mono-scheme"),
                size_ratio=d.get("size_ratio"),
                size_level=d.get("size_level"),
            )
        return None

    def _slot(d: dict | None) -> SlotConfig | None:
        if d is None:
            return None
        return SlotConfig(
            enabled=d.get("enabled", False),
            content=_content(d.get("content")),
            style=_style(d.get("style")),
        )

    def _region(d: dict) -> RegionConfig:
        return RegionConfig(
            id=d.get("id", ""),
            type=d.get("type", ""),
            enabled=d.get("enabled", False),
            slots={k: _slot(v) for k, v in (d.get("slots") or {}).items()},
            height=d.get("height"),
            edge=d.get("edge"),
            width=d.get("width"),
            alignment=d.get("alignment", "start"),
            vertical_alignment=d.get("vertical_alignment", "center"),
            padding=d.get("padding"),
            anchor=d.get("anchor"),
            offset_x=d.get("offset_x", 0.0),
            offset_y=d.get("offset_y", 0.0),
            offset_unit=d.get("offset_unit", "short_edge_ratio"),
        )

    canvas = data.get("canvas", {})
    margins = canvas.get("margins", {})
    border = canvas.get("border")

    return WatermarkConfig(
        canvas=CanvasConfig(
            margins=MarginsConfig(
                top=margins.get("top", 0),
                right=margins.get("right", 0),
                bottom=margins.get("bottom", 0),
                left=margins.get("left", 0),
            ),
            background=canvas.get("background", "#FFFFFF"),
            border_radius=canvas.get("border_radius", 0),
            border=BorderConfig(
                enabled=border.get("enabled", False),
                width_level=border.get("width_level", "medium"),
                color=border.get("color", "#FFFFFF"),
            ) if isinstance(border, dict) else None,
        ),
        regions=[_region(r) for r in data.get("regions", [])],
        defaults=_style(data.get("defaults")) or StyleConfig(),
        custom_text=data.get("custom_text", ""),
        footer_mode=data.get("footer_mode", "dual-row"),
    )
