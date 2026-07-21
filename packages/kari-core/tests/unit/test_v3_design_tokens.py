"""Static guardrails for V3 frontend/backend token and preset drift."""

from __future__ import annotations

import re
from pathlib import Path

from api.schemas_v3 import (
    _FONT_SIZE_LEVEL_RATIOS as API_FONT_SIZE_LEVEL_RATIOS,
)
from api.schemas_v3 import (
    _LOGO_SIZE_LEVEL_RATIOS as API_LOGO_SIZE_LEVEL_RATIOS,
)
from api.schemas_v3 import (
    _SIGNATURE_SIZE_LEVEL_RATIOS as API_SIGNATURE_SIZE_LEVEL_RATIOS,
)

from kari_core.shared.v3_layout.layout_engine import (
    _BORDER_WIDTH_RATIOS,
    _FONT_SIZE_LEVEL_RATIOS,
    _LOGO_SIZE_LEVEL_RATIOS,
    _SIGNATURE_SIZE_LEVEL_RATIOS,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DESIGN_TOKENS_TS = REPO_ROOT / "apps/web/src/designTokens.ts"
V3_PRESETS_TS = REPO_ROOT / "apps/web/src/v3Presets.ts"


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


def test_v3_presets_have_product_categories_and_logo_treatment_defaults():
    source = (REPO_ROOT / "apps/web/src/v3PresetDefinitions.ts").read_text()
    for category in ["brand", "minimal", "polaroid", "archive"]:
        assert f"category: '{category}'" in source
    assert "logo_treatment: 'mono-scheme'" in (REPO_ROOT / "apps/web/src/v3Types.ts").read_text()
    assert "archiveControlSurface" in source
    assert "品牌底栏" in source
    assert "拍立得白边" in source
    assert "画廊档案" in source
