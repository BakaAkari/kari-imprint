from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / "src"))

from kari_core.shared.layout.layout_engine import (  # noqa: E402
    CanvasConfig,
    EffectConfig,
    FieldChip,
    FlowLayoutConfig,
    ImprintConfig,
    LogoContent,
    MarginsConfig,
    RegionConfig,
    SlotConfig,
    StyleConfig,
    TextContent,
    compute_layout,
)
from kari_core.shared.layout.text_fit import fit_layout_texts  # noqa: E402

FIXTURES = Path(__file__).parents[1] / "fixtures" / "flow_layout_cases.json"


def fake_measure(_element, text: str, size: int) -> float:
    """Deterministic stand-in for font metrics, identical in runFlowFixtures.ts."""
    return len(list(text)) * size * 0.6


def build(case: dict) -> ImprintConfig:
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
                style=StyleConfig(font_size=value.get("font_size", 16), color=value.get("color", "#222222")),
            )
            for slot_id, value in raw["slots"].items()
        },
    )
    canvas = case["config"]["canvas"]
    effect = canvas.get("effect")
    return ImprintConfig(
        canvas=CanvasConfig(
            margins=MarginsConfig(**canvas["margins"]),
            background=canvas.get("background", "#FFFFFF"),
            effect=EffectConfig(**effect) if effect else None,
        ),
        regions=[region],
    )


def main() -> None:
    output = []
    for case in json.loads(FIXTURES.read_text()):
        layout = compute_layout(build(case), *case["image"], case.get("asset_aspect_ratio"))
        entry = {
            "id": case["id"],
            "canvas": {"w": layout.canvas.w, "h": layout.canvas.h},
            "image_rect": {"x": layout.image_rect.x, "y": layout.image_rect.y, "w": layout.image_rect.w, "h": layout.image_rect.h},
            "elements": [{
                "id": el.id, "type": el.type,
                "rect": {"x": el.rect.x, "y": el.rect.y, "w": el.rect.w, "h": el.rect.h},
                "anchor": el.anchor,
                **({"font_size": el.style.font_size, "color": el.style.color} if el.type == "text" else {}),
                **({"color": el.style.color} if el.type == "divider" else {}),
            } for el in layout.elements],
        }
        texts = case.get("texts")
        if texts:
            region_id = case["config"]["regions"][0]["id"]
            resolved = {f"{region_id}-{slot_id}": text for slot_id, text in texts.items()}
            fitted = fit_layout_texts(layout.elements, resolved, fake_measure)
            entry["fitted"] = {
                element_id: {"font_size": value.font_size, "text": value.text}
                for element_id, value in sorted(fitted.items())
            }
        output.append(entry)
    print(json.dumps(output, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
