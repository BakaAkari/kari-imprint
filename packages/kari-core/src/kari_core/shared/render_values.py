"""Shared value helpers for trusted renderer-owned watermark fields."""

from __future__ import annotations

from jinja2 import Template

from kari_core.shared.field_registry import FieldRegistry, get_default_registry


class LiteralText(str):
    """A user-provided string that must never be evaluated as a template."""


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
    EXIF and not any server filesystem paths.
    """
    active_registry = registry or get_default_registry()
    safe_exif = exif or {}
    context = {"exif": safe_exif, "file_path": file_path, "file_dir": ""}
    values: dict[str, str] = {}
    for field in active_registry.all():
        if field.category != "exif" or not field.jinja_template:
            continue
        rendered = Template(field.jinja_template).render(**context)
        values[field.field_id] = _normalize_display_value(rendered)
    return values


def missing_field_ids(field_values: dict[str, str]) -> list[str]:
    """Return field IDs whose normalized display value is effectively empty."""
    return [field_id for field_id, value in field_values.items() if _normalize_display_value(value) == ""]
