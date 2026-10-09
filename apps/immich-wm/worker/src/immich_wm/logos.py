"""Use the renderer's exact catalog and variant resolution for previews."""
import hashlib
import re

from kari_core.processor.renderer import _find_logo_file, _iter_builtin_logo_files, _parse_logo_stem


def catalog():
    brands = {}
    for path in _iter_builtin_logo_files():
        base, variant, _ = _parse_logo_stem(path.stem)
        brands.setdefault(base, set()).add(variant)
    return [{'stem': key, 'variants': sorted(v for v in values if v)} for key, values in sorted(brands.items())]


def resolve(name, variant='', dark=False):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', name) or not re.fullmatch(r'[A-Za-z0-9_-]{0,16}', variant):
        raise ValueError('invalid_logo_name')
    path = _find_logo_file(name, variant, dark)
    if path is None or path.is_symlink():
        raise ValueError('logo_not_found')
    return path


def bundle_hash():
    digest = hashlib.sha256()
    for path in _iter_builtin_logo_files():
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]
