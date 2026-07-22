from pathlib import Path

from jinja2 import pass_context

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


def resolve_auto_logo(exif: dict, brand: str | None = None) -> str | None:
    """Resolve an installed logo from trusted EXIF values without Jinja evaluation."""

    brand = (brand or exif.get('Make', 'fujifilm')).lower()
    if brand in ('', 'default'):
        brand = 'fujifilm'

    # Split the brand name into tokens (e.g. "NIKON CORPORATION" -> ["nikon", "corporation"])
    # and filter to tokens long enough to be meaningful brand identifiers.
    tokens = [t for t in brand.replace("-", " ").split() if len(t) > 2]

    def _matches_stem(stem: str) -> bool:
        """Match whole brand tokens, never arbitrary substrings such as ``not`` → ``nothing``."""
        stem_tokens = {
            token for token in stem.lower().replace("-", " ").replace("_", " ").split()
            if token
        }
        return any(token in stem_tokens for token in tokens)

    def _is_valid_logo(f: Path) -> bool:
        """Skip hidden files, AppleDouble artefacts, and non-image extensions."""
        if f.name.startswith(".") or f.name.startswith("._"):
            return False
        return f.suffix.lower() in {'.png', '.jpg', '.jpeg'}

    # 1. 优先匹配用户自定义 Logo
    custom_dir = logos_dir / "custom"
    if custom_dir.exists():
        for f in custom_dir.iterdir():
            if _is_valid_logo(f) and _matches_stem(f.stem):
                return str(f.absolute()).replace('\\', '/')

    # 2. 回退到内置品牌 Logo
    for f in logos_dir.iterdir():
        if f.is_file() and _is_valid_logo(f) and _matches_stem(f.stem):
            return str(f.absolute()).replace('\\', '/')

    # 3. 最终回退：如果什么都没匹配上，使用 fujifilm 作为默认 logo
    fallback = logos_dir / 'fujifilm.png'
    if fallback.exists():
        return str(fallback.absolute()).replace('\\', '/')
    return None
