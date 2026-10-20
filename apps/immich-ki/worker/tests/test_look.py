"""diff/apply/overrides semantics for album look patches (design §3)."""

from copy import deepcopy

import pytest
from immich_ki.look import apply, diff, overrides


def footer(**extra):
    region = {
        "id": "footer",
        "type": "footer-bar",
        "enabled": True,
        "height": 0.1,
        "slots": {
            "primary-start": {
                "enabled": True,
                "content": {"chips": [{"field_id": "make", "custom_text": ""}], "separator": " "},
                "style": {"color": "#222222", "bold": True, "font_size_level": "medium"},
            },
            "asset": {"enabled": True, "content": {"path": "builtin:fujifilm", "size_level": "medium"}, "style": None},
        },
        "layout": {"mode": "dual-track", "track_ratios": [0.6, 0.4]},
    }
    region.update(extra)
    return region


BASE = {
    "schema_version": 3,
    "canvas": {"margins": {"top": 0, "right": 0, "bottom": 20, "left": 0}, "background": "#FFFFFF"},
    "regions": [footer()],
    "defaults": {"color": "#222222", "font_size": None},
    "custom_text": "",
}


def variants():
    def edit(fn):
        target = deepcopy(BASE)
        fn(target)
        return target

    signature = {
        "id": "sig",
        "type": "free",
        "enabled": True,
        "slots": {"sig1": {"enabled": True, "content": {"path": "a" * 32 + ".png", "invert_mono": False}}},
        "anchor": "bottom-right",
    }
    return {
        "identical": deepcopy(BASE),
        "position": edit(lambda t: t["regions"][0].update(type="side-bar", edge="right", height=None)),
        "fields": edit(
            lambda t: t["regions"][0]["slots"]["primary-start"]["content"].update(
                chips=[{"field_id": "iso", "custom_text": ""}, {"field_id": "aperture", "custom_text": ""}]
            )
        ),
        "color": edit(lambda t: t["regions"][0]["slots"]["primary-start"]["style"].update(color="#FF0000")),
        "signature_added": edit(lambda t: t["regions"].append(deepcopy(signature))),
        "logo_removed": edit(lambda t: t["regions"][0]["slots"].pop("asset")),
        "effect_added": edit(lambda t: t["canvas"].update(effect={"background": "blur", "photo_radius": 0.02, "shadow": True})),
        "null_value": edit(lambda t: t["defaults"].update(color=None)),
        "new_key_null": edit(lambda t: t["defaults"].update(text_direction=None)),
        "key_removed": edit(lambda t: t["defaults"].pop("font_size")),
        "style_none_to_dict": edit(lambda t: t["regions"][0]["slots"]["asset"].update(style={"color": "#000000"})),
        "plain": edit(lambda t: t.update(regions=[])),
        "reorder": edit(lambda t: t["regions"].insert(0, deepcopy(signature))),
        "int_to_float": edit(lambda t: t["regions"][0].update(height=1)),
        "bool_vs_int": edit(lambda t: t["regions"][0].update(enabled=1)),
        "many": edit(
            lambda t: (
                t["canvas"]["margins"].update(bottom=60, left=10),
                t["regions"][0]["layout"].update(track_ratios=[0.5, 0.5]),
                t.update(custom_text="hello"),
            )
        ),
    }


@pytest.mark.parametrize("name", list(variants()))
def test_round_trip(name):
    target = variants()[name]
    patch = diff(BASE, target)
    result, dropped = apply(BASE, patch)
    assert result == target and dropped == []
    # Order of regions is part of the config.
    assert [r["id"] for r in result["regions"]] == [r["id"] for r in target["regions"]]
    # Reverse direction too.
    back, _ = apply(target, diff(target, BASE))
    assert back == BASE


def test_round_trip_distinguishes_types():
    target = variants()["bool_vs_int"]
    result, _ = apply(BASE, diff(BASE, target))
    assert type(result["regions"][0]["enabled"]) is int


def test_identical_is_empty_and_base_unchanged():
    snapshot = deepcopy(BASE)
    assert diff(BASE, deepcopy(BASE)) == {}
    apply(BASE, diff(BASE, variants()["many"]))
    assert snapshot == BASE


def test_null_distinct_from_missing():
    assert diff(BASE, variants()["null_value"]) == {"defaults": {"color": None}}
    assert diff(BASE, variants()["key_removed"]) == {"defaults": {"font_size": {"$delete": True}}}
    assert diff(BASE, variants()["new_key_null"]) == {"defaults": {"text_direction": None}}


