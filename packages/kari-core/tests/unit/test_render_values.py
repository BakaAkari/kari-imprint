from __future__ import annotations

from kari_core.shared.render_values import LiteralText, missing_field_ids, resolve_field_values


def test_resolve_field_values_normalizes_exif_for_v3_preview_and_rendering() -> None:
    values = resolve_field_values({
        "Make": "FUJIFILM",
        "CameraModelName": "X_T5",
        "FocalLengthIn35mmFormat": "35 mm",
        "ApertureValue": "2.8",
        "ShutterSpeed": "1/250",
        "ISO": "400",
        "DateTimeOriginal": "2026:07:21 12:34:56",
    })

    assert values["make"] == "FUJIFILM"
    assert values["camera_model"] == "XT5"
    assert values["focal_length"] == "35mm"
    assert values["aperture"] == "f/2.8"
    assert values["shutter"] == "1/250s"
    assert values["iso"] == "ISO400"
    assert values["datetime"] == "2026:07:21 12:34"


def test_missing_field_ids_marks_effectively_empty_values() -> None:
    assert missing_field_ids({"make": "-", "iso": "ISO400", "gps": "-, -"}) == ["make", "gps"]


def test_resolve_field_values_suppresses_missing_template_artifacts() -> None:
    values = resolve_field_values({"Make": "LEICA", "CameraModelName": "Q3"})

    assert values["make"] == "LEICA"
    assert values["camera_model"] == "Q3"
    assert values["focal_length"] == ""
    assert values["aperture"] == ""
    assert values["shutter"] == ""
    assert values["iso"] == ""


def test_literal_text_marker_remains_plain_string() -> None:
    value = LiteralText("{{ 7 * 7 }}")
    assert isinstance(value, str)
    assert str(value) == "{{ 7 * 7 }}"
