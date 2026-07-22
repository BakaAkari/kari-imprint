from __future__ import annotations

import json
from pathlib import Path

from kari_core.shared.v3_layout.layout_engine import (
    CanvasConfig,
    FieldChip,
    FlowLayoutConfig,
    MarginsConfig,
    RegionConfig,
    SlotConfig,
    StyleConfig,
    TextContent,
    WatermarkConfig,
    compute_layout,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "v3_flow_layout_cases.json"


def _slot(field_id: str) -> SlotConfig:
    return SlotConfig(
        enabled=True,
        content=TextContent(chips=[FieldChip(field_id=field_id)]),
        style=StyleConfig(font_size=16),
    )


def _config(case: dict) -> WatermarkConfig:
    data = case["config"]
    margins = data["canvas"]["margins"]
    regions = []
    for raw in data["regions"]:
        regions.append(RegionConfig(
            id=raw["id"], type=raw["type"], enabled=raw["enabled"],
            edge=raw.get("edge"), width=raw.get("width"), height=raw.get("height"),
            layout=FlowLayoutConfig(mode=raw["layout"]["mode"]),
            slots={slot_id: _slot(slot["text"]) for slot_id, slot in raw["slots"].items()},
        ))
    return WatermarkConfig(
        canvas=CanvasConfig(margins=MarginsConfig(**margins)),
        regions=regions,
    )


def test_flow_fixtures_are_deterministic_and_bounded():
    cases = json.loads(FIXTURES.read_text())
    for case in cases:
        config = _config(case)
        first = compute_layout(config, *case["image"])
        second = compute_layout(config, *case["image"])
        assert first == second, case["id"]
        assert all(0 <= el.rect.x <= first.canvas.w and 0 <= el.rect.y <= first.canvas.h for el in first.elements)
        if case["config"]["regions"][0]["layout"]["mode"] == "single-track":
            assert all("secondary" not in el.id for el in first.elements)


def test_side_primary_track_stays_photo_adjacent():
    cases = {case["id"]: case for case in json.loads(FIXTURES.read_text())}
    right = compute_layout(_config(cases["side-right-dual"]), 800, 600)
    right_elements = {el.id: el for el in right.elements}
    assert right_elements["flow-primary-start"].rect.x < right_elements["flow-secondary-start"].rect.x

    left_case = cases["side-left-single"]
    left_case["config"]["regions"][0]["layout"]["mode"] = "dual-track"
    left_case["config"]["regions"][0]["slots"]["secondary-end"] = {"enabled": True, "text": "shutter"}
    left = compute_layout(_config(left_case), 600, 900)
    left_elements = {el.id: el for el in left.elements}
    assert left_elements["flow-primary-start"].rect.x > left_elements["flow-secondary-start"].rect.x
