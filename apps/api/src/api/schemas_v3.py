"""V3 watermark request schemas and payload validation.

Mirrors the TypeScript types in apps/web/src/v3Types.ts.
All validators are strict (extra=forbid) to prevent accidental field injection.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from api.errors import ApiError

Color = str
ResourceId = str
Anchor = Literal[
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
]

_RESOURCE_ID_PATTERN = r"^(?:[A-Za-z0-9_-]{20,64}\.(?:png|jpg|jpeg|webp))?$"
_FOOTER_SLOT_IDS = frozenset({
    "left-logo", "left-top", "left-bottom", "center",
    "right-top", "right-bottom", "right-logo",
})
_SIDE_SLOT_RE = re.compile(r"^line[1-9][0-9]?$", re.ASCII)
_FREE_SLOT_RE = re.compile(r"^sig[1-9][0-9]?$", re.ASCII)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


# ── Leaf models ──────────────────────────────────────────────────────────


class FieldChipPayload(StrictModel):
    field_id: Literal[
        "camera_model", "lens_model", "focal_length", "aperture", "shutter",
        "iso", "datetime", "make", "artist", "gps", "custom_text", "empty",
    ] = "empty"
    custom_text: str = Field(default="", max_length=160)


class TextContentPayload(StrictModel):
    chips: list[FieldChipPayload] = Field(default_factory=list, max_length=20)
    separator: str = Field(default=" ", max_length=8)


class LogoContentPayload(StrictModel):
    path: ResourceId = Field(default="", max_length=128, pattern=_RESOURCE_ID_PATTERN)
    color: Color = "#D8D8D6"
    size_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    size_level: Literal["small", "medium", "large"] | None = None

    @field_validator("color")
    @classmethod
    def valid_color(cls, value: str) -> str:
        return _validate_color(value)

    @model_validator(mode="after")
    def size_conflict(self) -> LogoContentPayload:
        sources = sum(
            1 for s in [self.size_ratio, self.size_level]
            if s is not None
        )
        if sources > 1:
            raise ValueError(
                "size_ratio 和 size_level 最多只能设置一个"
            )
        return self


class SignatureContentPayload(StrictModel):
    path: ResourceId = Field(default="", max_length=128, pattern=_RESOURCE_ID_PATTERN)
    invert_mono: bool = False
    size_ratio: float | None = Field(default=None, ge=0.01, le=1.0)
    size_level: Literal["small", "medium", "large"] | None = None

    @model_validator(mode="after")
    def size_conflict(self) -> SignatureContentPayload:
        sources = sum(
            1 for s in [self.size_ratio, self.size_level]
            if s is not None
        )
        if sources > 1:
            raise ValueError(
                "size_ratio 和 size_level 最多只能设置一个"
            )
        return self


_FONT_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.18,
    "medium": 0.23,
    "large": 0.25,
}
_LOGO_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.50,
    "medium": 0.60,
    "large": 0.72,
}
_SIGNATURE_SIZE_LEVEL_RATIOS: dict[str, float] = {
    "small": 0.15,
    "medium": 0.20,
    "large": 0.25,
}


class StyleConfigPayload(StrictModel):
    font_size: int | None = Field(default=None, ge=4, le=200)
    font_size_ratio: float | None = Field(default=None, ge=0.0, le=0.5)
    font_size_level: Literal["small", "medium", "large"] | None = None
    size_reference: Literal["region_height", "short_edge", "long_edge"] = "region_height"
    color: Color = "#222222"
    font_family: Literal[
        "NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf",
    ] = "NotoSansCJKsc-Bold.otf"
    bold: bool = True
    line_height: float = Field(default=1.2, ge=0.5, le=3.0)

    @field_validator("color")
    @classmethod
    def valid_color(cls, value: str) -> str:
        return _validate_color(value)

    @model_validator(mode="after")
    def font_size_conflict(self) -> StyleConfigPayload:
        sources = sum(
            1 for s in [self.font_size, self.font_size_ratio, self.font_size_level]
            if s is not None
        )
        if sources > 1:
            raise ValueError(
                "font_size、font_size_ratio、font_size_level 最多只能设置一个"
            )
        return self


class SlotConfigPayload(StrictModel):
    enabled: bool = False
    content: TextContentPayload | LogoContentPayload | SignatureContentPayload | None = None
    style: StyleConfigPayload | None = None


class WidthPayload(StrictModel):
    mode: Literal["pixel", "short_edge_ratio"] = "short_edge_ratio"
    value: float = Field(default=0.05, ge=0.0, le=600.0)

    @model_validator(mode="after")
    def valid_mode_range(self) -> WidthPayload:
        if self.mode == "short_edge_ratio" and self.value > 1.0:
            raise ValueError("短边比例宽度不能大于 1")
        return self


class RegionConfigPayload(StrictModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    type: Literal["footer-bar", "side-edge", "free"]
    enabled: bool = True
    slots: dict[str, SlotConfigPayload] = Field(default_factory=dict, max_length=12)
    height: float | None = Field(default=None, ge=0.0, le=1.0)
    edge: Literal["left", "right"] | None = None
    width: WidthPayload | None = None
    alignment: Literal["start", "center", "end"] | None = "start"
    anchor: Anchor | None = None
    offset_x: float = Field(default=0.0, ge=-2000.0, le=2000.0)
    offset_y: float = Field(default=0.0, ge=-2000.0, le=2000.0)
    offset_unit: Literal["pixel", "short_edge_ratio"] = "short_edge_ratio"

    @model_validator(mode="after")
    def valid_region_shape(self) -> RegionConfigPayload:
        slot_ids = set(self.slots)
        if self.type == "footer-bar":
            invalid = slot_ids - _FOOTER_SLOT_IDS
        elif self.type == "side-edge":
            invalid = {slot_id for slot_id in slot_ids if not _SIDE_SLOT_RE.fullmatch(slot_id)}
        else:
            invalid = {slot_id for slot_id in slot_ids if not _FREE_SLOT_RE.fullmatch(slot_id)}
        if invalid:
            raise ValueError(f"区域包含不支持的槽位: {', '.join(sorted(invalid))}")

        if self.type != "footer-bar" and self.height is not None:
            raise ValueError("height 只能用于 footer-bar 区域")

        if self.offset_unit == "short_edge_ratio" and (
            abs(self.offset_x) > 1.0 or abs(self.offset_y) > 1.0
        ):
            raise ValueError("短边比例偏移必须在 -1 到 1 之间")
        return self


class MarginsConfigPayload(StrictModel):
    top: int = Field(default=0, ge=0, le=600)
    right: int = Field(default=0, ge=0, le=600)
    bottom: int = Field(default=0, ge=0, le=600)
    left: int = Field(default=0, ge=0, le=600)


class BorderConfigPayload(StrictModel):
    enabled: bool = False
    width_level: Literal["small", "medium", "large"] = "medium"
    color: Color = "#FFFFFF"

    @field_validator("color")
    @classmethod
    def valid_color(cls, value: str) -> str:
        return _validate_color(value)


class CanvasConfigPayload(StrictModel):
    margins: MarginsConfigPayload = Field(default_factory=MarginsConfigPayload)
    background: Color = "#FFFFFF"
    border_radius: int = Field(default=0, ge=0, le=300)
    border: BorderConfigPayload | None = None

    @field_validator("background")
    @classmethod
    def valid_color(cls, value: str) -> str:
        return _validate_color(value)


# ── Root payload ─────────────────────────────────────────────────────────


class WatermarkPayloadV3(StrictModel):
    schema_version: int = Field(default=2, ge=1, le=2)
    canvas: CanvasConfigPayload = Field(default_factory=CanvasConfigPayload)
    regions: list[RegionConfigPayload] = Field(default_factory=list, max_length=10)
    defaults: StyleConfigPayload = Field(default_factory=StyleConfigPayload)
    custom_text: str = Field(default="", max_length=160)
    footer_mode: Literal["dual-row", "single-row"] = "dual-row"
    logo_position: Literal["left", "center", "right"] = "right"

    @model_validator(mode="before")
    @classmethod
    def migrate_v1_schema(cls, data: Any) -> Any:
        """Migrate missing or schema_version=1 payloads to v2."""
        if not isinstance(data, dict):
            return data
        sv = data.get("schema_version", 1)
        if isinstance(sv, str):
            try:
                sv = int(sv)
            except (ValueError, TypeError):
                sv = 1
        if sv >= 2:
            return data
        # schema_version=1 or missing: upgrade to v2
        data["schema_version"] = 2
        # Migrate defaults.font_size_level from ratio if only ratio is set
        defaults = data.get("defaults") or {}
        if (
            isinstance(defaults, dict)
            and defaults.get("font_size_ratio") is not None
            and defaults.get("font_size_level") is None
        ):
            for level, ratio in _FONT_SIZE_LEVEL_RATIOS.items():
                if abs(defaults["font_size_ratio"] - ratio) < 0.001:
                    defaults["font_size_level"] = level
                    defaults["font_size_ratio"] = None
                    break
        # Migrate slot-level style font_size_level
        for region in data.get("regions") or []:
            if not isinstance(region, dict):
                continue
            for slot in (region.get("slots") or {}).values():
                if not isinstance(slot, dict):
                    continue
                style = slot.get("style") or {}
                if (
                    isinstance(style, dict)
                    and style.get("font_size_ratio") is not None
                    and style.get("font_size_level") is None
                ):
                    for level, ratio in _FONT_SIZE_LEVEL_RATIOS.items():
                        if abs(style["font_size_ratio"] - ratio) < 0.001:
                            style["font_size_level"] = level
                            style["font_size_ratio"] = None
                            break
                content = slot.get("content") or {}
                if isinstance(content, dict):
                    ratio_value = content.get("size_ratio")
                    level_value = content.get("size_level")
                    ratios = _LOGO_SIZE_LEVEL_RATIOS if "color" in content else _SIGNATURE_SIZE_LEVEL_RATIOS
                    if ratio_value is not None and level_value is None:
                        for level, ratio in ratios.items():
                            if abs(ratio_value - ratio) < 0.001:
                                content["size_level"] = level
                                content["size_ratio"] = None
                                break
                    elif ratio_value is not None and level_value is not None:
                        expected = ratios.get(level_value)
                        if expected is not None and abs(ratio_value - expected) < 0.001:
                            content["size_ratio"] = None
        return data


# ── Helpers ──────────────────────────────────────────────────────────────


def is_v3_payload(payload: dict[str, Any]) -> bool:
    """Heuristic: V3 payloads always contain a ``regions`` list."""
    return isinstance(payload, dict) and "regions" in payload


def success_response(**data: Any) -> dict[str, Any]:
    return {"ok": True, **data}


def validate_v3_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Validate a V3 config dict and return the cleaned dict.

    Raises ApiError (422) on validation failure.
    """
    try:
        parsed = WatermarkPayloadV3.model_validate(payload or {})
    except ValidationError as exc:
        first = exc.errors(include_url=False)[0]
        location = ".".join(str(part) for part in first["loc"])
        raise ApiError(
            code="invalid_config",
            message="水印配置不合法",
            status_code=422,
            detail=f"{location}: {first['msg']}",
        ) from exc
    # Return as plain dict so downstream can use _dict_to_watermark_config
    return parsed.model_dump()


def _validate_color(value: str) -> str:
    if len(value) != 7 or not value.startswith("#"):
        raise ValueError("颜色必须使用 #RRGGBB 格式")
    try:
        int(value[1:], 16)
    except ValueError as exc:
        raise ValueError("颜色必须使用 #RRGGBB 格式") from exc
    return value.upper()
