"""Shared value helpers for trusted renderer-owned imprint fields.

EXIF-backed field values are produced by plain Python formatters, never by
evaluating a template: EXIF strings are attacker-controlled (any uploaded file
can carry them), so they are treated as data only. Every numeric value is
validated (finite and > 0) before formatting; an invalid value hides the field
instead of rendering ``f/0``, ``0mm``, ``0s`` or ``undef``.

Display conventions (shared with the TS placeholder samples):
  - focal length ``35mm`` (35mm-equivalent, falling back to the real focal length)
  - aperture ``f/2`` / ``f/1.8`` (no trailing zero)
  - shutter ``1/250s`` below one second, ``2s`` / ``1.3s`` otherwise
  - ISO ``ISO 100``
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping

from kari_core.shared.field_registry import FieldRegistry, get_default_registry


class LiteralText(str):
    """A user-provided string that must never be evaluated as a template."""


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]")
_WHITESPACE_RE = re.compile(r"\s+")
_NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
_MISSING_TEXT = {"", "-", "undef", "unknown", "n/a", "none", "null", "0"}

_MISSING_DISPLAY_MARKERS = {
    "",
    "-",
    "0",
    "mm",
    "-mm",
    "f/-",
    "f/None",
    "-s",
    "ISO0",
    "-, -",
}


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    text = _CONTROL_CHARS_RE.sub("", str(value))
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return "" if text.lower() in _MISSING_TEXT else text


def _parse_positive(value: object) -> float | None:
    """Parse ``1/250``, ``23.0 mm``, ``f/1.8`` or ``200`` into a finite float > 0."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = _clean_text(value)
        if not text:
            return None
        if "/" in text and not text.lower().startswith("f/"):
            numerator, _, denominator = text.partition("/")
            top = _NUMBER_RE.search(numerator)
            bottom = _NUMBER_RE.search(denominator)
            if top is None or bottom is None:
                return None
            try:
                den = float(bottom.group())
                number = float(top.group()) / den if den != 0 else math.nan
            except (ValueError, OverflowError):
                return None
        else:
            match = _NUMBER_RE.search(text)
            if match is None:
                return None
            try:
                number = float(match.group())
            except (ValueError, OverflowError):
                return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _first_positive(exif: Mapping[str, object], *keys: str) -> float | None:
    for key in keys:
        value = _parse_positive(exif.get(key))
        if value is not None:
            return value
    return None


def _trim_number(value: float, digits: int = 1) -> str:
    text = f"{value:.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def format_focal_length(exif: Mapping[str, object]) -> str:
    value = _first_positive(exif, "FocalLengthIn35mmFormat", "FocalLengthIn35mmFilm", "FocalLength")
    if value is None or value > 10000:
        return ""
    return f"{_trim_number(value)}mm"


def format_aperture(exif: Mapping[str, object]) -> str:
    value = _first_positive(exif, "FNumber", "ApertureValue", "Aperture")
    if value is None or value > 256:
        return ""
    return f"f/{_trim_number(value)}"


def format_shutter(exif: Mapping[str, object]) -> str:
    seconds = _first_positive(exif, "ExposureTime", "ShutterSpeed", "ShutterSpeedValue")
    if seconds is None or seconds > 86400:
        return ""
    if seconds >= 1:
        return f"{_trim_number(seconds)}s"
    reciprocal = 1 / seconds
    if reciprocal >= 10 or abs(reciprocal - round(reciprocal)) < 0.05:
        return f"1/{round(reciprocal)}s"
    return f"1/{_trim_number(reciprocal)}s"


def format_iso(exif: Mapping[str, object]) -> str:
    value = _first_positive(exif, "ISO", "ISOSpeedRatings", "PhotographicSensitivity")
    if value is None or value > 10_000_000:
        return ""
    return f"ISO {round(value)}"


def _format_datetime(exif: Mapping[str, object]) -> str:
    for key in (
        "DateTimeOriginal", "CreateDate", "DigitalCreationDate",
        "DateCreated", "DateTimeCreated", "DigitalCreationDateTime",
    ):
        text = _clean_text(exif.get(key))
        if text and not text.startswith("0000"):
            return text[:16]
    return ""


def _format_gps(exif: Mapping[str, object]) -> str:
    latitude = _clean_text(exif.get("GPSLatitude"))
    longitude = _clean_text(exif.get("GPSLongitude"))
    if not latitude or not longitude:
        return ""
    return f"{latitude}, {longitude}"


# Trailing corporate words that make EXIF ``Make`` noisy in a caption, e.g.
# "NIKON CORPORATION", "LEICA CAMERA AG", "RICOH IMAGING COMPANY, LTD.".
_MAKE_SUFFIX_WORDS = {"corporation", "corp", "co", "company", "ltd", "limited", "inc", "imaging", "camera", "ag", "gmbh"}


def _format_make(exif: Mapping[str, object]) -> str:
    words = _clean_text(exif.get("Make")).split(" ")
    while len(words) > 1 and words[-1].strip(".,").casefold() in _MAKE_SUFFIX_WORDS:
        words.pop()
    return " ".join(words).rstrip(" ,")


def _format_camera_model(exif: Mapping[str, object]) -> str:
    return _clean_text(exif.get("CameraModelName") or exif.get("Model")).replace("_", "")


_FORMATTERS: dict[str, Callable[[Mapping[str, object]], str]] = {
    "camera_model": _format_camera_model,
    "lens_model": lambda exif: _clean_text(exif.get("LensModel")),
    "focal_length": format_focal_length,
    "aperture": format_aperture,
    "shutter": format_shutter,
    "iso": format_iso,
    "datetime": _format_datetime,
    "make": _format_make,
    "artist": lambda exif: _clean_text(exif.get("Artist")),
    "gps": _format_gps,
}


def _normalize_display_value(value: object) -> str:
    text = str(value).strip()
    return "" if text in _MISSING_DISPLAY_MARKERS else text


def resolve_field_values(
    exif: dict | None,
    file_path: str = "",
    *,
    registry: FieldRegistry | None = None,
) -> dict[str, str]:
    """Resolve registered EXIF-backed field IDs into safe display strings.

    This is the single shared field-value path for V3 preview metadata and final
    PIL rendering. It intentionally returns normalized display values, not raw
    EXIF and not any server filesystem paths. ``file_path`` is accepted for API
    compatibility and is never rendered.
    """
    del file_path
    active_registry = registry or get_default_registry()
    safe_exif: Mapping[str, object] = exif or {}
    values: dict[str, str] = {}
    for field in active_registry.all():
        if field.category != "exif":
            continue
        formatter = _FORMATTERS.get(field.field_id)
        if formatter is None:
            continue
        values[field.field_id] = _normalize_display_value(formatter(safe_exif))
    return values


def missing_field_ids(field_values: dict[str, str]) -> list[str]:
    """Return field IDs whose normalized display value is effectively empty."""
    return [field_id for field_id, value in field_values.items() if _normalize_display_value(value) == ""]
