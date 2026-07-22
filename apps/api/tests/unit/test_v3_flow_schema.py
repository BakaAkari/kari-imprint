from api.schemas_v3 import validate_v3_payload


def test_v2_footer_migrates_to_v3_canonical_slots():
    result = validate_v3_payload({
        "schema_version": 2, "footer_mode": "dual-row",
        "regions": [{"id": "footer", "type": "footer-bar", "slots": {
            "left-top": {"enabled": True, "content": {"chips": [{"field_id": "make"}], "separator": " "}},
            "right-logo": {"enabled": True, "content": {"path": "", "size_level": "medium"}},
        }}],
    })
    assert result["schema_version"] == 3
    assert "footer_mode" not in result
    region = result["regions"][0]
    assert set(region["slots"]) == {"primary-start", "asset"}
    assert region["layout"]["mode"] == "dual-track"
    assert region["slots"]["asset"]["content"]["orientation"] == "upright"


def test_v3_flow_payload_round_trips():
    result = validate_v3_payload({
        "schema_version": 3,
        "regions": [{
            "id": "side", "type": "side-bar", "edge": "right",
            "layout": {
                "mode": "single-track", "main_alignment": "space-between",
                "cross_alignment": "center", "track_order": "photo-outward",
                "track_gap": {"mode": "pixel", "value": 8},
                "item_gap": {"mode": "pixel", "value": 8},
                "track_ratios": [0.6, 0.4],
            },
            "text_orientation": "rotate-with-edge",
            "slots": {"primary-start": {
                "enabled": True,
                "content": {"chips": [{"field_id": "make"}], "separator": " "},
            }},
        }],
    })
    region = result["regions"][0]
    assert region["layout"]["mode"] == "single-track"
    assert region["text_orientation"] == "rotate-with-edge"
