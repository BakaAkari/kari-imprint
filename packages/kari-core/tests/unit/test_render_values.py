from __future__ import annotations

import pytest

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
    assert values["iso"] == "ISO 400"
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


@pytest.mark.parametrize(
    ("exif", "field", "expected"),
    [
        ({"FNumber": "0"}, "aperture", ""),
        ({"FNumber": "undef"}, "aperture", ""),
        ({"FNumber": "0/0"}, "aperture", ""),
        ({"FNumber": "nan"}, "aperture", ""),
        ({"FNumber": "2.0"}, "aperture", "f/2"),
        ({"FNumber": "1.8"}, "aperture", "f/1.8"),
        ({"FNumber": "1.78"}, "aperture", "f/1.8"),
        ({"FNumber": "7.1"}, "aperture", "f/7.1"),
        ({"FocalLength": "0.0 mm", "FocalLengthIn35mmFormat": "0 mm"}, "focal_length", ""),
        ({"FocalLength": "23.0 mm"}, "focal_length", "23mm"),
        ({"FocalLength": "6.765 mm"}, "focal_length", "6.8mm"),
        ({"FocalLength": "23.0 mm", "FocalLengthIn35mmFormat": "35 mm"}, "focal_length", "35mm"),
        ({"ExposureTime": "0"}, "shutter", ""),
        ({"ExposureTime": "undef", "ShutterSpeed": "undef"}, "shutter", ""),
        ({"ExposureTime": "1/250"}, "shutter", "1/250s"),
        ({"ExposureTime": "30"}, "shutter", "30s"),
        ({"ExposureTime": "2"}, "shutter", "2s"),
        ({"ExposureTime": "1.3"}, "shutter", "1.3s"),
        ({"ExposureTime": "0.5"}, "shutter", "1/2s"),
        ({"ExposureTime": "0.8"}, "shutter", "1/1.2s"),
        ({"ISO": "0"}, "iso", ""),
        ({"ISO": "100"}, "iso", "ISO 100"),
        ({"Make": "Canon\x00\x00  "}, "make", "Canon"),
        ({"CameraModelName": "华为 Mate 60 Pro"}, "camera_model", "华为 Mate 60 Pro"),
        ({"CameraModelName": "α7R V"}, "camera_model", "α7R V"),
    ],
)
def test_field_formatters_validate_and_format_numeric_values(exif, field, expected) -> None:
    assert resolve_field_values(exif)[field] == expected


def test_field_values_never_evaluate_exif_text_as_template() -> None:
    values = resolve_field_values({"LensModel": "{{ 7 * 7 }}", "Artist": "{% for x in y %}"})
    assert values["lens_model"] == "{{ 7 * 7 }}"
    assert values["artist"] == "{% for x in y %}"


@pytest.mark.parametrize(
    ("make", "expected"),
    [
        ("NIKON CORPORATION", "NIKON"),
        ("LEICA CAMERA AG", "LEICA"),
        ("RICOH IMAGING COMPANY, LTD.", "RICOH"),
        ("OLYMPUS IMAGING CORP.", "OLYMPUS"),
        ("Canon", "Canon"),
        ("OM Digital Solutions", "OM Digital Solutions"),
        ("CAMERA", "CAMERA"),
    ],
)
def test_make_drops_corporate_suffixes(make, expected):
    assert resolve_field_values({"Make": make})["make"] == expected
