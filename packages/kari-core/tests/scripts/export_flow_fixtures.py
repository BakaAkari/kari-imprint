from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / "src"))

from kari_core.shared.v3_layout.layout_engine import (  # noqa: E402
    CanvasConfig,
    FieldChip,
    FlowLayoutConfig,
    LogoContent,
    MarginsConfig,
    RegionConfig,
    SlotConfig,
    StyleConfig,
    TextContent,
    WatermarkConfig,
    compute_layout,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "v3_flow_layout_cases.json"


def build(case: dict) -> WatermarkConfig:
    raw = case["config"]["regions"][0]

    def slot_content(value: dict):
        if "logo" in value:
            return LogoContent(path=value["logo"], placement=value.get("placement", "center"))
        return TextContent(chips=[FieldChip(field_id=value["text"])])

    region = RegionConfig(
        id=raw["id"], type=raw["type"], enabled=True,
        height=raw.get("height"), edge=raw.get("edge"), width=raw.get("width"),
        layout=FlowLayoutConfig(mode=raw["layout"]["mode"]),
        slots={
            slot_id: SlotConfig(
                enabled=value["enabled"],
                content=slot_content(value),
                style=StyleConfig(font_size=16),
            )
            for slot_id, value in raw["slots"].items()
        },
    )
    return WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig(**case["config"]["canvas"]["margins"])),
        regions=[region],
    )


def main() -> None:
    output = []
    for case in json.loads(FIXTURES.read_text()):
        layout = compute_layout(build(case), *case["image"])
        output.append({
            "id": case["id"],
            "canvas": {"w": layout.canvas.w, "h": layout.canvas.h},
            "image_rect": {"x": layout.image_rect.x, "y": layout.image_rect.y, "w": layout.image_rect.w, "h": layout.image_rect.h},
            "elements": [{
                "id": el.id, "type": el.type,
                "rect": {"x": el.rect.x, "y": el.rect.y, "w": el.rect.w, "h": el.rect.h},
                "anchor": el.anchor,
            } for el in layout.elements],
        })
    print(json.dumps(output, separators=(",", ":")))


if __name__ == "__main__":
    main()