def test_patch_shape_and_overrides():
    patch = diff(BASE, variants()["color"])
    assert patch == {
        "regions": {"$regions": {"footer": {"slots": {"primary-start": {"style": {"color": "#FF0000"}}}}}}
    }
    assert overrides(patch) == ["regions/footer/slots/primary-start/style/color"]
    effect = diff(BASE, variants()["effect_added"])
    assert effect == {"canvas": {"effect": {"$set": {"background": "blur", "photo_radius": 0.02, "shadow": True}}}}
    assert overrides(effect) == ["canvas/effect"]
    assert overrides(diff(BASE, variants()["signature_added"])) == ["regions/sig"]
    assert overrides(diff(BASE, variants()["logo_removed"])) == ["regions/footer/slots/asset"]
    assert overrides(diff(BASE, variants()["plain"])) == ["regions/footer"]
    assert sorted(overrides(diff(BASE, variants()["many"]))) == [
        "canvas/margins/bottom", "canvas/margins/left", "custom_text", "regions/footer/layout/track_ratios",
    ]
    assert "regions/$order" in overrides(diff(BASE, variants()["reorder"]))
    assert overrides(None) == [] and overrides({}) == []


def test_look_change_propagates_to_untouched_fields_only():
    exception = variants()["color"]
    patch = diff(BASE, exception)
    look = deepcopy(BASE)
    look["canvas"]["margins"]["bottom"] = 80
    look["regions"][0]["slots"]["primary-start"]["style"]["color"] = "#00FF00"
    look["regions"][0]["slots"]["primary-start"]["style"]["bold"] = False
    resolved, dropped = apply(look, patch)
    assert dropped == []
    assert resolved["canvas"]["margins"]["bottom"] == 80
    style = resolved["regions"][0]["slots"]["primary-start"]["style"]
    assert style == {"color": "#FF0000", "bold": False, "font_size_level": "medium"}


def test_signature_exception_survives_look_changes():
    patch = diff(BASE, variants()["signature_added"])
    look = deepcopy(BASE)
    look["canvas"]["background"] = "#000000"
    resolved, _ = apply(look, patch)
    assert [r["id"] for r in resolved["regions"]] == ["footer", "sig"]
    assert resolved["canvas"]["background"] == "#000000"


def test_paths_with_missing_parent_are_dropped():
    patch = diff(BASE, variants()["color"])
    plain = deepcopy(BASE)
    plain["regions"] = []
    resolved, dropped = apply(plain, patch)
    assert resolved == plain
    assert dropped == ["regions/footer/slots/primary-start/style/color"]
    # A nested parent that became null is a missing parent too.
    nested = diff(BASE, variants()["style_none_to_dict"])
    tweak = deepcopy(variants()["style_none_to_dict"])
    tweak["regions"][0]["slots"]["asset"]["style"]["color"] = "#123456"
    patch = diff(variants()["style_none_to_dict"], tweak)
    resolved, dropped = apply(BASE, patch)
    assert dropped == ["regions/footer/slots/asset/style/color"] and resolved == BASE
    assert nested  # sanity: none→dict is a $set write, never dropped
    assert apply(BASE, nested)[1] == []


def test_effect_removed_by_look_drops_exception_tweak():
    with_effect = variants()["effect_added"]
    tweaked = deepcopy(with_effect)
    tweaked["canvas"]["effect"]["shadow"] = False
    patch = diff(with_effect, tweaked)
    assert patch == {"canvas": {"effect": {"shadow": False}}}
    resolved, dropped = apply(BASE, patch)
    assert resolved == BASE and dropped == ["canvas/effect/shadow"]
    # And an exception that removed the effect keeps it removed after look edits.
    removed = diff(with_effect, BASE)
    look = deepcopy(with_effect)
    look["canvas"]["effect"]["photo_radius"] = 0.05
    assert "effect" not in apply(look, removed)[0]["canvas"]


def test_regions_map_falls_back_to_value_for_duplicate_ids():
    target = deepcopy(BASE)
    target["regions"] = [footer(), footer(height=0.2)]
    patch = diff(BASE, target)
    assert isinstance(patch["regions"], list)
    assert apply(BASE, patch)[0] == target


def test_config_keys_must_not_look_like_markers():
    with pytest.raises(ValueError):
        diff(BASE, {**BASE, "$set": 1})
