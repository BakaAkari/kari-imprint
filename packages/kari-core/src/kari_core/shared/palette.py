"""Photo palette — six representative colours of a photo, as display fields.

Computed once per photo in Python and delivered with the EXIF field values
(``palette_1`` … ``palette_6``, most populous first), so the browser preview
and the PIL output resolve colour references (``@palette_2:pale``) to the
same hex values. The browser never extracts a palette itself: browser and
Pillow resampling differ.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

PALETTE_SIZE = 6
PALETTE_FIELDS = tuple(f"palette_{i}" for i in range(1, PALETTE_SIZE + 1))
_WORK_EDGE = 96


def extract_palette(image: Image.Image) -> list[str]:
    """Median-cut palette of an (oriented) image, most populous colour first."""
    rgb = image.convert("RGB")
    long_edge = max(rgb.width, rgb.height)
    # Integer reduce first (cheap on huge images), then a box resample to the work size.
    factor = max(1, long_edge // (_WORK_EDGE * 4))
    if factor > 1:
        rgb = rgb.reduce(factor)
    scale = _WORK_EDGE / max(rgb.width, rgb.height)
    if scale < 1:
        rgb = rgb.resize((max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale))), Image.BOX)
    quantized = rgb.quantize(colors=PALETTE_SIZE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    raw = quantized.getpalette() or []
    counts = sorted(quantized.getcolors() or [], key=lambda item: (-item[0], item[1]))
    colours = []
    for _count, index in counts:
        r, g, b = raw[index * 3:index * 3 + 3]
        colours.append(f"#{r:02X}{g:02X}{b:02X}")
    while len(colours) < PALETTE_SIZE:
        colours.append(colours[-1] if colours else "#BFBFBF")
    return colours[:PALETTE_SIZE]


def palette_fields(image: Image.Image) -> dict[str, str]:
    return dict(zip(PALETTE_FIELDS, extract_palette(image), strict=True))


def palette_fields_for_path(path: str | Path) -> dict[str, str]:
    """Palette fields for an image file; empty when it cannot be decoded."""
    try:
        with Image.open(path) as image:
            return palette_fields(ImageOps.exif_transpose(image))
    except (OSError, ValueError):
        return {}
