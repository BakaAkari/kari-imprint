"""Opt-in photograph output policy; legacy/public rendering remains unchanged."""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from struct import pack
from typing import BinaryIO

from PIL import Image, ImageCms, ImageOps

POLICY_VERSION = "photo-srgb-v1"
# LittleCMS stamps newly created profiles with wall-clock time. Normalize the
# ICC header date so identical jobs remain reproducible across child processes.
_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
_profile[24:36] = pack(">6H", 2000, 1, 1, 0, 0, 0)
SRGB_PROFILE = bytes(_profile)


@dataclass(frozen=True)
class OutputMetadata:
    exif: bytes
    icc_profile: bytes

    def save_options(self, size: tuple[int, int]) -> dict[str, bytes]:
        exif = Image.Exif()
        exif.load(self.exif)
        # Build a fresh IFD0 so the source's IFD1 thumbnail and strip offsets
        # cannot survive. Preserve photographic EXIF/GPS, not obsolete pixels.
        clean = Image.Exif()
        for tag, value in exif.items():
            if tag not in {273, 278, 279, 330, 513, 514, 34665, 34853}:
                clean[tag] = value
        clean[274] = 1
        clean[256], clean[257] = size
        photo = dict(exif.get_ifd(34665)) if 34665 in exif else {}
        for tag in (37500, 40965):  # MakerNote offsets / interoperability pointer
            photo.pop(tag, None)
        photo.update({40961: 1, 40962: size[0], 40963: size[1]})
        clean[34665] = photo
        if 34853 in exif:
            clean[34853] = dict(exif.get_ifd(34853))
        return {"exif": clean.tobytes(), "icc_profile": self.icc_profile}


def load_photograph(
    source: str | Path | BinaryIO, *, max_pixels: int,
) -> tuple[Image.Image, OutputMetadata]:
    """Decode, orient and colour-convert a bounded JPEG/PNG before composition.

    PNG transparency is composited onto white by this explicit photo policy.
    Invalid metadata/profile is an error, never silently assigned a wrong ICC.
    """
    with Image.open(source) as original:
        if original.format not in {"JPEG", "PNG"}:
            raise ValueError("unsupported_image")
        if original.width * original.height > max_pixels:
            raise ValueError("image_too_large")
        metadata = original.getexif().tobytes()
        profile = original.info.get("icc_profile")
        oriented = ImageOps.exif_transpose(original)
        alpha = oriented.convert("RGBA").getchannel("A") if "A" in oriented.getbands() or "transparency" in oriented.info else None
        target = ImageCms.ImageCmsProfile(BytesIO(SRGB_PROFILE))
        if profile:
            # Retain native CMYK/LAB samples for profiles describing those modes.
            colour = oriented if oriented.mode in {"RGB", "CMYK", "LAB", "L"} else oriented.convert("RGB")
            pixels = ImageCms.profileToProfile(colour, ImageCms.ImageCmsProfile(BytesIO(profile)), target, outputMode="RGB")
        else:
            pixels = oriented.convert("RGB")
        if alpha is not None:
            pixels = Image.composite(pixels, Image.new("RGB", pixels.size, "white"), alpha)
        pixels.load()
        return pixels.copy(), OutputMetadata(metadata, target.tobytes())
