"""Generate the seamless material textures in assets/textures (paper, silk, grain).

Procedural and seeded, so the files are original work (no third-party
licence) and reproducible: `uv run python scripts/generate_textures.py`.
Textures are greyscale and light; renderers multiply them over a box, so
white leaves the colour untouched and darker fibres tint it.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures"


def _noise(width: int, height: int, seed: int) -> Image.Image:
    """Uniform greyscale noise from a xorshift32 stream (deterministic across platforms)."""
    state = seed & 0xFFFFFFFF or 0x9E3779B9
    data = bytearray(width * height)
    for i in range(width * height):
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        data[i] = state & 0xFF
    return Image.frombytes("L", (width, height), bytes(data))


def _seamless(tile: Image.Image, blur: float) -> Image.Image:
    """Blur a periodic 3x3 repeat and keep the centre, so the tile wraps without seams."""
    w, h = tile.size
    big = Image.new("L", (w * 3, h * 3))
    for x in range(3):
        for y in range(3):
            big.paste(tile, (x * w, y * h))
    return big.filter(ImageFilter.GaussianBlur(blur)).crop((w, h, 2 * w, 2 * h))


def _levels(image: Image.Image, low: int, high: int) -> Image.Image:
    """Stretch to [low, high] around the mean, so textures stay light."""
    lo, hi = image.getextrema()
    span = max(1, hi - lo)
    return image.point(lambda v: round(low + (v - lo) * (high - low) / span))


def paper(size: int = 512) -> Image.Image:
    fine = _seamless(_noise(size, size, 11), 0.7)
    fibre = _seamless(_noise(size // 4, size // 4, 12).resize((size, size), Image.BICUBIC), 2.2)
    mixed = Image.blend(fine, fibre, 0.55)
    return _levels(mixed, 214, 255)


def silk(size: int = 512) -> Image.Image:
    weft = _seamless(_noise(size // 16, size, 21).resize((size, size), Image.BICUBIC), 0.6)
    warp = _seamless(_noise(size, size // 16, 22).resize((size, size), Image.BICUBIC), 0.6)
    return _levels(Image.blend(weft, warp, 0.5), 206, 255)


def grain(size: int = 256) -> Image.Image:
    return _levels(_seamless(_noise(size, size, 31), 0.45), 196, 255)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in (("paper", paper()), ("silk", silk()), ("grain", grain())):
        target = OUT / f"{name}.png"
        image.save(target, optimize=True)
        print(target.relative_to(ROOT), image.size, target.stat().st_size)


if __name__ == "__main__":
    main()
