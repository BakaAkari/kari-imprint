import pytest

from api.errors import ApiError
from api.schemas_v3 import validate_v3_payload


def test_side_bar_and_text_directions_are_accepted():
    result = validate_v3_payload({
        "schema_version": 2,
        "defaults": {"text_direction": "vertical-glyphs"},
        "regions": [{
            "id": "side",
            "type": "side-bar",
            "edge": "right",
            "width": {"mode": "short_edge_ratio", "value": 0.12},
            "slots": {"left-top": {"enabled": True, "content": {
                "chips": [{"field_id": "make"}], "separator": " ",
            }}},
        }],
    })
    assert result["regions"][0]["type"] == "side-bar"
    assert result["defaults"]["text_direction"] == "vertical-glyphs"


def test_unknown_text_direction_is_rejected():
    with pytest.raises(ApiError):
        validate_v3_payload({"defaults": {"text_direction": "diagonal"}})
