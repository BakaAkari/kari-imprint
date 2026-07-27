"""Static guardrails for frontend/backend token and preset drift."""

from __future__ import annotations

import re
from pathlib import Path

from api.schemas import (
    _FONT_SIZE_LEVEL_RATIOS as API_FONT_SIZE_LEVEL_RATIOS,
)
from api.schemas import (
    _LOGO_SIZE_LEVEL_RATIOS as API_LOGO_SIZE_LEVEL_RATIOS,
)
from api.schemas import (
    _SIGNATURE_SIZE_LEVEL_RATIOS as API_SIGNATURE_SIZE_LEVEL_RATIOS,
)

from kari_core.shared.layout.layout_engine import (
    _BORDER_WIDTH_RATIOS,
    _FONT_SIZE_LEVEL_RATIOS,
    _LOGO_SIZE_LEVEL_RATIOS,
    _SIGNATURE_SIZE_LEVEL_RATIOS,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DESIGN_TOKENS_TS = REPO_ROOT / "apps/web/src/designTokens.ts"
PRESETS_TS = REPO_ROOT / "apps/web/src/presets.ts"


def _extract_ts_record(name: str) -> dict[str, float]:
    source = DESIGN_TOKENS_TS.read_text()
    match = re.search(rf"{name}[^=]*=\s*\{{([^}}]+)\}}", source)
    assert match, f"missing {name} in designTokens.ts"
    return {
        key: float(value)
        for key, value in re.findall(r"(small|medium|large):\s*([0-9.]+)", match.group(1))
    }


def test_frontend_backend_size_tokens_stay_in_sync():
    assert _extract_ts_record("FONT_SIZE_RATIOS") == _FONT_SIZE_LEVEL_RATIOS
    assert _extract_ts_record("LOGO_SIZE_RATIOS") == _LOGO_SIZE_LEVEL_RATIOS
    assert _extract_ts_record("SIGNATURE_SIZE_RATIOS") == _SIGNATURE_SIZE_LEVEL_RATIOS
    assert _extract_ts_record("BORDER_WIDTH_RATIOS") == _BORDER_WIDTH_RATIOS
    assert API_FONT_SIZE_LEVEL_RATIOS == _FONT_SIZE_LEVEL_RATIOS
    assert API_LOGO_SIZE_LEVEL_RATIOS == _LOGO_SIZE_LEVEL_RATIOS
    assert API_SIGNATURE_SIZE_LEVEL_RATIOS == _SIGNATURE_SIZE_LEVEL_RATIOS


def test_presets_have_product_categories():
    source = (REPO_ROOT / "apps/web/src/presetDefinitions.ts").read_text()
    for category in ["brand", "minimal", "polaroid"]:
        assert f"category: '{category}'" in source
    assert "品牌底栏" in source
    assert "拍立得白边" in source
