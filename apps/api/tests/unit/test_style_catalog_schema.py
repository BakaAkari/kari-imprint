"""Every catalog style the apps build passes strict validation unchanged."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.schemas import ImprintPayload

CATALOG = json.loads(
    (Path(__file__).parents[4] / "packages/kari-core/tests/fixtures/style_catalog.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CATALOG, ids=[case["id"] for case in CATALOG])
def test_catalog_style_validates_and_round_trips(case):
    dumped = ImprintPayload.model_validate(json.loads(json.dumps(case["config"]))).model_dump()
    # Re-validating the dump is stable (what immich-ki stores and hashes).
    assert ImprintPayload.model_validate(json.loads(json.dumps(dumped))).model_dump() == dumped
    if case["config"].get("layers"):
        assert [layer["id"] for layer in dumped["layers"]] == [layer["id"] for layer in case["config"]["layers"]]
    if case["config"].get("style_id"):
        assert dumped["style_id"] == case["config"]["style_id"]
