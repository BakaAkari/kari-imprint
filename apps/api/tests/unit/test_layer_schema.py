"""Strict validation of construction layers and ratio margins."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas import ImprintPayload

BASE = {"schema_version": 3, "regions": []}


def _payload(**extra):
    return {**BASE, **extra}


def test_configs_without_layers_dump_unchanged():
    dumped = ImprintPayload.model_validate(_payload()).model_dump()
    assert "layers" not in dumped
    assert "margin_unit" not in dumped["canvas"]


def test_valid_layers_round_trip_without_unset_fields():
    layers = [
        {"id": "mat", "kind": "mat", "reveal": {"width": 0.004, "color": "#6B4E3D"}, "core": {"width": 0.002, "color": "#FFFFFF", "bevel": True}},
        {"id": "line", "kind": "keyline", "box": "photo", "offset": 0.05, "width": 0.001, "color": "#C9C2B3"},
        {"id": "rule", "kind": "rule", "box": "margin-bottom", "edge": "top", "offset": -0.01, "width": 0.001, "color": "#222222"},
        {"id": "veil", "kind": "fill", "box": "photo", "color": "#000000", "opacity": 0.3, "z": "over"},
        {"id": "cap", "kind": "text", "box": "margin-bottom", "anchor": "top-center", "size": 0.016,
         "content": {"chips": [{"field_id": "custom_text", "custom_text": "Title"}], "separator": " "}, "style": {"color": "#55504A"}},
    ]
    dumped = ImprintPayload.model_validate(_payload(layers=layers)).model_dump()
    assert [layer["kind"] for layer in dumped["layers"]] == ["mat", "keyline", "rule", "fill", "text"]
    assert dumped["layers"][1] == layers[1]
    assert dumped["layers"][4]["style"] == {"color": "#55504A"}


@pytest.mark.parametrize("layer", [
    {"id": "x", "kind": "texture", "box": "photo"},
    {"id": "x", "kind": "fill", "box": "elsewhere", "color": "#000000"},
    {"id": "x", "kind": "fill", "box": "photo", "color": "url(evil)"},
    {"id": "x", "kind": "keyline", "box": "photo", "offset": 0.0, "width": 0.0, "color": "#000000"},
    {"id": "x", "kind": "keyline", "box": "photo", "offset": 9.0, "width": 0.01, "color": "#000000"},
    {"id": "x", "kind": "fill", "box": "photo", "color": "#000000", "opacity": 1.5},
    {"id": "../x", "kind": "fill", "box": "photo", "color": "#000000"},
    {"id": "x", "kind": "text", "box": "photo", "size": 0.02, "content": {"chips": []}, "style": {"font_family": "/etc/passwd"}},
    {"id": "x", "kind": "fill", "box": "photo", "color": "#000000", "extra": 1},
    {"id": "x", "kind": "logo", "box": "photo", "height": 0.03, "path": "../../etc/passwd"},
    {"id": "x", "kind": "logo", "box": "photo", "height": 0.03, "path": "/abs/logo.png"},
    {"id": "x", "kind": "rect", "box": "photo", "color": "#000000", "blur": 0.5},
    {"id": "x", "kind": "letterbox", "aspect": 0.2, "color": "#000000"},
    {"id": "x", "kind": "segments", "box": "photo", "height": 0.9, "content": {"chips": []}},
])
def test_invalid_layers_are_rejected(layer):
    with pytest.raises(ValidationError):
        ImprintPayload.model_validate(_payload(layers=[layer]))


def test_duplicate_layer_ids_are_rejected():
    layer = {"id": "x", "kind": "fill", "box": "photo", "color": "#000000"}
    with pytest.raises(ValidationError):
        ImprintPayload.model_validate(_payload(layers=[layer, dict(layer)]))


def test_ratio_margins_accept_fractions_and_reject_pixels_beyond_one():
    canvas = {"margins": {"top": 0.1, "right": 0.1, "bottom": 0.15, "left": 0.1}, "margin_unit": "short_edge_ratio"}
    dumped = ImprintPayload.model_validate(_payload(canvas=canvas)).model_dump()
    assert dumped["canvas"]["margin_unit"] == "short_edge_ratio"
    with pytest.raises(ValidationError):
        ImprintPayload.model_validate(_payload(canvas={**canvas, "margins": {"top": 60, "right": 0, "bottom": 0, "left": 0}}))


def test_pixel_margins_must_stay_integers():
    with pytest.raises(ValidationError):
        ImprintPayload.model_validate(_payload(canvas={"margins": {"top": 0.5, "right": 0, "bottom": 0, "left": 0}}))


def test_overlay_layers_validate():
    layers = [
        {"id": "bars", "kind": "letterbox", "aspect": 2.39, "color": "#000000"},
        {"id": "glass", "kind": "rect", "box": "photo", "anchor": "bottom-left", "h": 0.15, "color": "#000000", "opacity": 0.3, "blur": 0.018, "radius": 0.01, "z": "over"},
        {"id": "mark", "kind": "logo", "box": "photo", "anchor": "bottom-left", "height": 0.03, "path": "builtin:fujifilm"},
        {"id": "stamp", "kind": "segments", "box": "photo", "anchor": "bottom-right", "height": 0.045,
         "content": {"chips": [{"field_id": "datetime", "format": "stamp"}], "separator": " "}, "color": "#FF8A1F", "glow": True},
        {"id": "sub", "kind": "text", "box": "letterbox-bottom", "size": 0.02, "content": {"chips": [{"field_id": "custom_text", "custom_text": "x"}]}},
    ]
    dumped = ImprintPayload.model_validate(_payload(layers=layers)).model_dump()
    assert [layer["kind"] for layer in dumped["layers"]] == ["letterbox", "rect", "logo", "segments", "text"]
    assert dumped["layers"][3]["content"]["chips"][0]["format"] == "stamp"
