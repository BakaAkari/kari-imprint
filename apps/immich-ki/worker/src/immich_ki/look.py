"""Album look patches: the difference between an album look and one photo.

A patch is a JSON object mirroring the config tree.  Each node is one of:

* a plain object (no ``$`` keys) -- recurse into the same key of the base;
* ``{"$set": value}`` -- write ``value`` (used for object values, so that a
  whole new subtree is never mistaken for a recursive patch);
* ``{"$delete": true}`` -- remove the key;
* any non-object value (string, number, bool, null, array) -- write it.

Arrays are values, except the root ``regions`` array which is a map keyed by
region ``id``: its node is ``{"$regions": {id: node}, "$order": [ids]?}``.
Regions keep the base order with new regions appended; ``$order`` is only
emitted when the target order differs from that.

``apply`` skips nodes whose parent no longer exists in the base (for example
an exception's footer edits after the look became a plain margin) and
reports them as ``dropped`` paths.  Paths use ``/`` and region ids.
"""

from __future__ import annotations

import json
from copy import deepcopy

SET = "$set"
DELETE = "$delete"
REGIONS = "$regions"
ORDER = "$order"


def _same(a, b) -> bool:
    # JSON identity: 1 != 1.0 != True, and null is not a missing key.
    return json.dumps(a, sort_keys=True, allow_nan=False) == json.dumps(b, sort_keys=True, allow_nan=False)


def _join(prefix: str, key: str) -> str:
    return f"{prefix}/{key}" if prefix else key


def _is_set(node) -> bool:
    return isinstance(node, dict) and len(node) == 1 and SET in node


def _is_delete(node) -> bool:
    return isinstance(node, dict) and node == {DELETE: True}


def _literal(value):
    return {SET: deepcopy(value)} if isinstance(value, dict) else deepcopy(value)


def _region_map(value):
    """Return ``{id: region}`` when ``value`` can be treated as a map, else None."""
    if not isinstance(value, list):
        return None
    result = {}
    for region in value:
        if not isinstance(region, dict) or not isinstance(region.get("id"), str) or region["id"] in result:
            return None
        result[region["id"]] = region
    return result


def _check_keys(obj):
    for key in obj:
        if not isinstance(key, str) or key.startswith("$"):
            raise ValueError("invalid_config_key")


def _diff_obj(base: dict, target: dict, root: bool) -> dict:
    _check_keys(target)
    out = {}
    for key, value in target.items():
        if key not in base:
            out[key] = _literal(value)
            continue
        old = base[key]
        if root and key == "regions":
            old_map, new_map = _region_map(old), _region_map(value)
            if old_map is not None and new_map is not None:
                node = _diff_regions(old_map, new_map)
                if node:
                    out[key] = node
                continue
        if isinstance(old, dict) and isinstance(value, dict):
            sub = _diff_obj(old, value, False)
            if sub:
                out[key] = sub
        elif not _same(old, value):
            out[key] = _literal(value)
    for key in base:
        if key not in target:
            out[key] = {DELETE: True}
    return out


def _diff_regions(old: dict, new: dict) -> dict:
    inner = {}
    for region_id, region in new.items():
        if region_id not in old:
            inner[region_id] = {SET: deepcopy(region)}
        else:
            sub = _diff_obj(old[region_id], region, False)
            if sub:
                inner[region_id] = sub
    for region_id in old:
        if region_id not in new:
            inner[region_id] = {DELETE: True}
    node = {}
    if inner:
        node[REGIONS] = inner
    expected = [i for i in old if i in new] + [i for i in new if i not in old]
    if expected != list(new):
        node[ORDER] = list(new)
    return node


def diff(base: dict, target: dict) -> dict:
    """Patch turning ``base`` into ``target``; ``{}`` when they are identical."""
    if not isinstance(base, dict) or not isinstance(target, dict):
        raise ValueError("invalid_config")
    return _diff_obj(base, target, True)


def _apply_obj(obj: dict, patch: dict, prefix: str, dropped: list, root: bool):
    for key, node in patch.items():
        path = _join(prefix, key)
        if _is_delete(node):
            obj.pop(key, None)
        elif _is_set(node):
            obj[key] = deepcopy(node[SET])
        elif isinstance(node, dict):
            current = obj.get(key)
            if root and key == "regions" and (REGIONS in node or ORDER in node):
                regions = _region_map(current)
                if regions is None:
                    dropped.extend(overrides({key: node}, prefix))
                else:
                    obj[key] = _apply_regions(current, regions, node, path, dropped)
            elif isinstance(current, dict):
                _apply_obj(current, node, path, dropped, False)
            else:
                dropped.extend(overrides(node, path))
        else:
            obj[key] = deepcopy(node)


def _apply_regions(current: list, regions: dict, node: dict, path: str, dropped: list) -> list:
    order = [region["id"] for region in current]
    for region_id, sub in (node.get(REGIONS) or {}).items():
        region_path = _join(path, region_id)
        if _is_delete(sub):
            if region_id in regions:
                del regions[region_id]
                order.remove(region_id)
        elif _is_set(sub):
            if region_id not in regions:
                order.append(region_id)
            regions[region_id] = deepcopy(sub[SET])
        elif isinstance(sub, dict) and region_id in regions:
            _apply_obj(regions[region_id], sub, region_path, dropped, False)
        else:
            dropped.extend(overrides(sub, region_path) if isinstance(sub, dict) else [region_path])
    if ORDER in node:
        rank = {region_id: index for index, region_id in enumerate(node[ORDER])}
        order.sort(key=lambda region_id: rank.get(region_id, len(rank)))
    return [regions[region_id] for region_id in order]


def apply(base: dict, patch: dict | None):
    """Return ``(config, dropped_paths)``; ``base`` is never mutated."""
    result = deepcopy(base)
    dropped: list[str] = []
    if patch:
        _apply_obj(result, patch, "", dropped, True)
    return result, dropped


def overrides(patch: dict | None, prefix: str = "") -> list[str]:
    """Leaf paths of ``patch`` (``/`` separated, regions by id)."""
    paths: list[str] = []
    for key, node in (patch or {}).items():
        path = _join(prefix, key)
        if not isinstance(node, dict) or _is_set(node) or _is_delete(node):
            paths.append(path)
        elif not prefix and key == "regions" and (REGIONS in node or ORDER in node):
            for region_id, sub in (node.get(REGIONS) or {}).items():
                region_path = _join(path, region_id)
                if isinstance(sub, dict) and not _is_set(sub) and not _is_delete(sub):
                    paths.extend(overrides(sub, region_path))
                else:
                    paths.append(region_path)
            if ORDER in node:
                paths.append(_join(path, ORDER))
        else:
            paths.extend(overrides(node, path))
    return paths
