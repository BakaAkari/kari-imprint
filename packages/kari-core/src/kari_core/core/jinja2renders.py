from pathlib import Path

from jinja2 import pass_context

from kari_core.core.auto_logo import match_brand_stem
from kari_core.core.config_loader import LOGOS_DIR as logos_dir


@pass_context
def vw(context, percent):
    exif = context.get('exif', {})
    return int(int(exif.get('ImageWidth', 0)) * percent / 100)


@pass_context
def vh(context, percent):
    exif = context.get('exif', {})
    return int(int(exif.get('ImageHeight', 0)) * percent / 100)


@pass_context
def auto_logo(context, brand: str | None = None):
    exif = context.get('exif', {})
    return resolve_auto_logo(exif, brand)


def _is_valid_logo(f: Path) -> bool:
    if f.name.startswith(".") or f.name.startswith("._"):
        return False
    return f.suffix.lower() in {'.png', '.jpg', '.jpeg'}


def _list_valid(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(
        (f for f in directory.iterdir() if f.is_file() and _is_valid_logo(f)),
        key=lambda item: item.name.lower(),
    )


def resolve_auto_logo(exif: dict, brand: str | None = None) -> str | None:
    """V2 legacy resolver — Jinja templates still use its fallback semantics.

    Distinct from V3: this path walks `custom/` first, then builtin, then
    falls back to `fujifilm.png`. The primitive `match_brand_stem` is shared
    with V3 (`packages/kari-core/src/kari_core/core/auto_logo.py`) so the
    tokenizer never drifts between the two.
    """

    brand = (brand or exif.get('Make', 'fujifilm')).lower()
    if brand in ('', 'default'):
        brand = 'fujifilm'

    custom_files = _list_valid(logos_dir / "custom")
    custom_match = match_brand_stem(brand, (f.stem for f in custom_files))
    if custom_match is not None:
        for f in custom_files:
            if f.stem == custom_match:
                return str(f.absolute()).replace('\\', '/')

    builtin_files = _list_valid(logos_dir)
    builtin_match = match_brand_stem(brand, (f.stem for f in builtin_files))
    if builtin_match is not None:
        for f in builtin_files:
            if f.stem == builtin_match:
                return str(f.absolute()).replace('\\', '/')

    fallback = logos_dir / 'fujifilm.png'
    if fallback.exists():
        return str(fallback.absolute()).replace('\\', '/')
    return None
