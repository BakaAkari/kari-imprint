"""Date formats — shared fixture with apps/web/scripts/verifyPresetContract.mts."""

import json
from pathlib import Path

import pytest

from kari_core.shared.render_values import format_date

CASES = json.loads((Path(__file__).parents[1] / "fixtures" / "field_format_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[f"{c['format']}:{c['raw']}" for c in CASES])
def test_format_date(case):
    assert format_date(case["raw"], case["format"]) == case["expected"]
