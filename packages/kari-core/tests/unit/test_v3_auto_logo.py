"""V3 auto-Logo resolution — cross-language contract test.

Loads `tests/fixtures/v3_auto_logo_cases.json` and asserts that
`v3_renderer._resolve_auto_logo_path` reaches the same conclusion as the
front-end resolver (`apps/web/src/autoLogo.ts`) for every case. The TS side
loads the same fixture in `apps/web/scripts/verifyPresetContract.mts`.

If this file's expected values are edited, the front-end contract test breaks
too — that coupling is the point.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from kari_core.core.auto_logo import match_brand_stem
from kari_core.processor.v3_renderer import _resolve_auto_logo_path
from kari_core.shared.v3_layout.layout_engine import LogoContent

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "v3_auto_logo_cases.json"


def _load_fixture() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


class TestMatchBrandStemPrimitive:
    def test_none_and_empty_make_return_none(self) -> None:
        assert match_brand_stem(None, ["fujifilm", "nikon"]) is None
        assert match_brand_stem("", ["fujifilm", "nikon"]) is None

    def test_short_tokens_are_discarded(self) -> None:
        # No token of length > 2 → no possibility of a match.
        assert match_brand_stem("AB", ["fujifilm"]) is None

    def test_no_match_returns_none(self) -> None:
        assert match_brand_stem("SOMEONE-NEW", ["nikon", "sony"]) is None


class TestV3AutoLogoContract:
    """Iterate the shared fixture; V3 policy: no fallback, builtin-only."""

    def test_fixture_cases(self, tmp_path: Path) -> None:
        fixture = _load_fixture()
        builtins = fixture["builtins"]

        # Materialise a temporary "logos dir" the renderer will walk.
        for stem in builtins:
            (tmp_path / f"{stem}.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        # A file hidden by leading dot must be ignored.
        (tmp_path / "._junk.png").write_bytes(b"")
        (tmp_path / "custom").mkdir()
        (tmp_path / "custom" / "myshop.png").write_bytes(b"")

        with patch("kari_core.processor.v3_renderer.LOGOS_DIR", tmp_path):
            for case in fixture["cases"]:
                make = case["make"]
                expected_stem = case["expected"]
                field_values: dict[str, str] = {}
                if make is not None:
                    field_values["make"] = make
                result = _resolve_auto_logo_path(LogoContent(path=""), field_values)
                if expected_stem is None:
                    assert result is None, (
                        f"case {case} — expected None, got {result}"
                    )
                else:
                    assert result is not None, (
                        f"case {case} — expected {expected_stem}, got None"
                    )
                    assert Path(result).stem == expected_stem, (
                        f"case {case} — expected stem {expected_stem}, got {Path(result).stem}"
                    )

    def test_builtin_prefix_resolves_by_stem(self, tmp_path: Path) -> None:
        (tmp_path / "nikon.png").write_bytes(b"")
        with patch("kari_core.processor.v3_renderer.LOGOS_DIR", tmp_path):
            resolved = _resolve_auto_logo_path(LogoContent(path="builtin:nikon"), {})
            assert resolved is not None
            assert Path(resolved).stem == "nikon"
            # unknown builtin → None
            assert _resolve_auto_logo_path(LogoContent(path="builtin:missing"), {}) is None

    def test_v3_does_not_walk_custom_dir(self, tmp_path: Path) -> None:
        (tmp_path / "custom").mkdir()
        (tmp_path / "custom" / "MyBrand.png").write_bytes(b"")
        with patch("kari_core.processor.v3_renderer.LOGOS_DIR", tmp_path):
            resolved = _resolve_auto_logo_path(
                LogoContent(path=""), {"make": "MyBrand"}
            )
            assert resolved is None, (
                "V3 auto-Logo must not fall through to custom/ — API /logos does not list custom stems"
            )

    def test_no_registry_returns_none(self, tmp_path: Path) -> None:
        empty = tmp_path / "empty"
        empty.mkdir()
        with patch("kari_core.processor.v3_renderer.LOGOS_DIR", empty):
            assert (
                _resolve_auto_logo_path(LogoContent(path=""), {"make": "FUJIFILM"})
                is None
            )
