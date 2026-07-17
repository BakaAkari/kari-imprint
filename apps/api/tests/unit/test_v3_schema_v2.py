"""Tests for V3 schema v2: font_size_level, size_level, migration, conflict rules."""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from api.schemas_v3 import (
    LogoContentPayload,
    SignatureContentPayload,
    StyleConfigPayload,
    validate_v3_payload,
)


class TestSchemaVersion:
    """schema_version=2 must be accepted; missing/v1 payloads migrated."""

    def test_accepts_explicit_v2(self):
        result = validate_v3_payload({"schema_version": 2})
        assert result["schema_version"] == 2

    def test_defaults_to_v2_when_missing(self):
        result = validate_v3_payload({})
        assert result["schema_version"] == 2

    def test_migrates_v1_to_v2(self):
        result = validate_v3_payload({"schema_version": 1})
        assert result["schema_version"] == 2

    def test_rejects_v3(self):
        from api.errors import ApiError
        with pytest.raises(ApiError):
            validate_v3_payload({"schema_version": 3})


class TestFontSizeLevel:
    """StyleConfigPayload font_size_level and conflict rules."""

    def test_font_size_level_accepted(self):
        p = StyleConfigPayload(font_size_level="small")
        assert p.font_size_level == "small"

    def test_font_size_level_medium(self):
        p = StyleConfigPayload(font_size_level="medium")
        assert p.font_size_level == "medium"

    def test_font_size_level_large(self):
        p = StyleConfigPayload(font_size_level="large")
        assert p.font_size_level == "large"

    def test_font_size_default_none(self):
        p = StyleConfigPayload()
        assert p.font_size_level is None

    def test_conflict_font_size_and_level_rejected(self):
        with pytest.raises(ValidationError, match="最多只能设置一个"):
            StyleConfigPayload(font_size=24, font_size_level="small")

    def test_conflict_ratio_and_level_rejected(self):
        with pytest.raises(ValidationError, match="最多只能设置一个"):
            StyleConfigPayload(font_size_ratio=0.2, font_size_level="small")

    def test_conflict_all_three_rejected(self):
        with pytest.raises(ValidationError, match="最多只能设置一个"):
            StyleConfigPayload(font_size=24, font_size_ratio=0.2, font_size_level="small")

    def test_absolute_solo_allowed(self):
        p = StyleConfigPayload(font_size=24)
        assert p.font_size == 24

    def test_ratio_solo_allowed(self):
        p = StyleConfigPayload(font_size_ratio=0.125)
        assert p.font_size_ratio == 0.125

    def test_level_defaults_allowed_with_defaults(self):
        """defaults (all None) should pass."""
        p = StyleConfigPayload()
        assert p.font_size is None
        assert p.font_size_ratio is None
        assert p.font_size_level is None


class TestLogoSizeLevel:
    """LogoContentPayload size_level and conflict rules."""

    VALID_PATH = f"{'a' * 20}.png"

    def test_size_level_accepted(self):
        p = LogoContentPayload(path=self.VALID_PATH, size_level="small")
        assert p.size_level == "small"

    def test_size_ratio_nullable(self):
        p = LogoContentPayload(path=self.VALID_PATH, size_level="medium")
        assert p.size_ratio is None

    def test_conflict_size_ratio_and_level_rejected(self):
        with pytest.raises(ValidationError, match="最多只能设置一个"):
            LogoContentPayload(path=self.VALID_PATH, size_ratio=0.5, size_level="large")

    def test_size_ratio_solo_allowed(self):
        p = LogoContentPayload(path=self.VALID_PATH, size_ratio=0.6)
        assert p.size_ratio == 0.6
        assert p.size_level is None


class TestSignatureSizeLevel:
    """SignatureContentPayload size_level and conflict rules."""

    VALID_PATH = f"{'a' * 20}.png"

    def test_size_level_accepted(self):
        p = SignatureContentPayload(path=self.VALID_PATH, size_level="medium")
        assert p.size_level == "medium"

    def test_size_ratio_nullable(self):
        p = SignatureContentPayload(path=self.VALID_PATH, size_level="small")
        assert p.size_ratio is None

    def test_conflict_rejected(self):
        with pytest.raises(ValidationError, match="最多只能设置一个"):
            SignatureContentPayload(path=self.VALID_PATH, size_ratio=0.15, size_level="medium")


class TestMigration:
    """V1 -> V2 migration of font_size_level and size_level."""

    @staticmethod
    def _sample_v1() -> dict:
        return {
            "defaults": {
                "font_size_ratio": 0.18,
                "size_reference": "region_height",
                "color": "#222222",
                "font_family": "NotoSansCJKsc-Bold.otf",
                "bold": True,
                "line_height": 1.2,
            },
            "regions": [
                {
                    "id": "footer",
                    "type": "footer-bar",
                    "enabled": True,
                    "slots": {
                        "left-top": {
                            "enabled": True,
                            "content": {
                                "chips": [{"field_id": "make"}],
                                "separator": " ",
                            },
                            "style": {
                                "font_size_ratio": 0.23,
                                "size_reference": "region_height",
                                "color": "#222222",
                                "font_family": "NotoSansCJKsc-Bold.otf",
                                "bold": True,
                                "line_height": 1.2,
                            },
                        },
                        "right-logo": {
                            "enabled": True,
                            "content": {
                                "path": "",
                                "color": "#D8D8D6",
                                "size_ratio": 0.60,
                            },
                        },
                    },
                }
            ],
        }

    def test_defaults_ratio_18_migrates_to_small(self):
        result = validate_v3_payload(deepcopy(self._sample_v1()))
        assert result["defaults"]["font_size_level"] == "small"
        assert result["defaults"]["font_size_ratio"] is None

    def test_slot_ratio_23_migrates_to_medium(self):
        result = validate_v3_payload(deepcopy(self._sample_v1()))
        slot = result["regions"][0]["slots"]["left-top"]
        assert slot["style"]["font_size_level"] == "medium"
        assert slot["style"]["font_size_ratio"] is None

    def test_logo_ratio_60_migrates_to_medium(self):
        result = validate_v3_payload(deepcopy(self._sample_v1()))
        content = result["regions"][0]["slots"]["right-logo"]["content"]
        assert content["size_level"] == "medium"
        assert content["size_ratio"] is None

    def test_non_token_ratio_not_migrated(self):
        """A ratio like 0.35 should stay as-is (not matching any token level)."""
        payload = deepcopy(self._sample_v1())
        payload["defaults"]["font_size_ratio"] = 0.35
        result = validate_v3_payload(payload)
        # 0.35 doesn't match small/medium/large, so stays
        assert result["defaults"]["font_size_level"] is None
        assert result["defaults"]["font_size_ratio"] == 0.35

    def test_existing_level_preserved(self):
        """If size_level already set, don't overwrite; drop compatible ratio."""
        payload = deepcopy(self._sample_v1())
        payload["regions"][0]["slots"]["right-logo"]["content"]["size_level"] = "large"
        payload["regions"][0]["slots"]["right-logo"]["content"]["size_ratio"] = 0.72
        result = validate_v3_payload(payload)
        content = result["regions"][0]["slots"]["right-logo"]["content"]
        # size_level already set, kept
        assert content["size_level"] == "large"
        # compatible ratio (0.72 == large) dropped
        assert content["size_ratio"] is None
