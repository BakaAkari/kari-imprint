"""Tests for V3 schema v2: font_size_level, size_level, migration, conflict rules."""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from api.schemas import (
    LogoContentPayload,
    SignatureContentPayload,
    StyleConfigPayload,
    validate_imprint_payload,
)


class TestSchemaVersion:
    """schema_version=2 must be accepted; missing/v1 payloads migrated."""

    def test_accepts_explicit_v3(self):
        result = validate_imprint_payload({"schema_version": 3})
        assert result["schema_version"] == 3

    def test_defaults_to_v3_when_missing(self):
        result = validate_imprint_payload({})
        assert result["schema_version"] == 3

    def test_migrates_v1_to_v3(self):
        result = validate_imprint_payload({"schema_version": 1})
        assert result["schema_version"] == 3

    def test_rejects_v4(self):
        from api.errors import ApiError
        with pytest.raises(ApiError):
            validate_imprint_payload({"schema_version": 4})


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
                                "size_ratio": 0.78,
                            },
                        },
                    },
                }
            ],
        }

    def test_defaults_ratio_18_migrates_to_small(self):
        result = validate_imprint_payload(deepcopy(self._sample_v1()))
        assert result["defaults"]["font_size_level"] == "small"
        assert result["defaults"]["font_size_ratio"] is None

    def test_slot_ratio_23_migrates_to_medium(self):
        result = validate_imprint_payload(deepcopy(self._sample_v1()))
        slot = result["regions"][0]["slots"]["primary-start"]
        assert slot["style"]["font_size_level"] == "medium"
        assert slot["style"]["font_size_ratio"] is None

    def test_logo_ratio_60_migrates_to_medium(self):
        result = validate_imprint_payload(deepcopy(self._sample_v1()))
        content = result["regions"][0]["slots"]["asset"]["content"]
        assert content["size_level"] == "medium"
        assert content["size_ratio"] is None

    def test_non_token_ratio_not_migrated(self):
        """A ratio like 0.35 should stay as-is (not matching any token level)."""
        payload = deepcopy(self._sample_v1())
        payload["defaults"]["font_size_ratio"] = 0.35
        result = validate_imprint_payload(payload)
        # 0.35 doesn't match small/medium/large, so stays
        assert result["defaults"]["font_size_level"] is None
        assert result["defaults"]["font_size_ratio"] == 0.35

    def test_existing_level_preserved(self):
        """If size_level already set, don't overwrite; drop compatible ratio."""
        payload = deepcopy(self._sample_v1())
        payload["regions"][0]["slots"]["right-logo"]["content"]["size_level"] = "large"
        payload["regions"][0]["slots"]["right-logo"]["content"]["size_ratio"] = 0.95
        result = validate_imprint_payload(payload)
        content = result["regions"][0]["slots"]["asset"]["content"]
        # size_level already set, kept
        assert content["size_level"] == "large"
        # compatible ratio (0.95 == large) dropped
        assert content["size_ratio"] is None

class TestRegionLayoutFields:
    def test_region_padding_and_vertical_alignment_accepted(self):
        result = validate_imprint_payload({
            "schema_version": 3,
            "regions": [
                {
                    "id": "side-left",
                    "type": "side-bar",
                    "enabled": True,
                    "edge": "left",
                    "alignment": "start",
                    "vertical_alignment": "end",
                    "padding": {"top": 24, "right": 12, "bottom": 30, "left": 12},
                    "slots": {
                        "primary-start": {
                            "enabled": True,
                            "content": {"chips": [{"field_id": "make"}], "separator": " / "},
                            "style": {"font_size_level": "small"},
                        }
                    },
                }
            ],
        })
        region = result["regions"][0]
        assert region["vertical_alignment"] == "end"
        assert region["padding"]["bottom"] == 30


class TestColorValidation:
    @pytest.mark.parametrize("color", ["#+1_234", "#-12345", "# 12345", "#FFF", "red", "#12345G", "#1234567"])
    def test_rejects_malformed_colors(self, color):
        from api.errors import ApiError

        with pytest.raises(ApiError):
            validate_imprint_payload({"canvas": {"background": color}})
        with pytest.raises(ValidationError):
            StyleConfigPayload(color=color)

    def test_normalizes_valid_colors(self):
        assert validate_imprint_payload({"canvas": {"background": "#2b2b2b"}})["canvas"]["background"] == "#2B2B2B"


class TestCanvasEffect:
    def test_missing_effect_is_not_serialized(self):
        result = validate_imprint_payload({"canvas": {"background": "#FFFFFF"}})
        assert "effect" not in result["canvas"]

    def test_accepts_full_effect(self):
        result = validate_imprint_payload(
            {"canvas": {"effect": {"background": "blur", "photo_radius": 0.03, "shadow": True}}}
        )
        assert result["canvas"]["effect"] == {"background": "blur", "photo_radius": 0.03, "shadow": True}

    @pytest.mark.parametrize(
        "effect",
        [
            {"background": "gradient"},
            {"photo_radius": 0.081},
            {"photo_radius": -0.01},
            {"photo_radius": float("inf")},
            {"photo_radius": "0.02"},
            {"shadow": "yes"},
            {"shadow": 1},
            {"extra": True},
        ],
    )
    def test_rejects_invalid_effect(self, effect):
        from api.errors import ApiError

        with pytest.raises(ApiError):
            validate_imprint_payload({"canvas": {"effect": effect}})


def test_legacy_logo_ratio_still_migrates_to_level():
    payload = {
        "schema_version": 3,
        "regions": [{
            "id": "footer", "type": "footer-bar", "height": 0.1,
            "slots": {"asset": {"enabled": True, "content": {"path": "", "size_ratio": 0.78}}},
        }],
    }
    result = validate_imprint_payload(payload)
    content = result["regions"][0]["slots"]["asset"]["content"]
    assert content["size_level"] == "medium" and content["size_ratio"] is None
